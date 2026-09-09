import {
  DIFFICULTIES,
  Difficulty,
  STYLES,
  StyleId,
  barLength,
  fingering,
  generateAccompaniment,
  isPlayableDoubleStop,
  rangeFor,
} from "../generate";
import { inferKey, parseProgression } from "../theory";

const PROGRESSION = parseProgression("Dm7 G7 Cmaj7 A7 Dm7 G7 Cmaj7 Cmaj7");
const KEY = inferKey(PROGRESSION);
const STYLE_IDS: StyleId[] = STYLES.map((style) => style.id);
const LEVELS: Difficulty[] = DIFFICULTIES.map((entry) => entry.id);

describe("generated parts", () => {
  STYLE_IDS.forEach((style) => {
    LEVELS.forEach((difficulty) => {
      [3, 4, 6].forEach((beatsPerBar) => {
        it(`${style} / ${difficulty} / ${beatsPerBar}-4 is playable`, () => {
          for (let seed = 1; seed <= 8; seed++) {
            const bars = generateAccompaniment({
              progression: PROGRESSION,
              key: KEY,
              difficulty,
              style,
              beatsPerBar,
              seed,
              allowDoubleStops: true,
              firstPositionOnly: false,
            });
            expect(bars).toHaveLength(PROGRESSION.length);
            const [low, high] = rangeFor(difficulty, false);

            bars.forEach((bar) => {
              // Every bar has to be exactly full or the part will not line up
              // with the piano.
              expect(barLength(bar)).toBeCloseTo(beatsPerBar, 3);
              expect(bar.notes.some((note) => note.midi !== null)).toBe(true);

              bar.notes.forEach((note) => {
                if (note.midi === null) return;
                expect(note.midi).toBeGreaterThanOrEqual(low);
                expect(note.midi).toBeLessThanOrEqual(high);
                if (note.double !== undefined) {
                  expect(isPlayableDoubleStop(note.double, note.midi)).toBe(true);
                }
              });
            });
          }
        });
      });
    });
  });

  it("keeps the part in first position when asked", () => {
    LEVELS.forEach((difficulty) => {
      const bars = generateAccompaniment({
        progression: PROGRESSION,
        key: KEY,
        difficulty,
        style: "arpeggio",
        beatsPerBar: 4,
        seed: 5,
        allowDoubleStops: false,
        firstPositionOnly: true,
      });
      bars.forEach((bar) =>
        bar.notes.forEach((note) => {
          if (note.midi === null) return;
          const finger = fingering(note.midi, true);
          expect(finger).not.toBeNull();
          expect(finger!.position).toBe(1);
        })
      );
    });
  });

  it("writes no double stops when they are turned off", () => {
    const bars = generateAccompaniment({
      progression: PROGRESSION,
      key: KEY,
      difficulty: "advanced",
      style: "drone",
      beatsPerBar: 4,
      seed: 2,
      allowDoubleStops: false,
      firstPositionOnly: false,
    });
    bars.forEach((bar) => bar.notes.forEach((note) => expect(note.double).toBeUndefined()));
  });
});

describe("fingerings", () => {
  it("finds a place for every note in the violin's range", () => {
    for (let midi = 55; midi <= 96; midi++) {
      expect(fingering(midi)).not.toBeNull();
    }
  });

  it("names the open strings", () => {
    expect(fingering(55)).toMatchObject({ string: "G", finger: 0, open: true });
    expect(fingering(69)).toMatchObject({ string: "A", finger: 0, open: true });
  });

  it("only allows double stops the bow can actually reach", () => {
    expect(isPlayableDoubleStop(62, 69)).toBe(true); // open D under open A
    expect(isPlayableDoubleStop(64, 71)).toBe(true); // E4 on the D string, B4 on the A
    expect(isPlayableDoubleStop(69, 74)).toBe(true); // A4 on the D string, D5 on the A
    expect(isPlayableDoubleStop(60, 61)).toBe(false); // C4 and C sharp 4 share a string
    expect(isPlayableDoubleStop(55, 76)).toBe(false); // open G to E5 is two strings apart
    expect(isPlayableDoubleStop(74, 62)).toBe(false); // wrong way round
  });
});
