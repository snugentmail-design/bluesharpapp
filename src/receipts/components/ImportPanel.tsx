import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ImportSummary, PickerSession, Status } from "../types";

type Phase = "idle" | "opening" | "waiting" | "importing" | "done" | "error";

type Props = {
  status: Status;
  onImported: (summary: ImportSummary) => void;
};

export function ImportPanel({ status, onImported }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<PickerSession | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setSummary(null);
    setPhase("opening");
    cancelled.current = false;

    try {
      const created = await api.createPickerSession();
      setSession(created);
      setPhase("waiting");
      window.open(created.pickerUri, "_blank", "noopener,noreferrer");

      // Google tells us how often to ask. Poll until the picker reports that the
      // user pressed Done, then pull the bytes for what they ticked.
      let interval = created.pollIntervalMs || 3000;
      const deadline = Date.now() + 15 * 60 * 1000;

      while (!cancelled.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        if (cancelled.current) return;
        const polled = await api.pollPickerSession(created.sessionId);
        interval = polled.pollIntervalMs || interval;
        if (polled.mediaItemsSet) {
          setPhase("importing");
          const result = await api.importPicked(created.sessionId);
          if (cancelled.current) return;
          setSummary(result);
          setPhase("done");
          onImported(result);
          return;
        }
      }
      if (!cancelled.current) {
        setPhase("error");
        setError("The picker was left open for 15 minutes without finishing. Press the button to start again.");
      }
    } catch (err) {
      if (cancelled.current) return;
      setPhase("error");
      setError((err as Error).message);
    }
  }, [onImported]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    setPhase("idle");
    setSession(null);
  }, []);

  if (!status.googleConfigured) {
    return (
      <section className="panel">
        <h2>Import from Google Photos</h2>
        <p className="muted">
          Google is not set up yet. Add a client ID and secret to the server environment, then restart it. The README
          covers the five minutes of Google Cloud setup this needs.
        </p>
      </section>
    );
  }

  if (!status.googleConnected) {
    return (
      <section className="panel">
        <h2>Import from Google Photos</h2>
        <p className="muted">Connect the Google account that holds the receipt photos to get started.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Import from Google Photos</h2>

      {phase === "idle" || phase === "error" || phase === "done" ? (
        <button className="primary big" onClick={start} type="button">
          Pick receipts from Google Photos
        </button>
      ) : null}

      {phase === "opening" ? <p className="muted">Opening the Google picker.</p> : null}

      {phase === "waiting" && session ? (
        <div className="waiting">
          <p>
            The Google Photos picker opened in a new tab. Select every receipt for the month, then press Done. This
            page picks up automatically.
          </p>
          <p className="muted">
            To pick on the phone instead, scan this code with the Pixel. The picker uses the Google Photos app, so its
            own date filters and albums are available while selecting.
          </p>
          {session.qrDataUrl ? <img className="qr" src={session.qrDataUrl} alt="Code to open the picker on a phone" /> : null}
          <p>
            <a href={session.pickerUri} target="_blank" rel="noreferrer">
              Reopen the picker
            </a>
          </p>
          <button className="ghost" onClick={cancel} type="button">
            Cancel
          </button>
        </div>
      ) : null}

      {phase === "importing" ? <p>Downloading the photos you picked.</p> : null}

      {phase === "done" && summary ? (
        <div className="summary">
          <p>
            Imported {summary.imported}. Skipped {summary.duplicates} already held. Failed {summary.failed}.
          </p>
          {summary.errors.length > 0 ? (
            <ul className="errors">
              {summary.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
