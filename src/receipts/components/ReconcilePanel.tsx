import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ReconcileResponse } from "../types";

type Props = { month: string | null };

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  return `${currency ? `${currency} ` : ""}${amount.toFixed(2)}`;
}

export function ReconcilePanel({ month }: Props): JSX.Element {
  const [data, setData] = useState<ReconcileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.reconcile(month));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      await api.uploadStatement(file.name, text);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section className="panel">
      <h2>Reconcile against the card statement</h2>
      <p className="muted">
        Export the month's card transactions from Concur, or download them from the card provider, and drop the file
        here. Every receipt is paired to a transaction by amount, date and merchant name, so what is left in each
        column is exactly what needs attention.
      </p>

      <div className="button-row">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {data?.statement ? (
          <button
            className="ghost"
            type="button"
            onClick={async () => {
              await api.clearStatement();
              await load();
            }}
          >
            Clear statement
          </button>
        ) : null}
      </div>

      {busy ? <p className="muted">Reading the file.</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {data?.statement ? (
        <p className="muted">
          Using {data.statement.label}, {data.statement.count} transaction
          {data.statement.count === 1 ? "" : "s"}, uploaded {new Date(data.statement.uploadedAt).toLocaleString()}.
        </p>
      ) : (
        <p className="muted">No statement loaded yet.</p>
      )}

      {data ? (
        <div className="reconcile-grid">
          <div>
            <h3>Charges with no receipt ({data.transactionsWithoutReceipt.length})</h3>
            {data.transactionsWithoutReceipt.length === 0 ? (
              <p className="good-text">Every charge has a receipt.</p>
            ) : (
              <ul className="stack">
                {data.transactionsWithoutReceipt.map((t) => (
                  <li key={t.id}>
                    <strong>{money(t.amount, t.currency)}</strong> {t.description || "no description"}
                    <span className="muted"> {t.date ?? "no date"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>Receipts with no charge ({data.receiptsWithoutTransaction.length})</h3>
            {data.receiptsWithoutTransaction.length === 0 ? (
              <p className="good-text">Every receipt is accounted for.</p>
            ) : (
              <ul className="stack">
                {data.receiptsWithoutTransaction.map((r) => (
                  <li key={r.id}>
                    <strong>{money(r.fields.total_amount, r.fields.currency)}</strong>{" "}
                    {r.fields.merchant_name ?? "unknown merchant"}
                    <span className="muted"> {r.fields.transaction_date ?? "no date"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="span-2">
            <h3>Paired ({data.matched.length})</h3>
            {data.matched.length === 0 ? (
              <p className="muted">Nothing paired yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="grid compact">
                  <thead>
                    <tr>
                      <th>Statement line</th>
                      <th>Receipt</th>
                      <th>Amount</th>
                      <th>Confidence</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.matched.map((m) => (
                      <tr key={m.transaction.id} className={m.score < 0.75 ? "review" : undefined}>
                        <td>
                          {m.transaction.description || "no description"}
                          <span className="muted"> {m.transaction.date ?? ""}</span>
                        </td>
                        <td>{m.receipt.fields.merchant_name ?? "unknown"}</td>
                        <td>{money(m.transaction.amount, m.transaction.currency)}</td>
                        <td>{Math.round(m.score * 100)}%</td>
                        <td className="muted">{m.reasons.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
