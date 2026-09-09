import React, { useState } from "react";
import App from "./App";
import ViolinAccompanist from "./violin/ViolinAccompanist";

type Tool = "violin" | "harp";

/**
 * The repo holds two stage tools. This picks between them and keeps the
 * harmonica gig tool reachable.
 */
export default function Root(): JSX.Element {
  const [tool, setTool] = useState<Tool>("violin");

  return (
    <div className="app-shell">
      <nav className="tool-switch">
        <button className={tool === "violin" ? "active" : ""} onClick={() => setTool("violin")}>
          🎻 Jam Fiddle
        </button>
        <button className={tool === "harp" ? "active" : ""} onClick={() => setTool("harp")}>
          🎵 Harp Gig-Tool
        </button>
      </nav>
      {tool === "violin" ? <ViolinAccompanist /> : <App />}
    </div>
  );
}
