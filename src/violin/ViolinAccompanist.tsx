import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  DIFFICULTIES,
  Difficulty,
  OPEN_STRINGS,
  STYLES,
  StyleId,
  commonTones,
  fingering,
  generateAccompaniment,
} from "./generate";
import {
  Chord,
  Key,
  Mode,
  chordEquals,
  chordName,
  chordScale,
  inferKey,
  keyName,
  noteLabel,
  parseProgression,
  pitchClassName,
  SHARP_NAMES,
} from "./theory";
import { PianoListener, TrackerFrame } from "./chordDetect";
import { Player } from "./audio";
import { Score } from "./notation";
import { downloadText, toMusicXml } from "./musicxml";
import "./violin.css";

type ListenMode = "capture" | "follow";
type View = "pattern" | "score";

interface Preset {
  name: string;
  chords: string;
  tempo: number;
}

const PRESETS: Preset[] = [
  { name: "12-bar blues in A", chords: "A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7", tempo: 96 },
  { name: "Jazz blues in F", chords: "F7 Bb7 F7 F7 Bb7 Bb7 F7 D7 Gm7 C7 F7 C7", tempo: 132 },
  { name: "ii–V–I in C", chords: "Dm7 G7 Cmaj7 Cmaj7", tempo: 120 },
  { name: "Pop loop (I–V–vi–IV)", chords: "C G Am F", tempo: 104 },
  { name: "Minor vamp", chords: "Am Am G G F F E7 E7", tempo: 88 },
  { name: "Fiddle tune in D", chords: "D D G D D A D D", tempo: 132 },
];

const DURATION_LABEL = (beats: number): string => {
  if (beats >= 4) return "whole";
  if (beats >= 3) return "dotted half";
  if (beats >= 2) return "half";
  if (beats >= 1.5) return "dotted qtr";
  if (beats >= 1) return "quarter";
  if (beats >= 0.75) return "dotted 8th";
  if (beats >= 0.5) return "eighth";
  return "16th";
};

export default function ViolinAccompanist(): JSX.Element {
  const [progression, setProgression] = useState<Chord[]>(() => parseProgression(PRESETS[2].chords));
  const [progressionText, setProgressionText] = useState<string>(PRESETS[2].chords);
  const [keyOverride, setKeyOverride] = useState<Key | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("simple");
  const [style, setStyle] = useState<StyleId>("counter");
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [tempo, setTempo] = useState(120);
  const [allowDoubleStops, setAllowDoubleStops] = useState(true);
  const [firstPositionOnly, setFirstPositionOnly] = useState(true);
  const [seed, setSeed] = useState(1);
  const [view, setView] = useState<View>("pattern");

  const [listening, setListening] = useState(false);
  const [listenMode, setListenMode] = useState<ListenMode>("capture");
  const [liveChord, setLiveChord] = useState<Chord | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [withChords, setWithChords] = useState(true);
  const [withClick, setWithClick] = useState(false);
  const [swing, setSwing] = useState(false);
  const [activeNote, setActiveNote] = useState<number | null>(null);
  const [activeBar, setActiveBar] = useState<number | null>(null);
  const [focusBar, setFocusBar] = useState(0);

  const scoreRef = useRef<HTMLDivElement | null>(null);
  const [scoreWidth, setScoreWidth] = useState(900);
  const listenerRef = useRef<PianoListener | null>(null);
  const playerRef = useRef<Player | null>(null);
  const tapsRef = useRef<number[]>([]);
  const progressionRef = useRef(progression);
  progressionRef.current = progression;
  const listenModeRef = useRef(listenMode);
  listenModeRef.current = listenMode;

  const musicKey: Key = useMemo(
    () => keyOverride ?? inferKey(progression),
    [keyOverride, progression]
  );

  const bars: Bar[] = useMemo(
    () =>
      generateAccompaniment({
        progression,
        key: musicKey,
        difficulty,
        style,
        beatsPerBar,
        seed,
        allowDoubleStops,
        firstPositionOnly,
      }),
    [progression, musicKey, difficulty, style, beatsPerBar, seed, allowDoubleStops, firstPositionOnly]
  );

  // --- microphone ----------------------------------------------------------

  const handleFrame = useCallback((frame: TrackerFrame) => {
    setLiveChord(frame.current);
    setConfidence(frame.confidence);
    setLevel(frame.level);
    if (!frame.committed) return;
    const committed = frame.committed;

    if (listenModeRef.current === "capture") {
      setProgression((current) => {
        if (current.length >= 32) return current;
        const next = [...current, committed];
        setProgressionText(next.map((chord) => chordName(chord)).join(" "));
        return next;
      });
    } else {
      // Follow mode: point at the bar that matches what the piano just played,
      // searching forward first so repeated chords advance rather than jump back.
      const current = progressionRef.current;
      setFocusBar((previous) => {
        for (let step = 1; step <= current.length; step++) {
          const index = (previous + step) % current.length;
          if (chordEquals(current[index], committed)) return index;
        }
        return previous;
      });
    }
  }, []);

  const toggleListening = useCallback(async () => {
    if (listening) {
      listenerRef.current?.stop();
      listenerRef.current = null;
      setListening(false);
      setLiveChord(null);
      setConfidence(0);
      setLevel(0);
      return;
    }
    playerRef.current?.stop();
    setPlaying(false);
    setMicError(null);
    const listener = new PianoListener({
      onFrame: handleFrame,
      onError: (message) => {
        setMicError(message);
        setListening(false);
      },
    });
    listenerRef.current = listener;
    const started = await listener.start();
    setListening(started);
    if (started && listenMode === "capture") {
      listener.tracker.setLastCommitted(null);
    }
  }, [listening, handleFrame, listenMode]);

  useEffect(() => () => listenerRef.current?.stop(), []);
  useEffect(() => {
    playerRef.current = new Player();
    return () => playerRef.current?.dispose();
  }, []);

  // --- layout --------------------------------------------------------------

  useEffect(() => {
    const measure = () => {
      if (scoreRef.current) setScoreWidth(scoreRef.current.clientWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [view]);

  // --- playback ------------------------------------------------------------

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      player.stop();
      setPlaying(false);
      setActiveNote(null);
      setActiveBar(null);
      return;
    }
    if (listening) {
      listenerRef.current?.stop();
      listenerRef.current = null;
      setListening(false);
    }
    player.play(
      bars,
      { tempo, beatsPerBar, withChords, withClick, swing, loop },
      (noteIndex, barIndex) => {
        setActiveNote(noteIndex);
        setActiveBar(barIndex);
        if (barIndex !== null) setFocusBar(barIndex);
      }
    );
    setPlaying(true);
  }, [playing, listening, bars, tempo, beatsPerBar, withChords, withClick, swing, loop]);

  useEffect(() => {
    if (playing) {
      playerRef.current?.stop();
      setPlaying(false);
      setActiveNote(null);
    }
    // Deliberately keyed on `bars` only: restarting on every unrelated
    // setting change would cut the player off mid-phrase.
  }, [bars]);

  const tapTempo = useCallback(() => {
    const now = performance.now();
    const taps = tapsRef.current.filter((time) => now - time < 3000);
    taps.push(now);
    tapsRef.current = taps.slice(-5);
    if (tapsRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapsRef.current.length; i++) {
        intervals.push(tapsRef.current[i] - tapsRef.current[i - 1]);
      }
      const average = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / average);
      if (bpm >= 40 && bpm <= 240) setTempo(bpm);
    }
  }, []);

  // --- progression editing -------------------------------------------------

  const applyProgressionText = useCallback((text: string) => {
    setProgressionText(text);
    const parsed = parseProgression(text);
    if (parsed.length > 0) setProgression(parsed);
  }, []);

  const removeBar = useCallback((index: number) => {
    setProgression((current) => {
      const next = current.filter((_, i) => i !== index);
      setProgressionText(next.map((chord) => chordName(chord)).join(" "));
      return next;
    });
  }, []);

  const clearProgression = useCallback(() => {
    setProgression([]);
    setProgressionText("");
    setFocusBar(0);
    listenerRef.current?.tracker.setLastCommitted(null);
  }, []);

  const acceptLiveChord = useCallback(() => {
    if (!liveChord) return;
    setProgression((current) => {
      const next = [...current, liveChord];
      setProgressionText(next.map((chord) => chordName(chord)).join(" "));
      return next;
    });
  }, [liveChord]);

  const currentBar = bars.length > 0 ? bars[Math.min(focusBar, bars.length - 1)] : null;
  const nextBar = bars.length > 0 ? bars[(Math.min(focusBar, bars.length - 1) + 1) % bars.length] : null;
  const anchorNotes = useMemo(() => commonTones(progression), [progression]);
  const scale = currentBar ? chordScale(currentBar.chord, musicKey) : null;

  return (
    <div className="jam">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🎻</span>
          <div>
            <h1>Jam Fiddle</h1>
            <p>Hears the piano. Tells you what to play.</p>
          </div>
        </div>

        <div className="topbar-controls">
          <button
            className={listening ? "mic-button listening" : "mic-button"}
            onClick={() => void toggleListening()}
            aria-pressed={listening}
          >
            <span className="mic-dot" />
            {listening ? "Listening" : "Listen"}
          </button>

          <div className="segmented small">
            {(["capture", "follow"] as ListenMode[]).map((mode) => (
              <button
                key={mode}
                className={listenMode === mode ? "active" : ""}
                onClick={() => setListenMode(mode)}
              >
                {mode === "capture" ? "Capture chords" : "Follow along"}
              </button>
            ))}
          </div>

          <div className="tempo">
            <label htmlFor="tempo">♩</label>
            <input
              id="tempo"
              type="number"
              min={40}
              max={240}
              value={tempo}
              onChange={(event) => setTempo(Number(event.target.value) || 120)}
            />
            <button onClick={tapTempo}>Tap</button>
          </div>
        </div>
      </header>

      {micError && <div className="banner error">{micError}</div>}

      <section className={listening ? "live live-on" : "live"}>
        <div className="live-meter">
          <div className="level-bar">
            <span style={{ width: `${Math.min(100, level * 900)}%` }} />
          </div>
          <span className="live-label">
            {listening ? (listenMode === "capture" ? "Recording changes" : "Following the changes") : "Mic off"}
          </span>
        </div>
        <div className="live-chord">
          <span className="live-chord-name">{liveChord ? chordName(liveChord, musicKey) : "—"}</span>
          {liveChord && (
            <div className="confidence">
              <span style={{ width: `${Math.round(confidence * 100)}%` }} />
            </div>
          )}
        </div>
        <p className="live-hint">
          {listening
            ? listenMode === "capture"
              ? "Play the tune through once. Each chord you hold lands in the changes below."
              : "Keep playing. The big chord follows what the piano is doing."
            : "Turn on the mic and play the changes on the piano, or type them in below."}
        </p>
        <button className="ghost" onClick={acceptLiveChord} disabled={!liveChord}>
          + Add heard chord
        </button>
      </section>

      <section className="now-panel">
        <div className="now-head">
          <div>
            <p className="eyebrow">Now — bar {currentBar ? currentBar.index + 1 : "–"}</p>
            <p className="chord-big">{currentBar ? chordName(currentBar.chord, musicKey) : "add chords"}</p>
          </div>
          <div className="next">
            <p className="eyebrow">Next</p>
            <p className="chord-next">{nextBar ? chordName(nextBar.chord, musicKey) : "—"}</p>
          </div>
          <div className="key-box">
            <p className="eyebrow">Key</p>
            <p className="key-value">{keyName(musicKey)}</p>
          </div>
        </div>

        {currentBar && (
          <>
            <div className="note-strip">
              {currentBar.notes.map((note, index) => {
                const finger = note.midi === null ? null : fingering(note.midi, firstPositionOnly);
                return (
                  <div
                    key={index}
                    className={note.midi === null ? "note-chip rest" : "note-chip"}
                  >
                    <span className="note-name">
                      {note.midi === null ? "rest" : noteLabel(note.midi, musicKey)}
                      {note.double !== undefined && (
                        <span className="double">+{noteLabel(note.double, musicKey)}</span>
                      )}
                    </span>
                    <span className="note-meta">{DURATION_LABEL(note.beats)}</span>
                    {finger && (
                      <span className="note-finger">
                        {finger.open ? "open" : `${finger.finger}`}
                        <em>{finger.string} str{finger.position > 1 ? ` · ${finger.position}rd pos` : ""}</em>
                      </span>
                    )}
                    {note.pizz && <span className="tag">pizz</span>}
                  </div>
                );
              })}
            </div>
            <p className="hint">{currentBar.hint}</p>
            {scale && (
              <p className="fallback">
                <strong>If you get lost:</strong> {scale.name} on {pitchClassName(currentBar.chord.root, musicKey)} —{" "}
                {scale.pcs.map((pc) => pitchClassName(pc, musicKey)).join(" ")}. Notes that fit the whole tune:{" "}
                {anchorNotes.map((pc) => pitchClassName(pc, musicKey)).join(", ")}.
              </p>
            )}
          </>
        )}

        <div className="bar-strip">
          {bars.map((bar) => (
            <button
              key={bar.index}
              className={
                bar.index === focusBar
                  ? "bar-chip current"
                  : bar.index === activeBar
                  ? "bar-chip playing"
                  : "bar-chip"
              }
              onClick={() => setFocusBar(bar.index)}
            >
              {chordName(bar.chord, musicKey)}
            </button>
          ))}
        </div>
      </section>

      <section className="controls">
        <div className="control-block wide">
          <h2>How hard?</h2>
          <div className="segmented big">
            {DIFFICULTIES.map((entry) => (
              <button
                key={entry.id}
                className={difficulty === entry.id ? "active" : ""}
                onClick={() => setDifficulty(entry.id)}
                title={entry.blurb}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <p className="blurb">{DIFFICULTIES.find((entry) => entry.id === difficulty)?.blurb}</p>
        </div>

        <div className="control-block parts">
          <h2>What kind of part?</h2>
          <div className="radio-grid">
            {STYLES.map((entry) => (
              <label key={entry.id} className={style === entry.id ? "radio-card selected" : "radio-card"}>
                <input
                  type="radio"
                  name="style"
                  value={entry.id}
                  checked={style === entry.id}
                  onChange={() => setStyle(entry.id)}
                />
                <span className="radio-name">{entry.name}</span>
                <span className="radio-blurb">{entry.blurb}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="control-block">
          <h2>Playing options</h2>
          <div className="toggles">
            <label>
              <input type="checkbox" checked={allowDoubleStops} onChange={(e) => setAllowDoubleStops(e.target.checked)} />
              Allow double stops
            </label>
            <label>
              <input type="checkbox" checked={firstPositionOnly} onChange={(e) => setFirstPositionOnly(e.target.checked)} />
              First position only
            </label>
            <label>
              <input type="checkbox" checked={swing} onChange={(e) => setSwing(e.target.checked)} />
              Swing eighths
            </label>
            <label>
              <input type="checkbox" checked={withChords} onChange={(e) => setWithChords(e.target.checked)} />
              Play chords too
            </label>
            <label>
              <input type="checkbox" checked={withClick} onChange={(e) => setWithClick(e.target.checked)} />
              Click track
            </label>
            <label>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              Loop
            </label>
          </div>
          <div className="meter-row">
            <span>Beats per bar</span>
            <div className="segmented small">
              {[3, 4, 6].map((value) => (
                <button key={value} className={beatsPerBar === value ? "active" : ""} onClick={() => setBeatsPerBar(value)}>
                  {value}/4
                </button>
              ))}
            </div>
          </div>
          <div className="meter-row">
            <span>Key</span>
            <select
              value={keyOverride ? `${keyOverride.tonic}:${keyOverride.mode}` : "auto"}
              onChange={(event) => {
                if (event.target.value === "auto") {
                  setKeyOverride(null);
                  return;
                }
                const [tonic, mode] = event.target.value.split(":");
                setKeyOverride({ tonic: Number(tonic), mode: mode as Mode });
              }}
            >
              <option value="auto">Auto ({keyName(inferKey(progression))})</option>
              {SHARP_NAMES.map((name, pc) =>
                (["major", "minor"] as Mode[]).map((mode) => (
                  <option key={`${pc}:${mode}`} value={`${pc}:${mode}`}>
                    {name} {mode}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      </section>

      <section className="output">
        <div className="print-head">
          <h2>Violin part — {keyName(musicKey)}</h2>
          <p>
            {STYLES.find((entry) => entry.id === style)?.name}, {difficulty} · ♩ = {tempo} ·{" "}
            {beatsPerBar}/4 · fingerings assume {firstPositionOnly ? "first position" : "shifts up the string"}
          </p>
        </div>
        <div className="output-head">
          <div className="segmented">
            <button className={view === "pattern" ? "active" : ""} onClick={() => setView("pattern")}>
              Pattern
            </button>
            <button className={view === "score" ? "active" : ""} onClick={() => setView("score")}>
              Sheet music
            </button>
          </div>
          <div className="output-actions">
            <button className="primary" onClick={togglePlay} disabled={bars.length === 0}>
              {playing ? "Stop" : "Play part"}
            </button>
            <button onClick={() => setSeed((value) => value + 1)} disabled={bars.length === 0}>
              Reroll
            </button>
            <button onClick={() => window.print()} disabled={bars.length === 0}>
              Print
            </button>
            <button
              onClick={() =>
                downloadText(
                  "violin-part.musicxml",
                  toMusicXml(bars, musicKey, beatsPerBar, "Violin accompaniment", tempo)
                )
              }
              disabled={bars.length === 0}
            >
              MusicXML
            </button>
          </div>
        </div>

        <div className={view === "score" ? "score-wrap paper" : "score-wrap board"} ref={scoreRef}>
          {bars.length === 0 ? (
            <p className="empty">Play some chords with the mic on, pick a preset, or type the changes below.</p>
          ) : view === "score" ? (
            <>
              <Score
                bars={bars}
                musicKey={musicKey}
                beatsPerBar={beatsPerBar}
                width={scoreWidth}
                firstPositionOnly={firstPositionOnly}
                activeNote={activeNote}
                onPickBar={setFocusBar}
              />
              <p className="legend">
                Blue numbers are left-hand fingers, 0 means an open string, and ·3 means shift to third
                position. Tap a bar to jump the big display to it.
              </p>
            </>
          ) : (
            <>
              <div className="pattern-grid">
              {bars.map((bar) => (
                <button
                  key={bar.index}
                  className={bar.index === focusBar ? "pattern-cell current" : "pattern-cell"}
                  onClick={() => setFocusBar(bar.index)}
                >
                  <span className="pattern-chord">{chordName(bar.chord, musicKey)}</span>
                  <span className="pattern-notes">
                    {bar.notes
                      .map((note) => (note.midi === null ? "·" : noteLabel(note.midi, musicKey)))
                      .join(" ")}
                  </span>
                  <span className="pattern-fingers">
                    {bar.notes
                      .map((note) => {
                        if (note.midi === null) return "–";
                        const finger = fingering(note.midi, firstPositionOnly);
                        return finger ? `${finger.string}${finger.finger}` : "?";
                      })
                      .join(" ")}
                  </span>
                </button>
                ))}
              </div>
              <p className="legend">
                Each card is one bar: chord, the notes to play, then string and finger (A1 means A string, first
                finger). Tap a card to make it the big one at the top.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="changes">
        <h2>The changes</h2>
        <div className="chip-row">
          {progression.map((chord, index) => (
            <span key={index} className="chord-chip">
              {chordName(chord, musicKey)}
              <button onClick={() => removeBar(index)} aria-label={`Remove bar ${index + 1}`}>
                ×
              </button>
            </span>
          ))}
          {progression.length === 0 && <span className="muted">No chords yet.</span>}
        </div>
        <label className="field">
          <span>Type the changes (one chord per bar)</span>
          <input
            type="text"
            value={progressionText}
            placeholder="Dm7 G7 Cmaj7 Cmaj7"
            onChange={(event) => applyProgressionText(event.target.value)}
          />
        </label>
        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => {
                applyProgressionText(preset.chords);
                setTempo(preset.tempo);
                setFocusBar(0);
              }}
            >
              {preset.name}
            </button>
          ))}
          <button className="danger" onClick={clearProgression}>
            Clear
          </button>
        </div>
        <p className="tuning">
          Open strings: {OPEN_STRINGS.map((string) => string.name).join(" ")} · fingerings assume{" "}
          {firstPositionOnly ? "first position" : "shifts up to seventh position"} · {bars.length} bar
          {bars.length === 1 ? "" : "s"}.
        </p>
      </section>
    </div>
  );
}
