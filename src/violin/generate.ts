/**
 * Generates the violin part: given a chord progression, a key, a difficulty
 * and a style, produce bars of notes with fingering hints.
 *
 * Generation is deterministic for a given seed so the notation does not
 * reshuffle itself while a player is reading it. "Reroll" bumps the seed.
 */

import {
  Chord,
  ChordScale,
  Key,
  chordIntervals,
  chordName,
  chordScale,
  guideTones,
  mod12,
  noteLabel,
} from "./theory";

export type Difficulty = "simple" | "intermediate" | "advanced";
export type StyleId = "pad" | "arpeggio" | "counter" | "cross" | "drone" | "chop";

export interface StyleInfo {
  id: StyleId;
  name: string;
  blurb: string;
}

export const STYLES: StyleInfo[] = [
  { id: "pad", name: "Long tones", blurb: "Held chord tones under the piano. Safest thing in a jam." },
  { id: "arpeggio", name: "Arpeggio", blurb: "Broken chords that spell the harmony as it moves." },
  { id: "counter", name: "Counter-melody", blurb: "A singing line that answers the tune, voice-led between chords." },
  { id: "cross", name: "Cross-melody", blurb: "Call and response. You play in the gaps, off the beat." },
  { id: "drone", name: "Drone & double stops", blurb: "Open string under the melody. Fiddle-tune sound." },
  { id: "chop", name: "Pizz / chop groove", blurb: "Percussive off-beat stabs. Holds the groove down." },
];

export const DIFFICULTIES: Array<{ id: Difficulty; name: string; blurb: string }> = [
  { id: "simple", name: "Simple", blurb: "Whole and half notes, chord tones, first position." },
  { id: "intermediate", name: "Intermediate", blurb: "Eighths, passing tones, some double stops." },
  { id: "advanced", name: "Advanced", blurb: "Sixteenths, extensions, chromatic approach, position shifts." },
];

export interface PartNote {
  /** null is a rest. */
  midi: number | null;
  /** Lower note of a double stop, when present. */
  double?: number;
  beats: number;
  pizz?: boolean;
  accent?: boolean;
  tie?: boolean;
}

export interface Bar {
  index: number;
  chord: Chord;
  notes: PartNote[];
  beats: number;
  /** Plain language reminder for the jam view. */
  hint: string;
  scaleName: string;
}

export interface GenerateOptions {
  progression: Chord[];
  key: Key;
  difficulty: Difficulty;
  style: StyleId;
  beatsPerBar: number;
  seed: number;
  allowDoubleStops: boolean;
  firstPositionOnly: boolean;
}

// --- Violin geometry -------------------------------------------------------

export const OPEN_STRINGS = [
  { name: "G", midi: 55 },
  { name: "D", midi: 62 },
  { name: "A", midi: 69 },
  { name: "E", midi: 76 },
];

export const LOWEST_NOTE = 55; // open G
const HAND_SHIFTS = [0, 5, 9, 14]; // 1st, 3rd, 5th and 7th position

export interface Fingering {
  string: string;
  finger: number;
  position: number;
  open: boolean;
}

/** Where a note sits under the hand: string, finger and position. */
export function fingering(midi: number, firstPositionOnly = false): Fingering | null {
  const shifts = firstPositionOnly ? [0] : HAND_SHIFTS;
  let best: Fingering | null = null;
  for (let s = OPEN_STRINGS.length - 1; s >= 0; s--) {
    const offset = midi - OPEN_STRINGS[s].midi;
    if (offset < 0) continue;
    for (const shift of shifts) {
      const local = offset - shift;
      if (local < 0 || local > 7) continue;
      const finger = local === 0 ? (shift === 0 ? 0 : 1) : local <= 2 ? 1 : local <= 4 ? 2 : local <= 6 ? 3 : 4;
      const position = shift === 0 ? 1 : shift === 5 ? 3 : shift === 9 ? 5 : 7;
      const candidate: Fingering = {
        string: OPEN_STRINGS[s].name,
        finger,
        position,
        open: offset === 0,
      };
      // Prefer the lowest position, then the highest string that reaches it.
      if (!best || position < best.position) best = candidate;
      break;
    }
    if (best && best.position === 1) break;
  }
  return best;
}

/**
 * Whether two notes can actually be bowed together: they have to sit on
 * neighbouring strings with the hand in one position.
 */
export function isPlayableDoubleStop(low: number, high: number): boolean {
  if (high <= low) return false;
  for (let i = 0; i < OPEN_STRINGS.length - 1; i++) {
    const lowOffset = low - OPEN_STRINGS[i].midi;
    const highOffset = high - OPEN_STRINGS[i + 1].midi;
    if (lowOffset < 0 || highOffset < 0) continue;
    for (const shift of HAND_SHIFTS) {
      if (
        lowOffset >= shift &&
        lowOffset <= shift + 7 &&
        highOffset >= shift &&
        highOffset <= shift + 7
      ) {
        return true;
      }
    }
  }
  return false;
}

export function rangeFor(difficulty: Difficulty, firstPositionOnly: boolean): [number, number] {
  if (firstPositionOnly) return [LOWEST_NOTE, 83];
  if (difficulty === "simple") return [LOWEST_NOTE, 79];
  if (difficulty === "intermediate") return [LOWEST_NOTE, 88];
  return [LOWEST_NOTE, 96];
}

// --- Small deterministic random --------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (...values: number[]): number =>
  values.reduce((acc, value) => Math.imul(acc ^ (value + 0x9e3779b9), 0x85ebca6b) >>> 0, 0x811c9dc5);

const pick = <T,>(rand: () => number, items: T[]): T => items[Math.floor(rand() * items.length) % items.length];

/**
 * Fills a bar exactly, choosing from a weighted vocabulary of note values.
 * Repeat a value in `units` to make it more likely. Sixteenths are emitted in
 * pairs so the beams stay readable and the line stays playable.
 */
function buildRhythm(beats: number, rand: () => number, units: number[]): number[] {
  const out: number[] = [];
  let remaining = beats;
  let guard = 0;
  while (remaining > 0.001 && guard++ < 64) {
    const options = units.filter((unit) => unit <= remaining + 1e-6);
    if (options.length === 0) {
      out.push(Number(remaining.toFixed(3)));
      break;
    }
    const choice = pick(rand, options);
    if (choice === 0.25 && remaining >= 0.5 - 1e-6) {
      out.push(0.25);
      remaining = Number((remaining - 0.25).toFixed(3));
    }
    out.push(choice);
    remaining = Number((remaining - choice).toFixed(3));
  }
  return out;
}

// --- Pitch helpers ---------------------------------------------------------

function clampToRange(midi: number, [lo, hi]: [number, number]): number {
  let out = midi;
  while (out < lo) out += 12;
  while (out > hi) out -= 12;
  return Math.max(lo, Math.min(hi, out));
}

/** The instance of a pitch class closest to `target`, kept inside the range. */
function nearestPitch(pc: number, target: number, range: [number, number]): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let midi = range[0]; midi <= range[1]; midi++) {
    if (mod12(midi) !== mod12(pc)) continue;
    const distance = Math.abs(midi - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = midi;
    }
  }
  return best >= 0 ? best : clampToRange(pc, range);
}

function scaleNotes(scale: ChordScale, range: [number, number]): number[] {
  const notes: number[] = [];
  for (let midi = range[0]; midi <= range[1]; midi++) {
    if (scale.pcs.includes(mod12(midi))) notes.push(midi);
  }
  return notes;
}

function chordTones(chord: Chord, range: [number, number]): number[] {
  const pcs = chordIntervals(chord).map((i) => mod12(chord.root + i));
  const notes: number[] = [];
  for (let midi = range[0]; midi <= range[1]; midi++) {
    if (pcs.includes(mod12(midi))) notes.push(midi);
  }
  return notes;
}

function nearestIndex(notes: number[], midi: number): number {
  let best = 0;
  let bestDistance = Infinity;
  notes.forEach((note, index) => {
    const distance = Math.abs(note - midi);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * Walks from one note to another through a scale in a fixed number of steps,
 * filling any spare steps with neighbour tones instead of repeats.
 */
function melodicPath(
  notes: number[],
  startMidi: number,
  targetMidi: number,
  count: number,
  rand: () => number
): number[] {
  if (notes.length === 0 || count <= 0) return [];
  const startIndex = nearestIndex(notes, startMidi);
  const endIndex = nearestIndex(notes, targetMidi);
  const out: number[] = [];
  let index = startIndex;
  for (let i = 0; i < count; i++) {
    const remaining = count - i;
    const gap = endIndex - index;
    if (Math.abs(gap) >= remaining) {
      index += Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) / remaining));
    } else if (Math.abs(gap) === 0) {
      index += rand() < 0.5 ? 1 : -1; // turn around the target
    } else {
      // Spare room: wander a little before landing.
      const wander = rand() < 0.6 ? Math.sign(gap) : -Math.sign(gap) || 1;
      index += wander;
    }
    index = Math.max(0, Math.min(notes.length - 1, index));
    out.push(notes[index]);
  }
  if (out.length > 0) out[out.length - 1] = notes[Math.max(0, Math.min(notes.length - 1, endIndex))];
  return out;
}

/** A chromatic or scalar approach note a step below or above a target. */
function approachNote(target: number, scale: ChordScale, rand: () => number): number {
  if (rand() < 0.5) return target - 1;
  const below = scale.pcs.includes(mod12(target - 2)) ? target - 2 : target - 1;
  return rand() < 0.5 ? below : target + 1;
}

function doubleStopBelow(midi: number, chord: Chord, range: [number, number]): number | undefined {
  // A third or a sixth below, whichever is a chord tone and actually reachable.
  const tones = chordIntervals(chord).map((i) => mod12(chord.root + i));
  for (const interval of [3, 4, 8, 9, 7, 5]) {
    const candidate = midi - interval;
    if (candidate < range[0]) continue;
    if (!tones.includes(mod12(candidate))) continue;
    if (!isPlayableDoubleStop(candidate, midi)) continue;
    return candidate;
  }
  return undefined;
}

/**
 * Picks the open string to drone under the melody. Low strings only: the
 * drone has to sit below the tune with room to spare, and the E string leaves
 * none.
 */
function droneString(chord: Chord, key: Key, range: [number, number]): number {
  const usable = OPEN_STRINGS.filter((string) => string.midi + 5 <= range[1]);
  const candidates = usable.length > 0 ? usable : [OPEN_STRINGS[0]];
  const chordPcs = chordIntervals(chord).map((i) => mod12(chord.root + i));
  const fits = candidates.filter((string) => chordPcs.includes(mod12(string.midi)));
  if (fits.length > 0) return fits[fits.length - 1].midi;
  const keyFits = candidates.filter(
    (string) => mod12(string.midi) === mod12(key.tonic) || mod12(string.midi) === mod12(key.tonic + 7)
  );
  if (keyFits.length > 0) return keyFits[keyFits.length - 1].midi;
  return candidates[Math.min(1, candidates.length - 1)].midi;
}

// --- Style writers ---------------------------------------------------------

interface BarContext {
  chord: Chord;
  next: Chord;
  key: Key;
  scale: ChordScale;
  range: [number, number];
  beats: number;
  difficulty: Difficulty;
  allowDoubleStops: boolean;
  firstPositionOnly: boolean;
  previous: number | null;
  rand: () => number;
  barIndex: number;
}

type Writer = (ctx: BarContext) => { notes: PartNote[]; hint: string };

/**
 * Where the next bar should sit. Following the previous note exactly lets the
 * line drift into the cellar over a long form, so pull it gently back toward a
 * comfortable register each bar.
 */
function centre(ctx: BarContext): number {
  const ideal = ctx.difficulty === "simple" ? 69 : 73;
  if (ctx.previous === null) return ideal;
  return Math.round(ctx.previous * 0.7 + ideal * 0.3);
}

const writePad: Writer = (ctx) => {
  const { chord, key, range, beats, rand } = ctx;
  const target = centre(ctx);
  const tones = guideTones(chord);
  const root = mod12(chord.root);
  const fifth = mod12(chord.root + 7);

  if (ctx.difficulty === "simple") {
    const pc = rand() < 0.6 ? root : fifth;
    const midi = nearestPitch(pc, target, range);
    return {
      notes: [{ midi, beats }],
      hint: `Hold ${noteLabel(midi, key)} — the ${pc === root ? "root" : "5th"} of ${chordName(chord, key)}. Bow slow, listen.`,
    };
  }

  if (ctx.difficulty === "intermediate") {
    const first = nearestPitch(tones[0], target, range);
    const second = nearestPitch(tones[tones.length - 1], first, range);
    return {
      notes: [
        { midi: first, beats: beats / 2 },
        { midi: second, beats: beats / 2 },
      ],
      hint: `Guide tones: ${noteLabel(first, key)} then ${noteLabel(second, key)}. These two spell the chord.`,
    };
  }

  const top = nearestPitch(tones[0], Math.max(target, 74), range);
  const under = ctx.allowDoubleStops ? doubleStopBelow(top, chord, range) : undefined;
  const moving = nearestPitch(mod12(chord.root + (chord.quality.startsWith("m") ? 10 : 9)), top, range);
  return {
    notes: [
      { midi: top, double: under, beats: beats / 2 },
      { midi: moving, beats: beats / 4 },
      { midi: nearestPitch(tones[tones.length - 1], moving, range), beats: beats / 4 },
    ],
    hint: `Sustain ${noteLabel(top, key)}${under ? ` over ${noteLabel(under, key)}` : ""}, then colour it with the 6th/7th.`,
  };
};

const writeArpeggio: Writer = (ctx) => {
  const { chord, key, range, beats, rand, difficulty } = ctx;
  const tones = chordTones(chord, range);
  const start = tones[nearestIndex(tones, centre(ctx))];
  const notes: PartNote[] = [];

  const step = difficulty === "simple" ? 1 : difficulty === "intermediate" ? 0.5 : 0.25;
  const count = Math.round(beats / step);
  let index = nearestIndex(tones, start);
  let direction = rand() < 0.5 ? 1 : -1;

  for (let i = 0; i < count; i++) {
    const midi = tones[Math.max(0, Math.min(tones.length - 1, index))];
    notes.push({ midi, beats: step, accent: i % Math.round(1 / step) === 0 });
    let next = index + direction;
    if (difficulty === "advanced" && rand() < 0.22) {
      // Slip in the 9th or 13th for colour.
      const colour = mod12(chord.root + (rand() < 0.5 ? 2 : 9));
      const coloured = nearestPitch(colour, tones[Math.max(0, Math.min(tones.length - 1, index))], range);
      notes[notes.length - 1] = { midi: coloured, beats: step };
    }
    if (next < 0 || next > tones.length - 1) {
      direction *= -1;
      next = index + direction;
    }
    index = next;
  }

  const label = difficulty === "simple" ? "Quarter notes" : difficulty === "intermediate" ? "Eighths" : "Sixteenths";
  return {
    notes,
    hint: `${label} up and down ${chordName(chord, key)}. Keep the bow even, land the root on beat 1.`,
  };
};

const writeCounter: Writer = (ctx) => {
  const { chord, next, key, scale, range, beats, rand, difficulty } = ctx;
  const notes = scaleNotes(scale, range);
  const start = centre(ctx);
  const targetPc = guideTones(next)[0];
  const target = nearestPitch(targetPc, start, range);

  if (difficulty === "simple") {
    const first = nearestPitch(guideTones(chord)[0], start, range);
    const second = nearestPitch(mod12(chord.root + 7), first, range);
    return {
      notes: [
        { midi: first, beats: beats / 2 },
        { midi: second, beats: beats / 2 },
      ],
      hint: `Two notes: ${noteLabel(first, key)} then ${noteLabel(second, key)}. Move only when the piano moves.`,
    };
  }

  if (difficulty === "intermediate") {
    const rhythm = buildRhythm(beats, rand, [2, 1.5, 1, 1, 1, 0.5, 0.5]);
    const path = melodicPath(notes, start, target, rhythm.length, rand);
    return {
      notes: rhythm.map((duration, i) => ({ midi: path[i] ?? target, beats: duration })),
      hint: `Sing it. Land on ${noteLabel(target, key)} as ${chordName(next, key)} arrives.`,
    };
  }

  const rhythm = buildRhythm(beats, rand, [2, 1.5, 1, 1, 0.75, 0.5, 0.5, 0.5, 0.25]);
  const path = melodicPath(notes, start, target, rhythm.length, rand);
  const out: PartNote[] = rhythm.map((duration, i) => ({ midi: path[i] ?? target, beats: duration }));
  // A breath at the top of the bar keeps a busy line from sounding like an exercise.
  if (out.length > 3 && rand() < 0.4) out[0] = { midi: null, beats: out[0].beats };
  const approachIndex = out.length - 2;
  if (approachIndex > 0 && rand() < 0.6) {
    const last = out[out.length - 1];
    if (last.midi !== null && out[approachIndex].midi !== null) {
      out[approachIndex] = { ...out[approachIndex], midi: approachNote(last.midi, scale, rand) };
    }
  }
  return {
    notes: out,
    hint: `${scale.name} over ${chordName(chord, key)}, leaning into ${noteLabel(target, key)} for the change.`,
  };
};

const writeCross: Writer = (ctx) => {
  const { chord, key, scale, range, beats, rand, difficulty, barIndex } = ctx;
  const tones = chordTones(chord, range);
  const start = tones[nearestIndex(tones, centre(ctx))];
  const answering = barIndex % 2 === 1;

  if (difficulty === "simple") {
    const rest = beats / 2;
    const first = start;
    const second = nearestPitch(guideTones(chord)[0], first, range);
    return {
      notes: [
        { midi: null, beats: rest },
        { midi: first, beats: rest / 2, accent: true },
        { midi: second, beats: rest / 2 },
      ],
      hint: `Rest for two beats, then answer with ${noteLabel(first, key)}–${noteLabel(second, key)}.`,
    };
  }

  if (difficulty === "intermediate") {
    const lead = answering ? 1 : 1.5;
    const rhythm = buildRhythm(Math.max(0.5, beats - lead), rand, [1, 1, 0.5, 0.5, 1.5]);
    const line = scaleNotes(scale, range);
    let index = nearestIndex(line, start);
    const notes: PartNote[] = [{ midi: null, beats: lead }];
    let filled = lead;
    rhythm.forEach((duration) => {
      notes.push({ midi: line[index], beats: duration, accent: Math.abs((filled % 1) - 0.5) < 0.01 });
      index = Math.max(0, Math.min(line.length - 1, index + (rand() < 0.6 ? 1 : -1)));
      filled += duration;
    });
    return {
      notes,
      hint: "Come in off the beat. Push against the piano, do not double it.",
    };
  }

  const line = scaleNotes(scale, range);
  let index = nearestIndex(line, start);
  const rhythm = buildRhythm(beats, rand, [1, 0.75, 0.5, 0.5, 0.5, 0.25]);
  let position = 0;
  const notes: PartNote[] = rhythm.map((duration) => {
    // Rests cluster at the start of the bar: the piano gets the downbeat.
    const isRest = rand() < (position < 1 ? 0.6 : 0.18);
    const note: PartNote = {
      midi: isRest ? null : line[index],
      beats: duration,
      accent: !isRest && (position % 1) > 0.24,
    };
    if (!isRest) index = Math.max(0, Math.min(line.length - 1, index + (rand() < 0.55 ? 1 : -2)));
    position += duration;
    return note;
  });
  if (notes.every((note) => note.midi === null) && notes.length > 0) {
    notes[notes.length - 1] = { ...notes[notes.length - 1], midi: start };
  }
  return {
    notes,
    hint: "Syncopated answer. Leave holes — the piano fills them.",
  };
};

const writeDrone: Writer = (ctx) => {
  const { chord, key, scale, range, beats, rand, difficulty } = ctx;
  const drone = droneString(chord, key, range);
  // The melody must stay clear of the drone but within reach of it: two
  // strings can only be bowed together when they are next to each other, so
  // the tune sits on the string above the drone.
  const upper: [number, number] = [drone + 7, drone + 14];
  const line = scaleNotes(scale, upper);
  const start = line.length > 0 ? line[nearestIndex(line, Math.max(centre(ctx), drone + 3))] : drone + 12;

  if (difficulty === "simple") {
    return {
      notes: [{ midi: start, double: ctx.allowDoubleStops ? drone : undefined, beats }],
      hint: `Let the open ${OPEN_STRINGS.find((s) => s.midi === drone)?.name ?? "D"} string ring under ${noteLabel(start, key)}.`,
    };
  }

  const step = difficulty === "intermediate" ? 1 : 0.5;
  const count = Math.round(beats / step);
  const path = melodicPath(line, start, nearestPitch(guideTones(chord)[0], start, upper), count, rand);
  return {
    notes: path.map((midi, i) => ({
      midi,
      double: ctx.allowDoubleStops && i % 2 === 0 ? drone : undefined,
      beats: step,
    })),
    hint: `Melody on top, open ${OPEN_STRINGS.find((s) => s.midi === drone)?.name ?? "D"} droning underneath. Keep the bow flat across both strings.`,
  };
};

const writeChop: Writer = (ctx) => {
  const { chord, key, range, beats, rand, difficulty } = ctx;
  const root = nearestPitch(chord.root, Math.min(centre(ctx), 72), range);
  const fifth = nearestPitch(mod12(chord.root + 7), root, range);
  const third = nearestPitch(guideTones(chord)[0], root, range);

  if (difficulty === "simple") {
    const notes: PartNote[] = [];
    for (let beat = 0; beat < beats; beat++) {
      const onBackbeat = beat % 2 === 1;
      notes.push(
        onBackbeat
          ? {
              midi: root,
              double: ctx.allowDoubleStops ? doubleStopBelow(root, chord, range) : undefined,
              beats: 1,
              pizz: true,
              accent: true,
            }
          : { midi: null, beats: 1 }
      );
    }
    return { notes, hint: `Pizzicato ${noteLabel(root, key)} on 2 and 4. That is the whole job — keep it tight.` };
  }

  if (difficulty === "intermediate") {
    const notes: PartNote[] = [];
    let beat = 0;
    while (beat < beats - 0.01) {
      const onBackbeat = Math.floor(beat) % 2 === 1;
      if (onBackbeat) {
        notes.push({ midi: third, double: ctx.allowDoubleStops ? root : undefined, beats: 0.5, pizz: true, accent: true });
        notes.push({ midi: fifth, beats: 0.5, pizz: true });
      } else {
        notes.push({ midi: null, beats: 0.5 });
        notes.push({ midi: root, beats: 0.5, pizz: true });
      }
      beat += 1;
    }
    return { notes, hint: `Backbeat chop with a pickup into 2 and 4. Mute the ring with the left hand.` };
  }

  const notes: PartNote[] = [];
  let filled = 0;
  const palette = [root, third, fifth];
  while (filled < beats - 0.01) {
    const remaining = beats - filled;
    const duration = Math.min(rand() < 0.6 ? 0.25 : 0.5, remaining);
    const beatPosition = filled % 1;
    const isRest = beatPosition < 0.2 && rand() < 0.5;
    const midi = pick(rand, palette);
    notes.push({
      midi: isRest ? null : midi,
      double: !isRest && ctx.allowDoubleStops && rand() < 0.4 ? doubleStopBelow(midi, chord, range) : undefined,
      beats: duration,
      pizz: true,
      accent: !isRest && beatPosition > 0.4,
    });
    filled += duration;
  }
  return { notes, hint: `Sixteenth-note chop. Ghost the weak ones, snap 2 and 4.` };
};

const WRITERS: Record<StyleId, Writer> = {
  pad: writePad,
  arpeggio: writeArpeggio,
  counter: writeCounter,
  cross: writeCross,
  drone: writeDrone,
  chop: writeChop,
};

/** Last sounding pitch of a bar, used to voice-lead into the next one. */
function lastPitch(notes: PartNote[]): number | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    if (notes[i].midi !== null) return notes[i].midi;
  }
  return null;
}

export function generateAccompaniment(options: GenerateOptions): Bar[] {
  const { progression, key, difficulty, style, beatsPerBar, seed, allowDoubleStops, firstPositionOnly } = options;
  if (progression.length === 0) return [];
  const range = rangeFor(difficulty, firstPositionOnly);
  const bars: Bar[] = [];
  let previous: number | null = null;

  progression.forEach((chord, index) => {
    const next = progression[(index + 1) % progression.length];
    const scale = chordScale(chord, key);
    const rand = mulberry32(hash(seed, index, chord.root, style.length, difficulty.length));
    const ctx: BarContext = {
      chord,
      next,
      key,
      scale,
      range,
      beats: beatsPerBar,
      difficulty,
      allowDoubleStops,
      firstPositionOnly,
      previous,
      rand,
      barIndex: index,
    };
    const written = WRITERS[style](ctx);
    const notes = written.notes
      .filter((note) => note.beats > 0.001)
      .map((note) => {
        const midi = note.midi === null ? null : clampToRange(note.midi, range);
        let double = note.double === undefined ? undefined : clampToRange(note.double, range);
        // Drop any double stop the clamping made unreachable.
        if (double !== undefined && (midi === null || !isPlayableDoubleStop(double, midi))) double = undefined;
        return { ...note, midi, double };
      });
    previous = lastPitch(notes) ?? previous;
    bars.push({
      index,
      chord,
      notes,
      beats: beatsPerBar,
      hint: written.hint,
      scaleName: scale.name,
    });
  });

  return bars;
}

/**
 * Pitch classes that belong to the most chords in a progression: the notes a
 * player can lean on when they lose the changes.
 */
export function commonTones(progression: Chord[]): number[] {
  const counts = new Array(12).fill(0);
  progression.forEach((chord) => {
    chordIntervals(chord).forEach((interval, index) => {
      counts[mod12(chord.root + interval)] += index === 0 ? 1 : index === 1 ? 1.2 : 1;
    });
  });
  return counts
    .map((count, pc) => ({ count, pc }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((entry) => entry.pc);
}

/** Total beats actually written into a bar, for sanity checks and playback. */
export function barLength(bar: Bar): number {
  return bar.notes.reduce((total, note) => total + note.beats, 0);
}
