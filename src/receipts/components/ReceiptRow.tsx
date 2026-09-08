import React, { useEffect, useState } from "react";
import { api } from "../api";
import { EXPENSE_TYPES, type ExpenseType, type Receipt, type ReceiptFields } from "../types";

type Props = {
  receipt: Receipt;
  onChanged: (receipt: Receipt) => void;
  onRemoved: (id: string) => void;
};

function formatAmount(value: number | null): string {
  return value == null ? "" : value.toFixed(2);
}

export function ReceiptRow({ receipt, onChanged, onRemoved }: Props): JSX.Element {
  const [draft, setDraft] = useState<ReceiptFields>(receipt.fields);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(receipt.fields);
  }, [receipt.fields]);

  const commit = async (patch: Partial<ReceiptFields>) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateReceipt(receipt.id, patch);
      onChanged(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const needsReview = receipt.reviewReasons.length > 0;

  return (
    <>
      <tr className={needsReview ? "row review" : "row"}>
        <td className="thumb-cell">
          <button className="thumb-button" onClick={() => setOpen((v) => !v)} type="button" title="Show the photo">
            <img className="thumb" src={api.imageUrl(receipt)} alt="Receipt" loading="lazy" />
          </button>
        </td>

        <td>
          <input
            className="cell"
            type="date"
            value={draft.transaction_date ?? ""}
            onChange={(e) => setDraft({ ...draft, transaction_date: e.target.value || null })}
            onBlur={() => commit({ transaction_date: draft.transaction_date })}
          />
        </td>

        <td>
          <input
            className="cell wide"
            type="text"
            placeholder="Merchant"
            value={draft.merchant_name ?? ""}
            onChange={(e) => setDraft({ ...draft, merchant_name: e.target.value || null })}
            onBlur={() => commit({ merchant_name: draft.merchant_name })}
          />
        </td>

        <td>
          <select
            className="cell"
            value={draft.expense_type}
            onChange={(e) => {
              const value = e.target.value as ExpenseType;
              setDraft({ ...draft, expense_type: value });
              void commit({ expense_type: value });
            }}
          >
            {EXPENSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </td>

        <td>
          <input
            className="cell short"
            type="text"
            placeholder="CCY"
            value={draft.currency ?? ""}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() || null })}
            onBlur={() => commit({ currency: draft.currency })}
          />
        </td>

        <td>
          <input
            className="cell amount"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={formatAmount(draft.total_amount)}
            onChange={(e) =>
              setDraft({ ...draft, total_amount: e.target.value === "" ? null : Number(e.target.value) })
            }
            onBlur={() => commit({ total_amount: draft.total_amount })}
          />
        </td>

        <td>
          <input
            className="cell amount"
            type="number"
            step="0.01"
            placeholder="Tax"
            value={formatAmount(draft.tax_amount)}
            onChange={(e) => setDraft({ ...draft, tax_amount: e.target.value === "" ? null : Number(e.target.value) })}
            onBlur={() => commit({ tax_amount: draft.tax_amount })}
          />
        </td>

        <td className="flags">
          {saving ? <span className="chip">Saving</span> : null}
          {receipt.status === "pending" ? <span className="chip">Not read yet</span> : null}
          {receipt.status === "extracting" ? <span className="chip">Reading</span> : null}
          {receipt.emailedAt ? <span className="chip good">Sent to Concur</span> : null}
          {receipt.matchedTransactionId ? <span className="chip good">Matched</span> : null}
          {needsReview ? <span className="chip warn" title={receipt.reviewReasons.join(" ")}>Check</span> : null}
        </td>

        <td className="actions">
          <button className="ghost" onClick={() => setOpen((v) => !v)} type="button">
            {open ? "Hide" : "Open"}
          </button>
          <button
            className="ghost"
            onClick={async () => {
              const updated = await api.toggleIgnore(receipt.id);
              onChanged(updated);
            }}
            type="button"
            title="Exclude this photo from exports"
          >
            {receipt.status === "ignored" ? "Restore" : "Not an expense"}
          </button>
          <button
            className="ghost danger"
            onClick={async () => {
              if (!window.confirm("Delete this receipt and its stored image?")) return;
              await api.deleteReceipt(receipt.id);
              onRemoved(receipt.id);
            }}
            type="button"
          >
            Delete
          </button>
        </td>
      </tr>

      {open ? (
        <tr className="detail">
          <td colSpan={9}>
            <div className="detail-body">
              <a href={api.imageUrl(receipt)} target="_blank" rel="noreferrer">
                <img className="full" src={api.imageUrl(receipt)} alt="Receipt in full" />
              </a>
              <div className="detail-fields">
                {receipt.reviewReasons.length > 0 ? (
                  <p className="warn-text">{receipt.reviewReasons.join(" ")}</p>
                ) : null}
                <label>
                  Location
                  <input
                    type="text"
                    value={draft.merchant_location ?? ""}
                    onChange={(e) => setDraft({ ...draft, merchant_location: e.target.value || null })}
                    onBlur={() => commit({ merchant_location: draft.merchant_location })}
                  />
                </label>
                <label>
                  Payment method
                  <input
                    type="text"
                    value={draft.payment_method ?? ""}
                    onChange={(e) => setDraft({ ...draft, payment_method: e.target.value || null })}
                    onBlur={() => commit({ payment_method: draft.payment_method })}
                  />
                </label>
                <label>
                  Card ending
                  <input
                    type="text"
                    maxLength={4}
                    value={draft.card_last4 ?? ""}
                    onChange={(e) => setDraft({ ...draft, card_last4: e.target.value || null })}
                    onBlur={() => commit({ card_last4: draft.card_last4 })}
                  />
                </label>
                <label>
                  Receipt number
                  <input
                    type="text"
                    value={draft.invoice_number ?? ""}
                    onChange={(e) => setDraft({ ...draft, invoice_number: e.target.value || null })}
                    onBlur={() => commit({ invoice_number: draft.invoice_number })}
                  />
                </label>
                <label>
                  Comment for Concur
                  <textarea
                    rows={2}
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
                    onBlur={() => commit({ notes: draft.notes })}
                  />
                </label>

                {receipt.extraction && receipt.extraction.line_items.length > 0 ? (
                  <div>
                    <h4>Items read</h4>
                    <ul className="items">
                      {receipt.extraction.line_items.map((item, index) => (
                        <li key={`${item.description}-${index}`}>
                          {item.description}
                          {item.amount != null ? ` — ${item.amount.toFixed(2)}` : ""}
                        </li>
                      ))}
                    </ul>
                    {receipt.extraction.contains_alcohol ? (
                      <p className="warn-text">Contains alcohol. Many travel policies need this itemised.</p>
                    ) : null}
                  </div>
                ) : null}

                {receipt.error ? <p className="error">{receipt.error}</p> : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}

      {error ? (
        <tr>
          <td colSpan={9} className="error">
            {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}
