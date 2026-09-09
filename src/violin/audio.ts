/**
 * Playback of the generated part, so the violinist can hear the line before
 * trying it, optionally with the chords underneath and a click.
 */

import { Bar } from "./generate";
import { midiToFreq } from "./theory";
import { Chord, chordIntervals, mod12 } from "./theory";

export interface PlaybackOptions {
  tempo: number;
  beatsPerBar: number;
  withChords: boolean;
  withClick: boolean;
  swing: boolean;
  loop: boolean;
}

interface ScheduledNote {
  midi: number | null;
  double?: number;
  start: number; // in beats from the top
  duration: number;
  pizz?: boolean;
  accent?: boolean;
  globalIndex: number;
  barIndex: number;
}

function flatten(bars: Bar[]): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  let beat = 0;
  let globalIndex = 0;
  bars.forEach((bar) => {
    let position = beat;
    bar.notes.forEach((note) => {
      out.push({
        midi: note.midi,
        double: note.double,
        start: position,
        duration: note.beats,
        pizz: note.pizz,
        accent: note.accent,
        globalIndex: globalIndex++,
        barIndex: bar.index,
      });
      position += note.beats;
    });
    beat += bar.beats;
  });
  return out;
}

/** Pushes the second eighth of each beat late, for a swung feel. */
function swingBeats(beats: number, swing: boolean): number {
  if (!swing) return beats;
  const whole = Math.floor(beats);
  const fraction = beats - whole;
  if (fraction >= 0.5 && fraction < 0.75) return whole + 0.5 + (fraction - 0.5) + 0.166;
  return beats;
}

export class Player {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private raf = 0;
  private startTime = 0;
  private passBeats = 0;
  private notes: ScheduledNote[] = [];
  private options: PlaybackOptions | null = null;
  private bars: Bar[] = [];
  private onStep: ((globalIndex: number | null, barIndex: number | null) => void) | null = null;
  playing = false;

  private ensureContext(): AudioContext {
    if (!this.context) {
      const Ctor: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private voice(midi: number, time: number, duration: number, pizz: boolean, gain: number): void {
    const ctx = this.ensureContext();
    const master = this.master;
    if (!master) return;
    const frequency = midiToFreq(midi);
    const osc = ctx.createOscillator();
    osc.type = pizz ? "triangle" : "sawtooth";
    osc.frequency.value = frequency;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(pizz ? 3600 : 2400, time);
    filter.Q.value = 0.8;

    const envelope = ctx.createGain();
    const attack = pizz ? 0.004 : 0.045;
    const peak = gain * (pizz ? 1.1 : 0.85);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
    if (pizz) {
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(duration, 0.55));
      filter.frequency.exponentialRampToValueAtTime(700, time + Math.min(duration, 0.55));
    } else {
      envelope.gain.setValueAtTime(peak, time + Math.max(attack, duration - 0.06));
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      // A little vibrato keeps long tones from sounding like a test signal.
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 5.2;
      lfoGain.gain.value = frequency * 0.006;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(time);
      lfo.stop(time + duration + 0.1);
    }

    osc.connect(filter).connect(envelope).connect(master);
    osc.start(time);
    osc.stop(time + duration + 0.12);
  }

  private chordPad(chord: Chord, time: number, duration: number): void {
    const ctx = this.ensureContext();
    const master = this.master;
    if (!master) return;
    const tones = chordIntervals(chord).map((interval) => 48 + mod12(chord.root + interval));
    tones.forEach((midi, index) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(midi + (index === 0 ? -12 : 0));
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(0.09, time + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.95);
      osc.connect(envelope).connect(master);
      osc.start(time);
      osc.stop(time + duration);
    });
  }

  private click(time: number, strong: boolean): void {
    const ctx = this.ensureContext();
    const master = this.master;
    if (!master) return;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = strong ? 1600 : 1100;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(strong ? 0.16 : 0.08, time + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(envelope).connect(master);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  private schedulePass(passStart: number): void {
    const options = this.options;
    if (!options) return;
    const secondsPerBeat = 60 / options.tempo;

    this.notes.forEach((note) => {
      const time = passStart + swingBeats(note.start, options.swing) * secondsPerBeat;
      const duration = Math.max(0.08, note.duration * secondsPerBeat * (note.pizz ? 0.9 : 0.96));
      if (note.midi === null) return;
      const gain = note.accent ? 0.34 : 0.26;
      this.voice(note.midi, time, duration, !!note.pizz, gain);
      if (note.double !== undefined) this.voice(note.double, time, duration, !!note.pizz, gain * 0.8);
    });

    if (options.withChords) {
      let beat = 0;
      this.bars.forEach((bar) => {
        this.chordPad(bar.chord, passStart + beat * secondsPerBeat, bar.beats * secondsPerBeat);
        beat += bar.beats;
      });
    }

    if (options.withClick) {
      for (let beat = 0; beat < this.passBeats; beat++) {
        this.click(passStart + beat * secondsPerBeat, beat % options.beatsPerBar === 0);
      }
    }
  }

  play(
    bars: Bar[],
    options: PlaybackOptions,
    onStep: (globalIndex: number | null, barIndex: number | null) => void
  ): void {
    this.stop();
    if (bars.length === 0) return;
    const ctx = this.ensureContext();
    void ctx.resume();
    this.bars = bars;
    this.options = options;
    this.notes = flatten(bars);
    this.passBeats = bars.reduce((total, bar) => total + bar.beats, 0);
    this.onStep = onStep;
    this.playing = true;
    this.startTime = ctx.currentTime + 0.12;
    this.schedulePass(this.startTime);

    const secondsPerBeat = 60 / options.tempo;
    const passSeconds = this.passBeats * secondsPerBeat;

    if (options.loop) {
      let nextPass = 1;
      const rearm = () => {
        if (!this.playing) return;
        this.schedulePass(this.startTime + nextPass * passSeconds);
        nextPass += 1;
        this.timer = window.setTimeout(rearm, passSeconds * 1000);
      };
      this.timer = window.setTimeout(rearm, Math.max(50, passSeconds * 1000 - 200));
    } else {
      this.timer = window.setTimeout(() => this.stop(), passSeconds * 1000 + 400);
    }

    const follow = () => {
      if (!this.playing || !this.context || !this.options) return;
      const elapsed = this.context.currentTime - this.startTime;
      const beats = (elapsed / secondsPerBeat) % this.passBeats;
      let current: ScheduledNote | null = null;
      for (const note of this.notes) {
        if (beats >= note.start - 0.001) current = note;
        else break;
      }
      this.onStep?.(current ? current.globalIndex : null, current ? current.barIndex : null);
      this.raf = requestAnimationFrame(follow);
    };
    this.raf = requestAnimationFrame(follow);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onStep?.(null, null);
    if (this.context && this.master) {
      // Silence anything already scheduled, then hand back a fresh output.
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
      this.master.disconnect();
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);
    }
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
