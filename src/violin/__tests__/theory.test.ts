import {
  Key,
  chordName,
  inferKey,
  keyName,
  keySignature,
  parseChord,
  parseProgression,
  spellNote,
} from "../theory";

const C_MAJOR: Key = { tonic: 0, mode: "major" };

describe("chord symbols", () => {
  it("tells a minor seventh from a major seventh", () => {
    // The two differ only by case, so a case insensitive parser silently
    // turns every Dm7 in a chart into a Dmaj7.
    expect(chordName(parseChord("Dm7")!)).toBe("Dm7");
    expect(chordName(parseChord("DM7")!)).toBe("Dmaj7");
    expect(chordName(parseChord("Dmaj7")!)).toBe("Dmaj7");
    expect(chordName(parseChord("Dmin7")!)).toBe("Dm7");
  });

  it("reads the symbols people actually write", () => {
    expect(chordName(parseChord("F#m")!)).toBe("F#m");
    expect(chordName(parseChord("Bb7")!, { tonic: 10, mode: "major" })).toBe("Bb7");
    expect(chordName(parseChord("Am7b5")!)).toBe("Am7b5");
    expect(chordName(parseChord("Csus4")!)).toBe("Csus4");
    expect(chordName(parseChord("C/E")!)).toBe("C");
  });

  it("keeps extended chords instead of dropping the bar", () => {
    expect(chordName(parseChord("G13")!)).toBe("G7");
    expect(chordName(parseChord("Am11")!)).toBe("Am9");
    expect(parseChord("H7")).toBeNull();
  });

  it("splits a typed progression on spaces and bar lines", () => {
    expect(parseProgression("Dm7 | G7 | Cmaj7").map((chord) => chordName(chord))).toEqual([
      "Dm7",
      "G7",
      "Cmaj7",
    ]);
  });
});

describe("key inference", () => {
  it("hears a ii-V-I as its home key", () => {
    expect(keyName(inferKey(parseProgression("Dm7 G7 Cmaj7 Cmaj7")))).toBe("C major");
  });

  it("hears a minor progression as minor", () => {
    expect(inferKey(parseProgression("Am Dm E7 Am")).mode).toBe("minor");
  });

  it("gives the right key signature", () => {
    expect(keySignature({ tonic: 0, mode: "major" })).toBe(0);
    expect(keySignature({ tonic: 3, mode: "major" })).toBe(-3); // E flat major
    expect(keySignature({ tonic: 4, mode: "major" })).toBe(4); // E major
    expect(keySignature({ tonic: 9, mode: "minor" })).toBe(0); // A minor
  });
});

describe("note spelling", () => {
  it("spells notes the way the key writes them", () => {
    expect(spellNote(63, { tonic: 3, mode: "major" }).name).toBe("Eb4");
    expect(spellNote(66, { tonic: 4, mode: "major" }).name).toBe("F#4");
    expect(spellNote(60, C_MAJOR).name).toBe("C4");
  });

  it("never reaches for a double accidental or a B sharp", () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ["major", "minor"] as const) {
        for (let midi = 55; midi <= 96; midi++) {
          const spelled = spellNote(midi, { tonic, mode });
          expect(Math.abs(spelled.alter)).toBeLessThanOrEqual(1);
          expect(spelled.name).not.toMatch(/^B#|^Cb/);
        }
      }
    }
  });

  it("puts middle C one ledger line below the treble staff", () => {
    // The bottom line of a treble staff is E4, two staff steps above C4.
    expect(spellNote(64, C_MAJOR).diatonic - spellNote(60, C_MAJOR).diatonic).toBe(2);
  });
});
