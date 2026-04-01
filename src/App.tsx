import React, { useState, useEffect } from "react";
import {
  Music,
  Hash,
  ArrowRight,
  Info,
  RotateCcw,
  AlertTriangle,
  Star,
} from "lucide-react";

const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SHAPES = ["E", "A", "D", "G", "C"];
const CAPO_POSITIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const SHAPE_TO_SEMITONES = {
  C: 0,
  D: 2,
  E: 4,
  G: 7,
  A: 9,
};

function getHarpKey(songKey, position) {
  const songIdx = NOTES.indexOf(songKey);
  if (position === 1) return songKey;
  if (position === 2) return NOTES[(songIdx + 5) % 12];
  if (position === 3) return NOTES[(songIdx + 10) % 12];
  return "";
}

export default function App() {
  const [shape, setShape] = useState("E");
  const [isMinor, setIsMinor] = useState(false);
  const [capo, setCapo] = useState(0);
  const [songKey, setSongKey] = useState("E");

  // For setlist
  const [setlistText, setSetlistText] = useState("");
  const [setlist, setSetlist] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [currentCapo, setCurrentCapo] = useState(0);
  const [currentShape, setCurrentShape] = useState("E");
  const [currentIsMinor, setCurrentIsMinor] = useState(false);
  const [harpPosition, setHarpPosition] = useState(1);

  // Calculate actual song key based on shape and capo
  useEffect(() => {
    const baseSemitones = SHAPE_TO_SEMITONES[shape];
    const actualSemitones = (baseSemitones + capo) % 12;
    setSongKey(NOTES[actualSemitones]);
  }, [shape, capo]);

  // When setlist changes, parse it into song objects
  useEffect(() => {
    if (!setlistText.trim()) {
      setSetlist([]);
      setCurrentSongIndex(0);
      return;
    }
    const lines = setlistText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    // Parse lines like "SongName [Capo] Shape m"
    const parsed = lines.map((line) => {
      // Example line: "Crossroads [2] E m" or "Sweet Home [0] A"
      const match = line.match(/^(.+?)(?:\s*\[(\d)\])?\s+([EADGC])\s*(m)?$/i);
      if (match) {
        return {
          name: match[1].trim(),
          capo: Number(match[2] || 0),
          shape: match[3].toUpperCase(),
          isMinor: !!match[4],
        };
      } else {
        return { name: line, capo: 0, shape: "E", isMinor: false };
      }
    });
    setSetlist(parsed);
    setCurrentSongIndex(0);
    if (parsed.length > 0) {
      setCurrentCapo(parsed[0].capo);
      setCurrentShape(parsed[0].shape);
      setCurrentIsMinor(parsed[0].isMinor);
      setHarpPosition(1);
    }
  }, [setlistText]);

  // Calculate song key for current song in setlist
  const currentBaseSemitones = SHAPE_TO_SEMITONES[currentShape];
  const currentActualSemitones = (currentBaseSemitones + currentCapo) % 12;
  const currentSongKey = NOTES[currentActualSemitones];

  // Harp keys for current song and position
  const p1 = getHarpKey(currentSongKey, 1);
  const p2 = getHarpKey(currentSongKey, 2);
  const p3 = getHarpKey(currentSongKey, 3);

  const needsLowWarning = ["F", "F#", "G", "Ab"].includes(p2);

  // Switch between harp positions 1 and 2 when button clicked
  const toggleHarpPosition = () => {
    setHarpPosition((prev) => (prev === 1 ? 2 : 1));
  };

  // Go to next song in setlist (if any)
  const nextSong = () => {
    if (currentSongIndex + 1 < setlist.length) {
      const next = setlist[currentSongIndex + 1];
      setCurrentSongIndex(currentSongIndex + 1);
      setCurrentCapo(next.capo);
      setCurrentShape(next.shape);
      setCurrentIsMinor(next.isMinor);
      setHarpPosition(1);
    }
  };

  // Go to previous song in setlist (if any)
  const prevSong = () => {
    if (currentSongIndex > 0) {
      const prev = setlist[currentSongIndex - 1];
      setCurrentSongIndex(currentSongIndex - 1);
      setCurrentCapo(prev.capo);
      setCurrentShape(prev.shape);
      setCurrentIsMinor(prev.isMinor);
      setHarpPosition(1);
    }
  };

  // Which harp key to display depends on current harp position toggle
  const harpKeyToShow = harpPosition === 1 ? p1 : p2;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-12 font-sans pb-32 overflow-x-hidden">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex justify-between items-center gap-4">
          <div className="flex items-center gap-4 md:gap-6">
            <div className="relative shrink-0">
              <img
                src="https://i.postimg.cc/mrfsRnwB/robbie.jpg"
                alt="Robbie Bluesman"
                className="w-16 h-16 md:w-24 md:h-24 rounded-full border-2 md:border-4 border-orange-600 object-cover shadow-2xl shadow-orange-900/40 bg-zinc-800"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src =
                    "https://ui-avatars.com/api/?name=Robbie+Bluesman&background=ea580c&color=fff&size=256";
                }}
              />
              <div className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2 bg-zinc-950 rounded-full p-1 md:p-2 border border-zinc-800 shadow-md">
                <Music size={14} className="md:w-5 md:h-5 text-orange-500" />
              </div>
            </div>

            <div>
              <h1 className="text-xl md:text-4xl font-black tracking-tighter uppercase italic leading-none">
                Robbie's{" "}
                <span className="text-orange-500 text-3xl md:text-5xl block mt-1">
                  GIG-TOOL
                </span>
              </h1>
              <p className="text-zinc-500 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] mt-1 md:mt-2">
                Professional Rig v2.1
              </p>
            </div>
          </div>

          {needsLowWarning && (
            <div className="animate-pulse bg-yellow-500/10 border-2 border-yellow-500/50 p-2 md:p-4 rounded-xl md:rounded-2xl text-yellow-500">
              <AlertTriangle size={24} className="md:w-8 md:h-8" />
            </div>
          )}
        </header>

        {/* Setlist input */}
        <div className="mb-8 bg-zinc-900 border-2 border-zinc-800 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-8 shadow-2xl space-y-4">
          <label
            htmlFor="setlist"
            className="block uppercase font-bold text-xs tracking-wide text-zinc-400 mb-2"
          >
            Paste your Setlist (one song per line, optional capo & shape):
          </label>
          <textarea
            id="setlist"
            rows={6}
            className="w-full p-3 rounded-lg bg-zinc-800 text-white resize-none font-mono"
            placeholder={`Example:\nCrossroads [2] E m\nSweet Home [0] A\nBlues Jam\n...`}
            value={setlistText}
            onChange={(e) => setSetlistText(e.target.value)}
          />
        </div>

        {/* Current song info */}
        {setlist.length > 0 && (
          <div className="mb-8 bg-zinc-900 border-2 border-zinc-800 rounded-[2rem] md:rounded-[2.5rem] p-5 md:p-8 shadow-2xl space-y-6 md:space-y-10">
            <div className="flex justify-between items-center mb-2">
              <button
                onClick={prevSong}
                disabled={currentSongIndex === 0}
                className={`px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 font-bold transition-opacity ${
                  currentSongIndex === 0
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:border-orange-600 hover:text-orange-600"
                }`}
              >
                ← Prev
              </button>
              <h2 className="text-xl font-black tracking-tight uppercase">
                {setlist[currentSongIndex].name}
              </h2>
              <button
                onClick={nextSong}
                disabled={currentSongIndex === setlist.length - 1}
                className={`px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 font-bold transition-opacity ${
                  currentSongIndex === setlist.length - 1
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:border-orange-600 hover:text-orange-600"
                }`}
              >
                Next →
              </button>
            </div>

            {/* Capo */}
            <div className="flex justify-between items-center mb-6">
              <label className="uppercase font-bold text-xs tracking-widest text-zinc-500">
                Capo Fret
              </label>
              <div className="flex gap-2">
                {CAPO_POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setCurrentCapo(pos)}
                    className={`px-3 py-1 rounded-lg font-bold transition-all border-2 ${
                      currentCapo === pos
                        ? "bg-zinc-100 border-white text-zinc-950 shadow-xl scale-105"
                        : "bg-zinc-800/50 border-zinc-700 text-zinc-500"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {/* Shape and Minor */}
            <div className="flex justify-between items-center mb-6">
              <label className="uppercase font-bold text-xs tracking-widest text-zinc-500">
                Shape & Voicing
              </label>
              <div className="flex gap-2">
                {SHAPES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setCurrentShape(s)}
                    className={`px-4 py-2 rounded-lg font-black text-lg transition-all border-b-4 ${
                      currentShape === s
                        ? currentIsMinor
                          ? "bg-red-700 border-red-950 text-white translate-y-1"
                          : "bg-orange-600 border-orange-900 text-white translate-y-1"
                        : "bg-zinc-800 border-zinc-950 text-zinc-400"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentIsMinor(false)}
                  className={`px-4 py-2 rounded-lg font-black text-lg transition-all ${
                    !currentIsMinor
                      ? "bg-zinc-100 text-zinc-950 shadow-lg"
                      : "text-zinc-500"
                  }`}
                >
                  MAJOR
                </button>
                <button
                  onClick={() => setCurrentIsMinor(true)}
                  className={`px-4 py-2 rounded-lg font-black text-lg transition-all ${
                    currentIsMinor
                      ? "bg-red-600 text-white shadow-lg"
                      : "text-zinc-500"
                  }`}
                >
                  MINOR
                </button>
              </div>
            </div>

            {/* Harp toggle and display */}
            <div
              className={`bg-gradient-to-br rounded-[2rem] md:rounded-[3rem] p-6 md:p-10 shadow-2xl relative overflow-hidden group transition-all duration-500 ${
                currentIsMinor
                  ? "from-red-600 to-red-900"
                  : "from-orange-600 to-orange-800"
              }`}
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-125 transition-transform duration-700">
                <Star
                  size={120}
                  className="md:w-[180px] md:h-[180px]"
                  fill="currentColor"
                />
              </div>
              <div className="relative z-10">
                <p className="text-white/70 font-black uppercase text-[10px] md:text-xs tracking-widest mb-1">
                  {harpPosition === 1
                    ? "1st Position (Straight Harp)"
                    : "2nd Position (Cross Harp)"}
                </p>
                <div className="flex items-end justify-between">
                  <span className="text-[20vw] md:text-[8rem] leading-none font-black text-white tracking-tighter drop-shadow-2xl">
                    {harpKeyToShow}
                    {currentIsMinor ? "m" : ""}
                  </span>
                  <div className="text-right pb-2 md:pb-4">
                    {harpPosition === 1 ? (
                      <p className="text-zinc-500 text-lg md:text-xl font-bold leading-tight tracking-tighter uppercase">
                        Folk &<br />
                        Melody
                      </p>
                    ) : (
                      <>
                        <p className="text-white text-lg md:text-2xl font-black leading-tight italic tracking-tighter">
                          THE BLUES
                          <br />
                          PICK
                        </p>
                        {needsLowWarning && (
                          <div className="mt-2 bg-black/40 px-2 py-1 rounded-lg font-black border border-white/20 inline-block text-[10px]">
                            LOW {p2}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={toggleHarpPosition}
                  className="mt-6 uppercase tracking-wide font-black text-sm px-4 py-2 rounded-xl bg-zinc-100 text-zinc-950 hover:bg-zinc-300 transition-colors"
                >
                  Switch Harp Position
                </button>
              </div>
            </div>

            {/* Pro Advice */}
            <div className="mt-8 p-5 md:p-8 bg-blue-900/10 border-2 border-blue-900/30 rounded-[2rem] flex gap-4 md:gap-6 items-center shadow-inner">
              <div className="bg-blue-500/20 p-2 md:p-4 rounded-xl shrink-0">
                <Info className="text-blue-500 md:w-8 md:h-8" size={24} />
              </div>
              <div className="text-xs md:text-base text-blue-100/80 leading-relaxed font-medium italic">
                {currentIsMinor ? (
                  <p>
                    For <strong>{currentSongKey}m</strong>: Grab the{" "}
                    <strong>{p2}</strong> for that gritty vibe, or try{" "}
                    <strong>{p3}</strong> for a darker, natural minor sound.
                  </p>
                ) : (
                  <p>
                    For <strong>{currentSongKey} Major</strong>: Stick with the{" "}
                    <strong>{p2}</strong> for blues. Focus on the 2nd hole draw
                    root to lock in with Big J.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Clear all */}
        <button
          onClick={() => {
            setSetlistText("");
            setSetlist([]);
            setCurrentSongIndex(0);
            setCurrentCapo(0);
            setCurrentShape("E");
            setCurrentIsMinor(false);
            setHarpPosition(1);
          }}
          className="mt-8 w-full py-4 text-zinc-700 hover:text-orange-500 flex items-center justify-center gap-2 text-[10px] md:text-xs font-black uppercase tracking-[0.4em] transition-all border-2 border-transparent hover:border-orange-900/20 rounded-2xl"
        >
          <RotateCcw size={16} /> Clear Setup
        </button>
      </div>
    </div>
  );
}
