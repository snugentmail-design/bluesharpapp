import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ImportPanel } from "./components/ImportPanel";
import { ReceiptTable } from "./components/ReceiptTable";
import { ExportPanel } from "./components/ExportPanel";
import { ReconcilePanel } from "./components/ReconcilePanel";
import type { ExtractionProgress, Receipt, Status } from "./types";
import "./receipts.css";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const parts = month.split("-");
  const year = Number(parts[0]);
  const index = Number(parts[1]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(index)) return month;
  return new Date(year, index, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function ReceiptsApp(): JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(currentMonth());
  const [counts, setCounts] = useState({ total: 0, pending: 0, failed: 0 });
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"receipts" | "reconcile">("receipts");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch (err) {
      setError(
        `Cannot reach the receipt server. Start it with "npm run server" in another terminal. (${(err as Error).message})`
      );
    }
  }, []);

  const refreshReceipts = useCallback(async () => {
    try {
      const data = await api.listReceipts(month);
      setReceipts(data.receipts);
      setMonths(data.months);
      setCounts(data.counts);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [month]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    void refreshReceipts();
  }, [refreshReceipts]);

  // Reading receipts runs in the background on the server, so watch its progress
  // and pull the table again each time a batch lands.
  const watchProgress = useCallback(() => {
    if (pollTimer.current) return;
    pollTimer.current = setInterval(async () => {
      try {
        const next = await api.progress();
        setProgress(next);
        if (!next.running) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          await refreshReceipts();
        }
      } catch {
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, 1500);
  }, [refreshReceipts]);

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    []
  );

  const readReceipts = useCallback(async () => {
    try {
      await api.extract();
      setProgress({ running: true, total: counts.pending, done: 0, failed: 0, startedAt: null, lastError: null });
      watchProgress();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [counts.pending, watchProgress]);

  const connect = useCallback(async () => {
    try {
      const { url } = await api.googleAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const onReceiptChanged = useCallback((updated: Receipt) => {
    setReceipts((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  const onReceiptRemoved = useCallback((id: string) => {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const allMonths = Array.from(new Set([currentMonth(), ...months])).sort().reverse();

  return (
    <div className="receipts-app">
      <header className="app-head">
        <div>
          <h1>Receipts to Concur</h1>
          <p className="muted">
            Pick a month of receipt photos out of Google Photos, let them be read, check the few that need it, then
            send them to SAP Concur.
          </p>
        </div>
        <div className="account">
          {status?.googleConnected ? (
            <>
              <span className="chip good">{status.googleEmail ?? "Google connected"}</span>
              <button
                className="ghost"
                type="button"
                onClick={async () => {
                  await api.disconnectGoogle();
                  await refreshStatus();
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button className="primary" disabled={!status?.googleConfigured} onClick={connect} type="button">
              Connect Google Photos
            </button>
          )}
        </div>
      </header>

      {error ? <p className="error banner">{error}</p> : null}

      {status && !status.anthropicConfigured ? (
        <p className="warn-text banner">
          No Anthropic API key is set, so receipts can be imported but not read. Photos will still import and can be
          filled in by hand.
        </p>
      ) : null}

      <div className="toolbar">
        <label className="inline">
          Month
          <select value={month ?? ""} onChange={(e) => setMonth(e.target.value || null)}>
            <option value="">Everything</option>
            {allMonths.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>

        <button
          className="primary"
          type="button"
          disabled={counts.pending === 0 || Boolean(progress?.running) || !status?.anthropicConfigured}
          onClick={readReceipts}
        >
          {progress?.running
            ? `Reading ${progress.done} of ${progress.total}`
            : `Read ${counts.pending} new receipt${counts.pending === 1 ? "" : "s"}`}
        </button>

        <button className="ghost" type="button" onClick={() => void refreshReceipts()}>
          Refresh
        </button>

        <div className="tabs">
          <button className={tab === "receipts" ? "tab on" : "tab"} onClick={() => setTab("receipts")} type="button">
            Receipts
          </button>
          <button className={tab === "reconcile" ? "tab on" : "tab"} onClick={() => setTab("reconcile")} type="button">
            Reconcile
          </button>
        </div>
      </div>

      {progress?.running ? (
        <div className="progress">
          <div className="bar" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
      ) : null}

      {progress && !progress.running && progress.failed > 0 ? (
        <p className="warn-text banner">
          {progress.failed} receipt{progress.failed === 1 ? "" : "s"} could not be read. {progress.lastError ?? ""}
        </p>
      ) : null}

      {status ? <ImportPanel status={status} onImported={() => void refreshReceipts()} /> : null}

      {tab === "receipts" ? (
        <>
          <ReceiptTable receipts={receipts} onChanged={onReceiptChanged} onRemoved={onReceiptRemoved} />
          {status ? <ExportPanel month={month} receipts={receipts} status={status} /> : null}
        </>
      ) : (
        <ReconcilePanel month={month} />
      )}
    </div>
  );
}
