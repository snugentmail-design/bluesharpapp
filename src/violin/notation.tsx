/**
 * Staff notation, drawn as plain SVG so it prints cleanly and needs no music
 * font to be installed.
 */

import React from "react";
import { Bar, Fingering, PartNote, fingering } from "./generate";
import {
  Chord,
  Key,
  chordEquals,
  chordName,
  keySignature,
  keySignatureAlters,
  spellNote,
} from "./theory";

const SPACE = 9; // distance between staff lines, in px
const TOP_LINE_DIATONIC = 45; // F5 sits on the top line of a treble staff
const MIDDLE_LINE_DIATONIC = 41; // B4
const STEM_LENGTH = SPACE * 3.4;
const SYSTEM_GAP = 14;

/** The treble clef: a spiral head, the tall loop above it, and the tail. */
function trebleClefPath(): string {
  const cx = 1.15;
  const cy = 3.05;
  const endAngle = (200 * Math.PI) / 180;
  const startAngle = endAngle - 1.6 * Math.PI * 2;
  const steps = 90;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + t * (endAngle - startAngle);
    const radius = 0.1 + 1.25 * Math.pow(t, 1.7);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    d += i === 0 ? `M ${x.toFixed(3)} ${y.toFixed(3)}` : ` L ${x.toFixed(3)} ${y.toFixed(3)}`;
  }
  d += " C -0.1 1.3, 0.45 -0.3, 1.4 -1.55"; // up to the tip above the staff
  d += " C 2.25 -0.7, 2.1 0.9, 1.5 2.15"; // back down through the head
  d += " C 1.25 3.0, 1.15 4.3, 1.13 5.45";
  d += " C 1.11 6.35, 0.25 6.5, 0.38 5.7"; // tail hook below the staff
  return d;
}

const CLEF_PATH = trebleClefPath();
const CLEF_WIDTH = 30;

const SHARP_STEPS = [45, 42, 46, 43, 40, 44, 41];
const FLAT_STEPS = [41, 44, 40, 43, 39, 42, 38];

interface DurationInfo {
  head: "whole" | "half" | "filled";
  flags: number;
  dots: number;
}

const DURATIONS: Array<{ beats: number; info: DurationInfo }> = [
  { beats: 4, info: { head: "whole", flags: 0, dots: 0 } },
  { beats: 3, info: { head: "half", flags: 0, dots: 1 } },
  { beats: 2, info: { head: "half", flags: 0, dots: 0 } },
  { beats: 1.5, info: { head: "filled", flags: 0, dots: 1 } },
  { beats: 1, info: { head: "filled", flags: 0, dots: 0 } },
  { beats: 0.75, info: { head: "filled", flags: 1, dots: 1 } },
  { beats: 0.5, info: { head: "filled", flags: 1, dots: 0 } },
  { beats: 0.375, info: { head: "filled", flags: 2, dots: 1 } },
  { beats: 0.25, info: { head: "filled", flags: 2, dots: 0 } },
];

export function durationInfo(beats: number): DurationInfo {
  let best = DURATIONS[DURATIONS.length - 1];
  let bestDistance = Infinity;
  for (const entry of DURATIONS) {
    const distance = Math.abs(entry.beats - beats);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best.info;
}

interface PlacedHead {
  diatonic: number;
  /** "♯", "♭", "♮", or null when the key signature already says it. */
  accidental: string | null;
}

interface PlacedNote {
  note: PartNote;
  x: number;
  beatPosition: number;
  info: DurationInfo;
  globalIndex: number;
  heads: PlacedHead[];
  /** Highest and lowest staff steps used by this note (a double stop uses two). */
  topStep: number;
  bottomStep: number;
  stemUp: boolean;
  /** Fingering to print, or null when it would just repeat the last one. */
  label: Fingering | null;
}

interface PlacedBar {
  bar: Bar;
  x: number;
  width: number;
  notes: PlacedNote[];
  showChord: boolean;
  /** "pizz." is printed where the technique changes, not on every bar. */
  showTechnique: boolean;
}

interface System {
  bars: PlacedBar[];
  right: number;
  /** y of the top staff line within the whole drawing. */
  staffTop: number;
  /** y of the fingering and chord rows, relative to the top staff line. */
  fingerOffset: number;
  chordOffset: number;
  /** Space needed below the top staff line. */
  below: number;
}

const noteWidth = (note: PartNote): number =>
  note.beats >= 2 ? 48 : note.beats >= 1 ? 40 : note.beats >= 0.5 ? 30 : 23;

const stepY = (diatonic: number, top: number): number => top + ((TOP_LINE_DIATONIC - diatonic) * SPACE) / 2;

function layout(
  bars: Bar[],
  available: number,
  headerWidth: number,
  musicKey: Key,
  firstPositionOnly: boolean
): System[] {
  const systems: System[] = [];
  const signatureAlters = keySignatureAlters(keySignature(musicKey));
  let current: PlacedBar[] = [];
  let x = headerWidth;
  let globalIndex = 0;
  let previousFingering: Fingering | null = null;
  let previousChord: Chord | null = null;
  let previousPizz = false;
  let cursor = 0;

  const closeSystem = (right: number, justify: boolean) => {
    if (current.length === 0) return;
    let edge = right;
    if (justify && right < available && right > headerWidth) {
      // Stretch the bars to fill the line, the way engraved music does.
      const factor = (available - headerWidth) / (right - headerWidth);
      current.forEach((placed) => {
        placed.x = headerWidth + (placed.x - headerWidth) * factor;
        placed.width *= factor;
        placed.notes.forEach((placedNote) => {
          placedNote.x = headerWidth + (placedNote.x - headerWidth) * factor;
        });
      });
      edge = available;
    }

    let topExtent = 0;
    let bottomExtent = 4 * SPACE;
    let hasLabel = false;
    current.forEach((placed) => {
      placed.notes.forEach((placedNote) => {
        if (placedNote.note.midi === null) return;
        const headTop = stepY(placedNote.topStep, 0);
        const headBottom = stepY(placedNote.bottomStep, 0);
        topExtent = Math.min(topExtent, placedNote.stemUp ? headTop - STEM_LENGTH : headTop - SPACE * 0.8);
        bottomExtent = Math.max(
          bottomExtent,
          placedNote.stemUp ? headBottom + SPACE * 0.8 : headBottom + STEM_LENGTH
        );
        if (placedNote.label) hasLabel = true;
      });
    });
    const fingerOffset = topExtent - 9;
    const chordOffset = fingerOffset - (hasLabel ? 16 : 4);
    const above = Math.max(24, -chordOffset + 14);
    const hasPizz = current.some((placed) => placed.bar.notes.some((note) => note.pizz));
    const below = Math.max(4 * SPACE + 8, bottomExtent + (hasPizz ? 24 : 8));
    systems.push({ bars: current, right: edge, staffTop: cursor + above, fingerOffset, chordOffset, below });
    cursor += above + below + SYSTEM_GAP;
    current = [];
  };

  bars.forEach((bar) => {
    const barWidth = Math.max(
      96,
      bar.notes.reduce((total, note) => total + noteWidth(note), 0) + 24
    );
    if (current.length > 0 && x + barWidth > available) {
      closeSystem(x, true);
      x = headerWidth;
      previousChord = null;
    }

    let noteX = x + 14;
    const placed: PlacedNote[] = [];
    let beatPosition = 0;
    // Accidentals last until the end of the bar, so track what is already
    // sounding at each staff position. Without this a G natural in A major
    // would be read as G sharp.
    const sounding = new Map<number, number>();

    bar.notes.forEach((note) => {
      const heads: PlacedHead[] = [];
      const pitches = note.midi === null ? [] : [note.midi, ...(note.double !== undefined ? [note.double] : [])];
      pitches.forEach((midi) => {
        const spelled = spellNote(midi, musicKey);
        const inForce = sounding.has(spelled.diatonic)
          ? (sounding.get(spelled.diatonic) as number)
          : signatureAlters[spelled.letter];
        let accidental: string | null = null;
        if (spelled.alter !== inForce) {
          accidental = spelled.alter > 0 ? "♯" : spelled.alter < 0 ? "♭" : "♮";
          sounding.set(spelled.diatonic, spelled.alter);
        }
        heads.push({ diatonic: spelled.diatonic, accidental });
      });

      const steps = heads.map((head) => head.diatonic);
      const topStep = steps.length > 0 ? Math.max(...steps) : MIDDLE_LINE_DIATONIC;
      const bottomStep = steps.length > 0 ? Math.min(...steps) : MIDDLE_LINE_DIATONIC;

      let label: Fingering | null = null;
      if (note.midi !== null) {
        const finger = fingering(note.midi, firstPositionOnly);
        // Only print a fingering where it tells the player something new.
        if (
          finger &&
          (beatPosition === 0 ||
            !previousFingering ||
            previousFingering.string !== finger.string ||
            previousFingering.position !== finger.position)
        ) {
          label = finger;
        }
        if (finger) previousFingering = finger;
      }

      placed.push({
        note,
        x: noteX,
        beatPosition,
        info: durationInfo(note.beats),
        globalIndex: globalIndex++,
        heads,
        topStep,
        bottomStep,
        stemUp: topStep < MIDDLE_LINE_DIATONIC,
        label,
      });
      noteX += noteWidth(note);
      beatPosition += note.beats;
    });

    const showChord = current.length === 0 || !chordEquals(previousChord, bar.chord);
    previousChord = bar.chord;
    const pizz = bar.notes.some((note) => note.pizz);
    const showTechnique = pizz && !previousPizz;
    previousPizz = pizz;
    current.push({ bar, x, width: barWidth, notes: placed, showChord, showTechnique });
    x += barWidth;
  });

  closeSystem(x, false);
  return systems;
}

interface ScoreProps {
  bars: Bar[];
  musicKey: Key;
  beatsPerBar: number;
  width: number;
  firstPositionOnly: boolean;
  activeNote: number | null;
  onPickBar?: (index: number) => void;
}

export function Score({
  bars,
  musicKey,
  beatsPerBar,
  width,
  firstPositionOnly,
  activeNote,
  onPickBar,
}: ScoreProps): JSX.Element {
  const signature = keySignature(musicKey);
  const accidentalCount = Math.abs(signature);
  const timeSignatureX = 14 + CLEF_WIDTH + accidentalCount * 8;
  const headerWidth = timeSignatureX + 26;
  const boardWidth = Math.max(340, width);
  const systems = layout(bars, boardWidth - 12, headerWidth, musicKey, firstPositionOnly);
  const last = systems[systems.length - 1];
  const height = last ? last.staffTop + last.below + 8 : 90;

  return (
    <svg className="score" width="100%" viewBox={`0 0 ${boardWidth} ${height}`} role="img" aria-label="Violin part">
      {systems.map((system, systemIndex) => {
        const top = system.staffTop;
        return (
          <g key={systemIndex}>
            {[0, 1, 2, 3, 4].map((line) => (
              <line
                key={line}
                x1={10}
                x2={system.right}
                y1={top + line * SPACE}
                y2={top + line * SPACE}
                className="staff-line"
              />
            ))}

            <g transform={`translate(14 ${top}) scale(${SPACE})`}>
              <path d={CLEF_PATH} className="clef" strokeWidth={0.3} />
            </g>

            {Array.from({ length: accidentalCount }).map((_, index) => {
              const step = signature > 0 ? SHARP_STEPS[index] : FLAT_STEPS[index];
              return (
                <text
                  key={index}
                  x={14 + CLEF_WIDTH + index * 8}
                  y={stepY(step, top) + (signature > 0 ? 5 : 4)}
                  className="accidental"
                >
                  {signature > 0 ? "♯" : "♭"}
                </text>
              );
            })}

            <g className="time-signature">
              <text x={timeSignatureX} y={top + SPACE * 1.72}>{beatsPerBar}</text>
              <text x={timeSignatureX} y={top + SPACE * 3.72}>4</text>
            </g>

            {system.bars.map((placed, barIndex) => (
              <BarGlyphs
                key={placed.bar.index}
                placed={placed}
                top={top}
                system={system}
                musicKey={musicKey}
                activeNote={activeNote}
                onPickBar={onPickBar}
                leading={barIndex > 0}
              />
            ))}

            <line x1={system.right} x2={system.right} y1={top} y2={top + 4 * SPACE} className="barline" />
          </g>
        );
      })}
    </svg>
  );
}

interface BarGlyphsProps {
  placed: PlacedBar;
  top: number;
  system: System;
  musicKey: Key;
  activeNote: number | null;
  onPickBar?: (index: number) => void;
  leading: boolean;
}

function BarGlyphs({ placed, top, system, musicKey, activeNote, onPickBar, leading }: BarGlyphsProps): JSX.Element {
  const { bar } = placed;
  const beams = beamGroups(placed.notes);
  const beamed = new Set<number>();
  beams.forEach((group) => group.forEach((placedNote) => beamed.add(placedNote.globalIndex)));

  return (
    <g
      className={onPickBar ? "bar bar-clickable" : "bar"}
      onClick={onPickBar ? () => onPickBar(bar.index) : undefined}
    >
      <rect
        x={placed.x}
        y={top + system.chordOffset - 12}
        width={placed.width}
        height={4 * SPACE + 24 - system.chordOffset}
        className="bar-hit"
      />
      {placed.showChord && (
        <text x={placed.x + 10} y={top + system.chordOffset} className="chord-symbol">
          {chordName(bar.chord, musicKey)}
        </text>
      )}
      {placed.showTechnique && (
        <text x={placed.x + 10} y={top + 4 * SPACE + 20} className="technique">
          pizz.
        </text>
      )}
      {leading && <line x1={placed.x} x2={placed.x} y1={top} y2={top + 4 * SPACE} className="barline" />}

      {placed.notes.map((placedNote) => (
        <NoteGlyph
          key={placedNote.globalIndex}
          placed={placedNote}
          top={top}
          system={system}
          active={activeNote === placedNote.globalIndex}
          beamed={beamed.has(placedNote.globalIndex)}
        />
      ))}

      {beams.map((group, index) => (
        <Beam key={index} group={group} top={top} />
      ))}
    </g>
  );
}

/** Consecutive short notes inside the same beat are beamed together. */
function beamGroups(notes: PlacedNote[]): PlacedNote[][] {
  const groups: PlacedNote[][] = [];
  let current: PlacedNote[] = [];
  const flush = () => {
    if (current.length > 1) groups.push(current);
    current = [];
  };
  notes.forEach((placed) => {
    const beamable = placed.info.flags > 0 && placed.note.midi !== null;
    if (!beamable) {
      flush();
      return;
    }
    if (current.length > 0) {
      const first = current[0];
      if (Math.floor(first.beatPosition) !== Math.floor(placed.beatPosition)) flush();
    }
    current.push(placed);
  });
  flush();
  return groups;
}

interface NoteGlyphProps {
  placed: PlacedNote;
  top: number;
  system: System;
  active: boolean;
  beamed: boolean;
}

function NoteGlyph({ placed, top, system, active, beamed }: NoteGlyphProps): JSX.Element {
  const { note, info, x, stemUp } = placed;
  if (note.midi === null) {
    return <Rest x={x} top={top} info={info} active={active} />;
  }

  const heads = placed.heads.map((head) => ({ ...head, y: stepY(head.diatonic, top) }));

  const stemX = stemUp ? x + SPACE * 0.62 : x - SPACE * 0.62;
  const headTopY = stepY(placed.topStep, top);
  const headBottomY = stepY(placed.bottomStep, top);
  const stemTop = stemUp ? headTopY - STEM_LENGTH : headTopY;
  const stemBottom = stemUp ? headBottomY : headBottomY + STEM_LENGTH;

  return (
    <g className={active ? "note note-active" : "note"}>
      {heads.map((head) => (
        <LedgerLines key={head.diatonic} diatonic={head.diatonic} top={top} x={x} />
      ))}

      {heads.map((head) => (
        <g key={head.diatonic}>
          {head.accidental && (
            <text x={x - SPACE * 1.75} y={head.y + 4} className="accidental">
              {head.accidental}
            </text>
          )}
          <ellipse
            cx={x}
            cy={head.y}
            rx={SPACE * 0.64}
            ry={SPACE * 0.47}
            transform={`rotate(-18 ${x} ${head.y})`}
            className={info.head === "filled" ? "notehead filled" : "notehead hollow"}
          />
          {info.dots > 0 && <circle cx={x + SPACE * 1.2} cy={head.y - SPACE * 0.25} r={SPACE * 0.16} className="dot" />}
        </g>
      ))}

      {info.head !== "whole" && !beamed && (
        <line x1={stemX} x2={stemX} y1={stemTop} y2={stemBottom} className="stem" />
      )}

      {!beamed && info.flags > 0 && (
        <Flags x={stemX} y={stemUp ? stemTop : stemBottom} up={stemUp} count={info.flags} />
      )}

      {note.accent && (
        <text
          x={x}
          y={stemUp ? headBottomY + SPACE * 1.9 : headTopY - SPACE * 1.2}
          className="articulation"
        >
          &gt;
        </text>
      )}

      {placed.label && (
        <text x={x} y={top + system.fingerOffset} className="fingering">
          {placed.label.finger}
          {placed.label.position > 1 && <tspan className="position">{`·${placed.label.position}`}</tspan>}
        </text>
      )}
    </g>
  );
}

function LedgerLines({ diatonic, top, x }: { diatonic: number; top: number; x: number }): JSX.Element {
  const lines: number[] = [];
  for (let step = TOP_LINE_DIATONIC + 2; step <= diatonic; step += 2) lines.push(step);
  for (let step = TOP_LINE_DIATONIC - 10; step >= diatonic; step -= 2) lines.push(step);
  return (
    <g className="ledger">
      {lines.map((step) => (
        <line key={step} x1={x - SPACE} x2={x + SPACE} y1={stepY(step, top)} y2={stepY(step, top)} />
      ))}
    </g>
  );
}

function Flags({ x, y, up, count }: { x: number; y: number; up: boolean; count: number }): JSX.Element {
  return (
    <g className="flag">
      {Array.from({ length: count }).map((_, index) => {
        const offset = index * SPACE * 0.75 * (up ? 1 : -1);
        const direction = up ? 1 : -1;
        return (
          <path
            key={index}
            d={`M ${x} ${y + offset} C ${x + SPACE * 1.2} ${y + offset + SPACE * 0.6 * direction}, ${x + SPACE * 1.1} ${
              y + offset + SPACE * 1.4 * direction
            }, ${x + SPACE * 0.3} ${y + offset + SPACE * 2 * direction}`}
          />
        );
      })}
    </g>
  );
}

function Beam({ group, top }: { group: PlacedNote[]; top: number }): JSX.Element {
  const upVotes = group.filter((placed) => placed.stemUp).length;
  const up = upVotes * 2 >= group.length;
  const beamCount = Math.max(...group.map((placed) => placed.info.flags));
  const stemX = (placed: PlacedNote): number => placed.x + (up ? SPACE * 0.62 : -SPACE * 0.62);
  const tipY = (placed: PlacedNote): number =>
    up ? stepY(placed.topStep, top) - STEM_LENGTH : stepY(placed.bottomStep, top) + STEM_LENGTH;
  const outer = up ? Math.min(...group.map(tipY)) : Math.max(...group.map(tipY));
  const x1 = stemX(group[0]);
  const x2 = stemX(group[group.length - 1]);

  return (
    <g className="beam">
      {group.map((placed) => (
        <line
          key={placed.globalIndex}
          x1={stemX(placed)}
          x2={stemX(placed)}
          y1={up ? stepY(placed.bottomStep, top) : stepY(placed.topStep, top)}
          y2={outer}
          className="stem"
        />
      ))}
      {Array.from({ length: beamCount }).map((_, index) => {
        const offset = index * SPACE * 0.62 * (up ? 1 : -1);
        return (
          <rect
            key={index}
            x={x1}
            y={outer + offset - (up ? 0 : SPACE * 0.3)}
            width={Math.max(SPACE, x2 - x1)}
            height={SPACE * 0.3}
          />
        );
      })}
    </g>
  );
}

function Rest({ x, top, info, active }: { x: number; top: number; info: DurationInfo; active: boolean }): JSX.Element {
  const middle = top + 2 * SPACE;
  const className = active ? "rest rest-active" : "rest";
  if (info.head === "whole") {
    return <rect className={className} x={x - SPACE * 0.6} y={top + SPACE} width={SPACE * 1.2} height={SPACE * 0.45} />;
  }
  if (info.head === "half") {
    return (
      <rect
        className={className}
        x={x - SPACE * 0.6}
        y={top + 2 * SPACE - SPACE * 0.45}
        width={SPACE * 1.2}
        height={SPACE * 0.45}
      />
    );
  }
  if (info.flags === 0) {
    return (
      <path
        className={className}
        d={`M ${x - SPACE * 0.35} ${middle - SPACE * 1.2} l ${SPACE * 0.6} ${SPACE * 0.8} l ${-SPACE * 0.55} ${
          SPACE * 0.75
        } l ${SPACE * 0.7} ${SPACE * 0.85} l ${-SPACE * 0.25} ${SPACE * 0.2} c ${-SPACE * 0.6} ${-SPACE * 0.4}, ${
          -SPACE * 0.9
        } ${SPACE * 0.1}, ${-SPACE * 0.4} ${SPACE * 0.6} l ${-SPACE * 0.25} ${-SPACE * 0.1} c ${-SPACE * 0.5} ${
          -SPACE * 0.85
        }, ${SPACE * 0.2} ${-SPACE * 1.0}, ${SPACE * 0.35} ${-SPACE * 1.05} l ${-SPACE * 0.65} ${-SPACE * 0.9} l ${
          SPACE * 0.5
        } ${-SPACE * 0.75} z`}
      />
    );
  }
  return (
    <g className={className}>
      <line
        x1={x + SPACE * 0.45}
        x2={x - SPACE * 0.15}
        y1={middle - SPACE * 0.9}
        y2={middle + SPACE * (info.flags > 1 ? 1.1 : 0.7)}
      />
      {Array.from({ length: info.flags }).map((_, index) => (
        <circle key={index} cx={x + SPACE * 0.3} cy={middle - SPACE * 0.75 + index * SPACE * 0.7} r={SPACE * 0.22} />
      ))}
    </g>
  );
}
