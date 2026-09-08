import React, { useState } from "react";
import ReceiptsApp from "./receipts/ReceiptsApp";
import BluesHarpApp from "./BluesHarpApp";

type View = "receipts" | "harp";

/**
 * This repository holds two unrelated tools. The receipt reconciler is the
 * default; the original blues harp helper is kept behind a switch so it is not
 * lost.
 */
export default function App(): JSX.Element {
  const [view, setView] = useState<View>("receipts");

  return (
    <div>
      <nav className="app-switch">
        <button
          className={view === "receipts" ? "on" : ""}
          onClick={() => setView("receipts")}
          type="button"
        >
          Receipts to Concur
        </button>
        <button className={view === "harp" ? "on" : ""} onClick={() => setView("harp")} type="button">
          Blues harp helper
        </button>
      </nav>
      {view === "receipts" ? <ReceiptsApp /> : <BluesHarpApp />}
    </div>
  );
}
