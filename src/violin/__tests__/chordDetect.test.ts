import { computeBassChroma, computeChroma, matchChord } from "../chordDetect";
import { Key, chordName, midiToFreq, parseChord } from "../theory";

const SAMPLE_RATE = 44100;
const FFT_SIZE = 16384;
const C_MAJOR: Key = { tonic: 0, mode: "major" };
const B_FLAT: Key = { tonic: 10, mode: "major" };

/** A rough piano spectrum: each note with six harmonics and a noise floor. */
function spectrumFor(midis: number[]): Float32Array {
  const bins = FFT_SIZE / 2;
  const spectrum = new Float32Array(bins);
  for (let i = 0; i < bins; i++) spectrum[i] = -82 + (i % 7) * 0.6;
  midis.forEach((midi) => {
    const fundamental = midiToFreq(midi);
    for (let harmonic = 1; harmonic <= 6; harmonic++) {
      const bin = Math.round((fundamental * harmonic) / (SAMPLE_RATE / FFT_SIZE));
      if (bin >= bins - 1) break;
      const db = -6 - 9 * Math.log2(harmonic);
      for (let offset = -1; offset <= 1; offset++) {
        const value = db - Math.abs(offset) * 14;
        if (spectrum[bin + offset] < value) spectrum[bin + offset] = value;
      }
    }
  });
  return spectrum;
}

function heard(midis: number[]): string {
  const spectrum = spectrumFor(midis);
  const chroma = computeChroma(spectrum, SAMPLE_RATE, FFT_SIZE);
  const bass = computeBassChroma(spectrum, SAMPLE_RATE, FFT_SIZE);
  const match = matchChord(chroma, bass);
  return match ? chordName(match.chord, C_MAJOR) : "none";
}

describe("chord detection", () => {
  const cases: Array<[string, number[], string]> = [
    ["C major", [48, 52, 55, 64, 67], "C"],
    ["A minor", [45, 52, 57, 60, 64], "Am"],
    ["G7", [43, 50, 53, 59, 62], "G7"],
    ["F major seventh", [41, 48, 52, 57, 60], "Fmaj7"],
    ["D minor seventh", [38, 45, 48, 53, 57], "Dm7"],
    ["A minor seventh", [45, 55, 60, 64, 69], "Am7"],
    ["D suspended fourth", [50, 57, 62, 69, 74], "Dsus4"],
    ["E major seventh", [40, 47, 51, 56, 59], "Emaj7"],
    ["C major in first inversion", [52, 60, 64, 67, 72], "C"],
  ];

  cases.forEach(([name, midis, expected]) => {
    it(`hears ${name}`, () => {
      expect(heard(midis)).toBe(expected);
    });
  });

  it("hears a flat key chord, whatever we choose to call it", () => {
    const spectrum = spectrumFor([46, 53, 58, 62, 65]);
    const match = matchChord(
      computeChroma(spectrum, SAMPLE_RATE, FFT_SIZE),
      computeBassChroma(spectrum, SAMPLE_RATE, FFT_SIZE)
    );
    expect(match).not.toBeNull();
    expect(chordName(match!.chord, B_FLAT)).toBe("Bb");
  });

  it("does not invent a chord out of silence", () => {
    const silence = new Float32Array(FFT_SIZE / 2).fill(-140);
    const chroma = computeChroma(silence, SAMPLE_RATE, FFT_SIZE);
    expect(matchChord(chroma)).toBeNull();
  });

  it("puts the bass note at the top of the bass profile", () => {
    const bass = computeBassChroma(spectrumFor([38, 45, 48, 53, 57]), SAMPLE_RATE, FFT_SIZE);
    const strongest = Array.from(bass).indexOf(Math.max(...Array.from(bass)));
    expect(strongest).toBe(parseChord("D")!.root);
  });
});
