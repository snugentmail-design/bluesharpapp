/**
 * MusicXML export, so the part can be opened in MuseScore, Sibelius, Finale
 * or anything else that reads sheet music.
 */

import { Bar, fingering } from "./generate";
import { Key, chordName, keySignature, spellNote, LETTER_NAMES } from "./theory";

const DIVISIONS = 8; // per quarter note, enough for dotted sixteenths

const TYPE_NAMES: Array<{ beats: number; type: string; dots: number }> = [
  { beats: 4, type: "whole", dots: 0 },
  { beats: 3, type: "half", dots: 1 },
  { beats: 2, type: "half", dots: 0 },
  { beats: 1.5, type: "quarter", dots: 1 },
  { beats: 1, type: "quarter", dots: 0 },
  { beats: 0.75, type: "eighth", dots: 1 },
  { beats: 0.5, type: "eighth", dots: 0 },
  { beats: 0.375, type: "16th", dots: 1 },
  { beats: 0.25, type: "16th", dots: 0 },
];

function noteType(beats: number): { type: string; dots: number } {
  let best = TYPE_NAMES[TYPE_NAMES.length - 1];
  let bestDistance = Infinity;
  for (const entry of TYPE_NAMES) {
    const distance = Math.abs(entry.beats - beats);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return { type: best.type, dots: best.dots };
}

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toMusicXml(
  bars: Bar[],
  musicKey: Key,
  beatsPerBar: number,
  title: string,
  tempo: number
): string {
  const fifths = keySignature(musicKey);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<score-partwise version="3.1">');
  lines.push(`  <work><work-title>${escape(title)}</work-title></work>`);
  lines.push("  <identification><encoding><software>Jam Fiddle</software></encoding></identification>");
  lines.push('  <part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>');
  lines.push('  <part id="P1">');

  bars.forEach((bar, index) => {
    lines.push(`    <measure number="${index + 1}">`);
    if (index === 0) {
      lines.push("      <attributes>");
      lines.push(`        <divisions>${DIVISIONS}</divisions>`);
      lines.push(`        <key><fifths>${fifths}</fifths><mode>${musicKey.mode}</mode></key>`);
      lines.push(`        <time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time>`);
      lines.push("        <clef><sign>G</sign><line>2</line></clef>");
      lines.push("      </attributes>");
      lines.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(tempo)}</per-minute></metronome></direction-type><sound tempo="${Math.round(tempo)}"/></direction>`);
    }

    const symbol = chordName(bar.chord, musicKey);
    const rootStep = LETTER_NAMES[spellNote(60 + bar.chord.root, musicKey).letter];
    const rootAlter = spellNote(60 + bar.chord.root, musicKey).alter;
    lines.push("      <harmony>");
    lines.push(`        <root><root-step>${rootStep}</root-step>${rootAlter !== 0 ? `<root-alter>${rootAlter}</root-alter>` : ""}</root>`);
    lines.push(`        <kind text="${escape(symbol)}">other</kind>`);
    lines.push("      </harmony>");

    let firstPizz = true;
    bar.notes.forEach((note) => {
      const { type, dots } = noteType(note.beats);
      const duration = Math.max(1, Math.round(note.beats * DIVISIONS));
      if (note.midi === null) {
        lines.push("      <note>");
        lines.push("        <rest/>");
        lines.push(`        <duration>${duration}</duration>`);
        lines.push(`        <type>${type}</type>`);
        for (let d = 0; d < dots; d++) lines.push("        <dot/>");
        lines.push("      </note>");
        return;
      }
      if (note.pizz && firstPizz) {
        lines.push('      <direction placement="above"><direction-type><words>pizz.</words></direction-type></direction>');
        firstPizz = false;
      }
      const pitches = note.double !== undefined ? [note.double, note.midi] : [note.midi];
      pitches.forEach((midi, pitchIndex) => {
        const spelled = spellNote(midi, musicKey);
        const finger = fingering(midi);
        lines.push("      <note>");
        if (pitchIndex > 0) lines.push("        <chord/>");
        lines.push("        <pitch>");
        lines.push(`          <step>${LETTER_NAMES[spelled.letter]}</step>`);
        if (spelled.alter !== 0) lines.push(`          <alter>${spelled.alter}</alter>`);
        lines.push(`          <octave>${spelled.octave}</octave>`);
        lines.push("        </pitch>");
        lines.push(`        <duration>${duration}</duration>`);
        lines.push(`        <type>${type}</type>`);
        for (let d = 0; d < dots; d++) lines.push("        <dot/>");
        if (spelled.alter > 0) lines.push("        <accidental>sharp</accidental>");
        if (spelled.alter < 0) lines.push("        <accidental>flat</accidental>");
        if (finger || note.accent) {
          lines.push("        <notations>");
          if (note.accent) lines.push("          <articulations><accent/></articulations>");
          if (finger) lines.push(`          <technical><fingering>${finger.finger}</fingering></technical>`);
          lines.push("        </notations>");
        }
        lines.push("      </note>");
      });
    });
    lines.push("    </measure>");
  });

  lines.push("  </part>");
  lines.push("</score-partwise>");
  return lines.join("\n");
}

export function downloadText(filename: string, text: string, mime = "application/xml"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
