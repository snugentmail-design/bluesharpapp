import React, { useMemo, useState } from "react";
import { ReceiptRow } from "./ReceiptRow";
import type { Receipt } from "../types";

type Props = {
  receipts: Receipt[];
  onChanged: (receipt: Receipt) => void;
  onRemoved: (id: string) => void;
};

type Filter = "all" | "review" | "ready";

export function ReceiptTable({ receipts, onChanged, onRemoved }: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    if (filter === "review") return receipts.filter((r) => r.reviewReasons.length > 0);
    if (filter === "ready") return receipts.filter((r) => r.reviewReasons.length === 0);
    return receipts;
  }, [receipts, filter]);

  const totalsByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const receipt of shown) {
      if (receipt.fields.total_amount == null) continue;
      const currency = receipt.fields.currency ?? "?";
      totals.set(currency, (totals.get(currency) ?? 0) + receipt.fields.total_amount);
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [shown]);

  const reviewCount = receipts.filter((r) => r.reviewReasons.length > 0).length;

  if (receipts.length === 0) {
    return (
      <section className="panel">
        <h2>Receipts</h2>
        <p className="muted">Nothing here yet. Import a month of photos to begin.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Receipts</h2>
        <div className="filters">
          <button className={filter === "all" ? "tab on" : "tab"} onClick={() => setFilter("all")} type="button">
            All {receipts.length}
          </button>
          <button className={filter === "review" ? "tab on" : "tab"} onClick={() => setFilter("review")} type="button">
            Needs a look {reviewCount}
          </button>
          <button className={filter === "ready" ? "tab on" : "tab"} onClick={() => setFilter("ready")} type="button">
            Ready {receipts.length - reviewCount}
          </button>
        </div>
      </div>

      {totalsByCurrency.length > 0 ? (
        <table className="totals">
          <tbody>
            {totalsByCurrency.map(([currency, total]) => (
              <tr key={currency}>
                <th scope="row">{currency}</th>
                <td>{total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Date</th>
              <th>Merchant</th>
              <th>Expense type</th>
              <th>CCY</th>
              <th>Total</th>
              <th>Tax</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((receipt) => (
              <ReceiptRow key={receipt.id} receipt={receipt} onChanged={onChanged} onRemoved={onRemoved} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
