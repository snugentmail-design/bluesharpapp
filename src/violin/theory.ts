/**
 * Core music theory used by the violin accompaniment generator.
 * Everything here is pure so it can be unit tested without audio or React.
 */

export type Mode = "major" | "minor";

export interface Key {
  tonic: number; // pitch class 0..11
  mode: Mode;
}

export type Quality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "sus4"
  | "sus2"
  | "6"
  | "m6"
  | "7"
  | "maj7"
  | "m7"
  | "m7b5"
  | "dim7"
  | "9"
  | "m9"
  | "maj9";

export interface Chord {
  root: number; // pitch class 0..11
  quality: Quality;
}

export const SHARP_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];
export const FLAT_NAMES = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
];

/** Semitone offsets from the root, plus how important each degree is for detection. */
interface QualitySpec {
  intervals: number[];
  /** Matching weight per interval, same order as `intervals`. */
  weights: number[];
  symbol: string;
  /** Included in live chord detection (a smaller set detects more reliably). */
  detect: boolean;
  minorThird: boolean;
  /**
   * How likely this quality is to turn up at all. Augmented and diminished
   * chords are rare, and they overlap so many other chords that without this
   * they get chosen far too often.
   */
  prior: number;
}

export const QUALITIES: Record<Quality, QualitySpec> = {
  maj: { intervals: [0, 4, 7], weights: [1, 0.95, 0.7], symbol: "", detect: true, minorThird: false, prior: 0 },
  min: { intervals: [0, 3, 7], weights: [1, 0.95, 0.7], symbol: "m", detect: true, minorThird: true, prior: 0 },
  dim: { intervals: [0, 3, 6], weights: [1, 0.9, 0.85], symbol: "dim", detect: true, minorThird: true, prior: -0.06 },
  aug: { intervals: [0, 4, 8], weights: [1, 0.9, 0.85], symbol: "aug", detect: true, minorThird: false, prior: -0.09 },
  sus4: { intervals: [0, 5, 7], weights: [1, 0.9, 0.8], symbol: "sus4", detect: true, minorThird: false, prior: -0.03 },
  sus2: { intervals: [0, 2, 7], weights: [1, 0.85, 0.8], symbol: "sus2", detect: false, minorThird: false, prior: -0.04 },
  "6": { intervals: [0, 4, 7, 9], weights: [1, 0.9, 0.6, 0.7], symbol: "6", detect: false, minorThird: false, prior: -0.03 },
  m6: { intervals: [0, 3, 7, 9], weights: [1, 0.9, 0.6, 0.7], symbol: "m6", detect: false, minorThird: true, prior: -0.04 },
  "7": { intervals: [0, 4, 7, 10], weights: [1, 0.9, 0.55, 0.85], symbol: "7", detect: true, minorThird: false, prior: -0.005 },
  maj7: { intervals: [0, 4, 7, 11], weights: [1, 0.9, 0.55, 0.85], symbol: "maj7", detect: true, minorThird: false, prior: -0.015 },
  m7: { intervals: [0, 3, 7, 10], weights: [1, 0.9, 0.55, 0.85], symbol: "m7", detect: true, minorThird: true, prior: -0.01 },
  m7b5: { intervals: [0, 3, 6, 10], weights: [1, 0.85, 0.8, 0.8], symbol: "m7b5", detect: true, minorThird: true, prior: -0.05 },
  dim7: { intervals: [0, 3, 6, 9], weights: [1, 0.85, 0.85, 0.85], symbol: "dim7", detect: false, minorThird: true, prior: -0.06 },
  "9": { intervals: [0, 4, 7, 10, 14], weights: [1, 0.85, 0.5, 0.8, 0.6], symbol: "9", detect: false, minorThird: false, prior: -0.03 },
  m9: { intervals: [0, 3, 7, 10, 14], weights: [1, 0.85, 0.5, 0.8, 0.6], symbol: "m9", detect: false, minorThird: true, prior: -0.03 },
  maj9: { intervals: [0, 4, 7, 11, 14], weights: [1, 0.85, 0.5, 0.8, 0.6], symbol: "maj9", detect: false, minorThird: false, prior: -0.035 },
};

export const DETECTABLE_QUALITIES: Quality[] = (Object.keys(QUALITIES) as Quality[]).filter(
  (q) => QUALITIES[q].detect
);

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

export function chordPitchClasses(chord: Chord): number[] {
  return QUALITIES[chord.quality].intervals.map((i) => mod12(chord.root + i));
}

/** Absolute (non-folded) chord tones above a root pitch class, in semitones from the root. */
export function chordIntervals(chord: Chord): number[] {
  return QUALITIES[chord.quality].intervals;
}

export function chordEquals(a: Chord | null, b: Chord | null): boolean {
  if (!a || !b) return a === b;
  return a.root === b.root && a.quality === b.quality;
}

/** Prefer flat spellings in flat keys, sharps in sharp keys. */
export function pitchClassName(pc: number, key?: Key): string {
  const sig = key ? keySignature(key) : 0;
  return sig < 0 ? FLAT_NAMES[mod12(pc)] : SHARP_NAMES[mod12(pc)];
}

export function chordName(chord: Chord, key?: Key): string {
  return pitchClassName(chord.root, key) + QUALITIES[chord.quality].symbol;
}

const MAJOR_SIGNATURES: Record<number, number> = {
  0: 0, 1: -5, 2: 2, 3: -3, 4: 4, 5: -1, 6: 6, 7: 1, 8: -4, 9: 3, 10: -2, 11: 5,
};
const MINOR_SIGNATURES: Record<number, number> = {
  0: -3, 1: 4, 2: -1, 3: -6, 4: 1, 5: -4, 6: 3, 7: -2, 8: 5, 9: 0, 10: -5, 11: 2,
};

/** Number of sharps (positive) or flats (negative) in the key signature. */
export function keySignature(key: Key): number {
  return key.mode === "major" ? MAJOR_SIGNATURES[mod12(key.tonic)] : MINOR_SIGNATURES[mod12(key.tonic)];
}

export function keyName(key: Key): string {
  const sig = keySignature(key);
  const name = sig < 0 ? FLAT_NAMES[mod12(key.tonic)] : SHARP_NAMES[mod12(key.tonic)];
  return key.mode === "major" ? `${name} major` : `${name} minor`;
}

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

export function keyPitchClasses(key: Key): number[] {
  const steps = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR;
  return steps.map((s) => mod12(key.tonic + s));
}

// ---------------------------------------------------------------------------
// Note spelling (letter + accidental), needed to place notes on a staff.
// ---------------------------------------------------------------------------

const LETTER_PITCH = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
export const LETTER_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

/** Accidental carried by each letter in a key signature, indexed C..B. */
export function keySignatureAlters(sig: number): number[] {
  const alters = [0, 0, 0, 0, 0, 0, 0];
  if (sig > 0) for (let i = 0; i < Math.min(sig, 7); i++) alters[SHARP_ORDER[i]] = 1;
  if (sig < 0) for (let i = 0; i < Math.min(-sig, 7); i++) alters[FLAT_ORDER[i]] = -1;
  return alters;
}

export interface SpelledNote {
  midi: number;
  letter: number; // 0..6 for C..B
  alter: number; // -2..2
  octave: number;
  /** Staff steps counted from C0; higher number means higher pitch. */
  diatonic: number;
  name: string;
}

/**
 * Chooses the most readable spelling of a midi note inside a key: an in-key
 * letter when possible, otherwise a single accidental leaning the way the key
 * signature leans, never a double accidental or B-sharp/C-flat.
 */
export function spellNote(midi: number, key: Key): SpelledNote {
  const sig = keySignature(key);
  const alters = keySignatureAlters(sig);
  const pc = mod12(midi);
  let best: { letter: number; alter: number; cost: number } | null = null;

  for (let letter = 0; letter < 7; letter++) {
    let alter = pc - LETTER_PITCH[letter];
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    if (Math.abs(alter) > 1) continue; // no double accidentals

    let cost = Math.abs(alter) * 2;
    if (alter === alters[letter]) cost -= 6; // already covered by the key signature
    // B#, Cb, E#, Fb are legal but read badly outside their home keys.
    if ((letter === 6 && alter > 0) || (letter === 0 && alter < 0)) cost += 8;
    if ((letter === 2 && alter > 0) || (letter === 3 && alter < 0)) cost += 3;
    if (sig >= 0 && alter > 0) cost -= 1;
    if (sig < 0 && alter < 0) cost -= 1;

    if (!best || cost < best.cost) best = { letter, alter, cost };
  }

  const chosen = best ?? { letter: 0, alter: 0, cost: 0 };
  const naturalMidi = midi - chosen.alter;
  const octave = Math.floor(naturalMidi / 12) - 1;
  return {
    midi,
    letter: chosen.letter,
    alter: chosen.alter,
    octave,
    diatonic: (octave + 1) * 7 + chosen.letter,
    name: LETTER_NAMES[chosen.letter] + (chosen.alter > 0 ? "#" : chosen.alter < 0 ? "b" : "") + octave,
  };
}

export function noteLabel(midi: number, key: Key): string {
  const s = spellNote(midi, key);
  return LETTER_NAMES[s.letter] + (s.alter > 0 ? "♯" : s.alter < 0 ? "♭" : "");
}

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (freq: number): number => 69 + 12 * Math.log2(freq / 440);

// ---------------------------------------------------------------------------
// Chord scales: which notes sound good over a chord in a key.
// ---------------------------------------------------------------------------

const MODE_STEPS: Record<string, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  halfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

export interface ChordScale {
  /** Pitch classes of the scale, rooted on the chord. */
  pcs: number[];
  name: string;
  /** Pitch classes to avoid landing on for long values. */
  avoid: number[];
}

export function chordScale(chord: Chord, key: Key): ChordScale {
  const degree = mod12(chord.root - key.tonic);
  const inKey = keyPitchClasses(key).includes(chord.root);
  let steps = MODE_STEPS.ionian;
  let name = "Ionian";
  const q = chord.quality;

  if (q === "min" || q === "m7" || q === "m9" || q === "m6") {
    const isTonicMinor = key.mode === "minor" && degree === 0;
    steps = isTonicMinor ? MODE_STEPS.aeolian : MODE_STEPS.dorian;
    name = isTonicMinor ? "Aeolian" : "Dorian";
    if (key.mode === "major" && degree === 4) {
      steps = MODE_STEPS.phrygian;
      name = "Phrygian";
    }
  } else if (q === "7" || q === "9") {
    const resolvesToMinor = key.mode === "minor" && degree === 7;
    steps = resolvesToMinor ? MODE_STEPS.halfWhole : MODE_STEPS.mixolydian;
    name = resolvesToMinor ? "Half-whole" : "Mixolydian";
  } else if (q === "maj7" || q === "maj9" || q === "maj" || q === "6") {
    const isSubdominant = (key.mode === "major" && degree === 5) || !inKey;
    steps = isSubdominant ? MODE_STEPS.lydian : MODE_STEPS.ionian;
    name = isSubdominant ? "Lydian" : "Ionian";
  } else if (q === "m7b5") {
    steps = MODE_STEPS.locrian;
    name = "Locrian";
  } else if (q === "dim" || q === "dim7") {
    steps = MODE_STEPS.halfWhole;
    name = "Diminished";
  } else if (q === "aug") {
    steps = MODE_STEPS.wholeTone;
    name = "Whole tone";
  } else if (q === "sus4" || q === "sus2") {
    steps = MODE_STEPS.mixolydian;
    name = "Mixolydian";
  }

  const pcs = steps.map((s) => mod12(chord.root + s));
  const avoid: number[] = [];
  if (name === "Ionian") avoid.push(mod12(chord.root + 5)); // the 4th over a major chord
  if (name === "Dorian" || name === "Aeolian") avoid.push(mod12(chord.root + 1));
  return { pcs, name, avoid };
}

/** The 3rd and 7th (or 6th) of a chord: the notes that spell the harmony. */
export function guideTones(chord: Chord): number[] {
  const iv = chordIntervals(chord);
  const third = iv.find((i) => i === 3 || i === 4);
  const seventh = iv.find((i) => i === 9 || i === 10 || i === 11);
  const out: number[] = [];
  if (third !== undefined) out.push(mod12(chord.root + third));
  if (seventh !== undefined) out.push(mod12(chord.root + seventh));
  if (out.length === 0) out.push(mod12(chord.root + 7));
  return out;
}

// ---------------------------------------------------------------------------
// Key inference from a chord progression.
// ---------------------------------------------------------------------------

export function inferKey(chords: Chord[]): Key {
  if (chords.length === 0) return { tonic: 0, mode: "major" };
  let best: { key: Key; score: number } | null = null;

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ["major", "minor"] as Mode[]) {
      const key: Key = { tonic, mode };
      const scale = keyPitchClasses(key);
      let score = 0;
      chords.forEach((chord, index) => {
        const recency = 1 + index / Math.max(1, chords.length);
        const tones = chordPitchClasses(chord);
        const fit = tones.filter((t) => scale.includes(t)).length / tones.length;
        score += fit * 2 * recency;
        const degree = mod12(chord.root - tonic);
        if (degree === 0) score += mode === "major" ? 2.2 : 2.4;
        if (degree === 7 && (chord.quality === "7" || chord.quality === "maj" || chord.quality === "9")) {
          score += mode === "minor" ? 2.0 : 1.6;
        }
        if (degree === 5) score += 1.0;
        if (mode === "major" && degree === 2 && QUALITIES[chord.quality].minorThird) score += 0.8;
        if (mode === "minor" && degree === 0 && QUALITIES[chord.quality].minorThird) score += 1.4;
        if (mode === "major" && degree === 0 && !QUALITIES[chord.quality].minorThird) score += 1.0;
      });
      // The first and last chords of a progression usually anchor the key.
      const first = chords[0];
      const last = chords[chords.length - 1];
      if (mod12(last.root - tonic) === 0) score += 2.5;
      if (mod12(first.root - tonic) === 0) score += 1.5;
      if (!best || score > best.score) best = { key, score };
    }
  }
  return best ? best.key : { tonic: 0, mode: "major" };
}

// ---------------------------------------------------------------------------
// Chord symbol parsing, for typed input and presets.
// ---------------------------------------------------------------------------

/**
 * Chord suffix spellings. These are matched case sensitively on purpose:
 * "M7" is a major seventh and "m7" is a minor seventh, and a case insensitive
 * match would silently turn every Dm7 into a Dmaj7.
 */
const SYMBOL_ALIASES: Array<[RegExp, Quality]> = [
  [/^(maj9|Maj9|MAJ9|M9|ma9|Ma9|\u039419|\u25b39)$/, "maj9"],
  [/^(maj7|Maj7|MAJ7|M7|ma7|Ma7|\u03947|\u25b37|\u0394|\u25b3)$/, "maj7"],
  [/^(m9|min9|Min9|MIN9|-9)$/, "m9"],
  [/^(m7b5|min7b5|Min7b5|M7b5|\u00f8|\u00d8|half-dim|m7-5)$/, "m7b5"],
  [/^(m7|min7|Min7|MIN7|-7)$/, "m7"],
  [/^(m6|min6|Min6|-6)$/, "m6"],
  [/^(dim7|Dim7|DIM7|o7|\u00b07)$/, "dim7"],
  [/^(dim|Dim|DIM|o|\u00b0)$/, "dim"],
  [/^(aug|Aug|AUG|\+|#5)$/, "aug"],
  [/^(sus4|Sus4|SUS4|sus|Sus|SUS)$/, "sus4"],
  [/^(sus2|Sus2|SUS2)$/, "sus2"],
  [/^(m|min|Min|MIN|-)$/, "min"],
  [/^(M|maj|Maj|MAJ|ma|Ma)$/, "maj"],
  [/^9$/, "9"],
  [/^7$/, "7"],
  [/^6$/, "6"],
  [/^$/, "maj"],
  // Extensions and alterations we do not model separately: keep the chord
  // rather than dropping it, using the closest quality we do have.
  [/^(11|13|7sus4|7sus|7b9|7#9|7#5|7b5|7alt|alt|9#11|9b13)$/, "7"],
  [/^(m11|m13|min11|min13|-11|-13)$/, "m9"],
  [/^(maj11|maj13|M11|M13|maj7#11|6\/9|69)$/, "maj9"],
  [/^(add9|add2|2|maj add9)$/, "maj"],
  [/^(mmaj7|mM7|m\+7|minmaj7)$/, "m7"],
];

export function parseChord(text: string): Chord | null {
  const trimmed = text.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const match = trimmed.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const letterIndex = LETTER_NAMES.indexOf(letter);
  if (letterIndex < 0) return null;
  const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const root = mod12(LETTER_PITCH[letterIndex] + alter);
  // A slash bass note does not change the chord quality for our purposes.
  const rest = match[3].split("/")[0].trim();
  for (const [pattern, quality] of SYMBOL_ALIASES) {
    if (pattern.test(rest)) return { root, quality };
  }
  // Anything else still names a chord to someone. Read the minor/major flag
  // off the front of the suffix rather than throwing the bar away.
  if (/^(m|min|-)/.test(rest) && !/^ma/.test(rest)) {
    return { root, quality: /7|9|11|13/.test(rest) ? "m7" : "min" };
  }
  if (/7|9|11|13/.test(rest)) return { root, quality: /maj|M7|\u0394|\u25b3/.test(rest) ? "maj7" : "7" };
  return { root, quality: "maj" };
}

export function parseProgression(text: string): Chord[] {
  return text
    .split(/[\s,|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token !== "-" && token !== "%")
    .map(parseChord)
    .filter((chord): chord is Chord => chord !== null);
}
