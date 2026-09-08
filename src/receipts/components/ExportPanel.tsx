import React, { useState } from "react";
import { api } from "../api";
import type { Receipt, Status } from "../types";

type Props = {
  month: string | null;
  receipts: Receipt[];
  status: Status;
};

export function ExportPanel({ month, receipts, status }: Props): JSX.Element {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<"receipts" | "expenseit">("receipts");

  const ready = receipts.filter(
    (r) => r.fields.merchant_name && r.fields.transaction_date && r.fields.total_amount != null
  );
  const unsent = ready.filter((r) => !r.emailedAt);

  const send = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.emailToConcur({ month, target, onlyUnsent: true });
      setResult(
        `Sent ${response.sent} to ${response.target}. Failed ${response.failed}.` +
          (response.failed > 0
            ? ` First failure: ${response.results.find((r) => !r.ok)?.error ?? "unknown"}`
            : "")
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel">
      <h2>Send to Concur</h2>

      <div className="export-grid">
        <div className="export-option">
          <h3>Email straight into Concur</h3>
          <p className="muted">
            Sends each receipt image as its own email. Concur ties them to the traveller by the sending address, so
            that address must be verified on the SAP Concur profile under Profile Settings, Email Addresses.
          </p>

          <label className="inline">
            <input
              type="radio"
              name="target"
              checked={target === "receipts"}
              onChange={() => setTarget("receipts")}
            />
            <span>
              {status.receiptsAddress} — lands in Available Receipts, ready to attach to an expense line.
            </span>
          </label>
          <label className="inline">
            <input
              type="radio"
              name="target"
              checked={target === "expenseit"}
              onChange={() => setTarget("expenseit")}
            />
            <span>
              {status.expenseItAddress} — creates the expense entry itself. Needs an ExpenseIt licence.
            </span>
          </label>

          {status.emailConfigured ? (
            <>
              <p className="muted">Sending as {status.emailFrom}.</p>
              <button className="primary big" disabled={sending || unsent.length === 0} onClick={send} type="button">
                {sending ? "Sending" : `Email ${unsent.length} receipt${unsent.length === 1 ? "" : "s"} to Concur`}
              </button>
              {unsent.length === 0 && ready.length > 0 ? (
                <p className="muted">Everything ready in this month has already been sent.</p>
              ) : null}
            </>
          ) : (
            <p className="muted">
              Email is not set up. Add the SMTP settings to the server environment to switch this on. The README has
              the Gmail app-password steps.
            </p>
          )}
        </div>

        <div className="export-option">
          <h3>Download instead</h3>
          <p className="muted">
            The spreadsheet matches the Concur Quick Expense import columns, with two extra columns flagging anything
            worth checking. The ZIP holds the same spreadsheet plus every image renamed to date, merchant and amount.
          </p>
          <div className="button-row">
            <a className="button" href={api.csvUrl(month)}>
              Download spreadsheet
            </a>
            <a className="button" href={api.zipUrl(month)}>
              Download images and spreadsheet
            </a>
          </div>
        </div>
      </div>

      {ready.length < receipts.length ? (
        <p className="warn-text">
          {receipts.length - ready.length} receipt
          {receipts.length - ready.length === 1 ? " is" : "s are"} missing a merchant, date or total and will be left
          out of the email. They are still in the spreadsheet and the ZIP.
        </p>
      ) : null}

      {result ? <p className="good-text">{result}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
