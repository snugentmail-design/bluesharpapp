/**
 * Listening side of the app: turn a microphone signal from a piano into a
 * stream of chord symbols.
 *
 * The analysis is split into small pure functions (spectrum -> chroma ->
 * chord) so the hard part can be tested without a microphone, and a thin
 * class that owns the Web Audio graph.
 */

import {
  Chord,
  DETECTABLE_QUALITIES,
  QUALITIES,
  Quality,
  chordEquals,
  freqToMidi,
  midiToFreq,
  mod12,
} from "./theory";

// 16384 samples is ~0.37 s at 44.1 kHz: slow enough to resolve bass notes a
// semitone apart, fast enough to follow chord changes in a jam.
export const FFT_SIZE = 16384;
const MIN_FREQ = 55; // A1
const MAX_FREQ = 2100; // ~C7
const HARMONIC_COUNT = 4;
const HARMONIC_FALLOFF = 0.55;
const BASS_MIN_FREQ = 41; // E1
const BASS_MAX_FREQ = 250;

/**
 * Folds an FFT magnitude spectrum into a 12-element pitch class profile.
 *
 * Peaks are picked first and each peak votes for the pitch classes it could be
 * a harmonic of, which keeps the fifth of a triad from being invented by the
 * overtones of its root.
 *
 * @param spectrumDb Output of AnalyserNode.getFloatFrequencyData (decibels).
 */
export function computeChroma(
  spectrumDb: Float32Array,
  sampleRate: number,
  fftSize: number
): Float32Array {
  const chroma = new Float32Array(12);
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(MIN_FREQ / binHz));
  const maxBin = Math.min(spectrumDb.length - 2, Math.ceil(MAX_FREQ / binHz));
  if (maxBin <= minBin) return chroma;

  let peakDb = -Infinity;
  for (let i = minBin; i <= maxBin; i++) {
    if (spectrumDb[i] > peakDb) peakDb = spectrumDb[i];
  }
  if (!isFinite(peakDb)) return chroma;
  const floorDb = peakDb - 42; // ignore anything far below the loudest partial

  for (let i = minBin; i <= maxBin; i++) {
    const db = spectrumDb[i];
    if (db < floorDb) continue;
    if (db <= spectrumDb[i - 1] || db < spectrumDb[i + 1]) continue; // local maximum only

    // Parabolic interpolation gives sub-bin frequency accuracy, which matters
    // in the low register where bins are wide relative to a semitone.
    const left = spectrumDb[i - 1];
    const right = spectrumDb[i + 1];
    const denom = left - 2 * db + right;
    const offset = denom === 0 ? 0 : (0.5 * (left - right)) / denom;
    const freq = (i + offset) * binHz;
    if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

    const magnitude = Math.pow(10, db / 20);
    for (let h = 1; h <= HARMONIC_COUNT; h++) {
      const fundamental = freq / h;
      if (fundamental < MIN_FREQ * 0.9) break;
      const midi = freqToMidi(fundamental);
      const nearest = Math.round(midi);
      const cents = Math.abs(midi - nearest);
      if (cents > 0.35) continue; // too far out of tune to be this harmonic
      const tuning = Math.cos(cents * Math.PI) * 0.5 + 0.5;
      const weight = magnitude * Math.pow(HARMONIC_FALLOFF, h - 1) * tuning;
      chroma[mod12(nearest)] += weight;
    }
  }

  let max = 0;
  for (let i = 0; i < 12; i++) max = Math.max(max, chroma[i]);
  if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

/**
 * Pitch class profile of the bass register only.
 *
 * A seventh chord and the triad a third above it share three notes, so the
 * chroma alone cannot tell Dm7 from F. The note in the player's left hand
 * settles it, and this is how we ask.
 */
export function computeBassChroma(
  spectrumDb: Float32Array,
  sampleRate: number,
  fftSize: number
): Float32Array {
  const bass = new Float32Array(12);
  const binHz = sampleRate / fftSize;
  const lowMidi = Math.ceil(freqToMidi(BASS_MIN_FREQ));
  const highMidi = Math.floor(freqToMidi(BASS_MAX_FREQ));

  // Band energy rather than peak picking: down here a semitone can be
  // narrower than one FFT bin, so a peak's exact frequency is not trustworthy.
  for (let midi = lowMidi; midi <= highMidi; midi++) {
    const centre = midiToFreq(midi);
    const low = centre * Math.pow(2, -0.5 / 12);
    const high = centre * Math.pow(2, 0.5 / 12);
    const firstBin = Math.max(1, Math.floor(low / binHz));
    const lastBin = Math.min(spectrumDb.length - 1, Math.ceil(high / binHz));
    let loudest = -Infinity;
    for (let i = firstBin; i <= lastBin; i++) loudest = Math.max(loudest, spectrumDb[i]);
    if (!isFinite(loudest)) continue;
    // Tilt toward the bottom of the range: the lowest note is the bass note.
    const tilt = BASS_MAX_FREQ / (centre + 40);
    bass[mod12(midi)] += Math.pow(10, loudest / 20) * tilt;
  }

  let max = 0;
  for (let i = 0; i < 12; i++) max = Math.max(max, bass[i]);
  if (max > 0) for (let i = 0; i < 12; i++) bass[i] /= max;
  // Anything far below the loudest bass pitch class is noise or an overtone.
  for (let i = 0; i < 12; i++) bass[i] = bass[i] < 0.35 ? 0 : (bass[i] - 0.35) / 0.65;
  return bass;
}

export interface ChordMatch {
  chord: Chord;
  score: number;
  /** 0..1, folds in how far ahead of the runner-up this chord is. */
  confidence: number;
}

const TEMPLATE_CACHE: Array<{
  chord: Chord;
  vector: Float32Array;
  norm: number;
  size: number;
  prior: number;
}> = [];

function templates() {
  if (TEMPLATE_CACHE.length > 0) return TEMPLATE_CACHE;
  for (let root = 0; root < 12; root++) {
    for (const quality of DETECTABLE_QUALITIES as Quality[]) {
      const spec = QUALITIES[quality];
      const vector = new Float32Array(12);
      spec.intervals.forEach((interval, index) => {
        vector[mod12(root + interval)] = Math.max(vector[mod12(root + interval)], spec.weights[index]);
      });
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += vector[i] * vector[i];
      TEMPLATE_CACHE.push({
        chord: { root, quality },
        vector,
        norm: Math.sqrt(sum),
        size: spec.intervals.length,
        prior: spec.prior,
      });
    }
  }
  return TEMPLATE_CACHE;
}

/**
 * Best matching chord for a pitch class profile, by weighted cosine
 * similarity, nudged toward chords whose root is in the bass.
 */
export function matchChord(chroma: Float32Array, bass?: Float32Array | null): ChordMatch | null {
  let energy = 0;
  for (let i = 0; i < 12; i++) energy += chroma[i] * chroma[i];
  if (energy <= 0) return null;
  const chromaNorm = Math.sqrt(energy);
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (total <= 0) return null;

  let best: { chord: Chord; score: number } | null = null;
  let second = 0;

  for (const template of templates()) {
    let dot = 0;
    let inChord = 0;
    for (let i = 0; i < 12; i++) {
      dot += chroma[i] * template.vector[i];
      if (template.vector[i] > 0) inChord += chroma[i];
    }
    const cosine = dot / (chromaNorm * template.norm);
    const outside = 1 - inChord / total;
    const bassBonus = bass ? bass[template.chord.root] * 0.3 : 0;
    const score = cosine - outside * 0.45 - (template.size - 3) * 0.015 + bassBonus + template.prior;
    if (!best || score > best.score) {
      if (best) second = best.score;
      best = { chord: template.chord, score };
    } else if (score > second) {
      second = score;
    }
  }

  if (!best) return null;
  const margin = Math.max(0, best.score - second);
  const confidence = Math.max(0, Math.min(1, best.score * (0.75 + Math.min(0.25, margin * 2.5))));
  return { chord: best.chord, score: best.score, confidence };
}

export interface TrackerOptions {
  /** How long a chord must stay stable before it is written to the progression. */
  holdMs: number;
  /** Confidence below this is treated as "not sure yet". */
  minConfidence: number;
  /** RMS below this counts as silence. */
  silenceLevel: number;
  /** Smoothing of the pitch class profile, 0..1 (higher is steadier, slower). */
  smoothing: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  holdMs: 260,
  minConfidence: 0.62,
  silenceLevel: 0.012,
  smoothing: 0.72,
};

export interface TrackerFrame {
  /** The chord being heard right now, before it is stable enough to commit. */
  current: Chord | null;
  confidence: number;
  /** Set on the frame where a new chord becomes stable. */
  committed: Chord | null;
  level: number;
  chroma: Float32Array;
}

/**
 * Turns per-frame chord guesses into a settled progression: a chord has to be
 * heard steadily for `holdMs` before it counts, and repeats of the chord
 * already sounding are ignored.
 */
export class ChordTracker {
  private smoothed = new Float32Array(12);
  private smoothedBass = new Float32Array(12);
  private pending: Chord | null = null;
  private pendingSince = 0;
  private lastCommitted: Chord | null = null;
  private options: TrackerOptions;

  constructor(options: Partial<TrackerOptions> = {}) {
    this.options = { ...DEFAULT_TRACKER_OPTIONS, ...options };
  }

  setOptions(options: Partial<TrackerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  reset(): void {
    this.smoothed = new Float32Array(12);
    this.smoothedBass = new Float32Array(12);
    this.pending = null;
    this.pendingSince = 0;
    this.lastCommitted = null;
  }

  /** Lets the tracker know the progression changed underneath it. */
  setLastCommitted(chord: Chord | null): void {
    this.lastCommitted = chord;
  }

  update(chroma: Float32Array, bass: Float32Array | null, level: number, timeMs: number): TrackerFrame {
    const { smoothing, silenceLevel, minConfidence, holdMs } = this.options;

    if (level < silenceLevel) {
      for (let i = 0; i < 12; i++) {
        this.smoothed[i] *= 0.8;
        this.smoothedBass[i] *= 0.8;
      }
      this.pending = null;
      return { current: null, confidence: 0, committed: null, level, chroma: this.smoothed };
    }

    for (let i = 0; i < 12; i++) {
      this.smoothed[i] = this.smoothed[i] * smoothing + chroma[i] * (1 - smoothing);
      if (bass) this.smoothedBass[i] = this.smoothedBass[i] * smoothing + bass[i] * (1 - smoothing);
    }

    const match = matchChord(this.smoothed, bass ? this.smoothedBass : null);
    if (!match || match.confidence < minConfidence) {
      this.pending = null;
      return {
        current: match ? match.chord : null,
        confidence: match ? match.confidence : 0,
        committed: null,
        level,
        chroma: this.smoothed,
      };
    }

    if (!chordEquals(this.pending, match.chord)) {
      this.pending = match.chord;
      this.pendingSince = timeMs;
    }

    let committed: Chord | null = null;
    if (timeMs - this.pendingSince >= holdMs && !chordEquals(this.pending, this.lastCommitted)) {
      committed = this.pending;
      this.lastCommitted = this.pending;
    }

    return { current: match.chord, confidence: match.confidence, committed, level, chroma: this.smoothed };
  }
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export interface ListenerCallbacks {
  onFrame: (frame: TrackerFrame) => void;
  onError: (message: string) => void;
}

/** Owns the microphone, the analyser and the animation loop. */
export class PianoListener {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private spectrum = new Float32Array(FFT_SIZE / 2);
  private samples = new Float32Array(2048);
  private running = false;
  readonly tracker: ChordTracker;

  constructor(private callbacks: ListenerCallbacks, options: Partial<TrackerOptions> = {}) {
    this.tracker = new ChordTracker(options);
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<boolean> {
    if (this.running) return true;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onError("This browser will not give the page a microphone.");
      return false;
    }
    try {
      // Processing meant for speech chews up the harmonic detail we need.
      const audio = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (error) {
      this.callbacks.onError(
        "Microphone blocked. Allow mic access for this page, or enter the chords by hand."
      );
      return false;
    }

    const Ctor: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctor();
    await this.context.resume();
    const source = this.context.createMediaStreamSource(this.stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    this.analyser = analyser;
    this.spectrum = new Float32Array(analyser.frequencyBinCount);
    this.samples = new Float32Array(analyser.fftSize);
    this.running = true;
    this.tracker.reset();
    this.loop();
    return true;
  }

  private loop = (): void => {
    if (!this.running || !this.analyser || !this.context) return;
    this.analyser.getFloatFrequencyData(this.spectrum);
    this.analyser.getFloatTimeDomainData(this.samples);
    const level = rms(this.samples);
    const chroma = computeChroma(this.spectrum, this.context.sampleRate, this.analyser.fftSize);
    const bass = computeBassChroma(this.spectrum, this.context.sampleRate, this.analyser.fftSize);
    const frame = this.tracker.update(chroma, bass, level, performance.now());
    this.callbacks.onFrame(frame);
    this.raf = requestAnimationFrame(this.loop);
  };

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }
}
