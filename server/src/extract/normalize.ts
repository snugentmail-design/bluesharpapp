import type { ExpenseType, Receipt, ReceiptFields } from "../types.js";

/**
 * Merges what the model read with any manual correction, so every consumer
 * (table, CSV, email, matcher) works from one agreed set of values.
 */
export function effectiveFields(receipt: Receipt): ReceiptFields {
  const e = receipt.extraction;
  const o = receipt.overrides ?? {};
  const pick = <K extends keyof ReceiptFields>(key: K, fromExtraction: ReceiptFields[K]): ReceiptFields[K] =>
    key in o && o[key] !== undefined ? (o[key] as ReceiptFields[K]) : fromExtraction;

  return {
    merchant_name: pick("merchant_name", e?.merchant_name ?? null),
    merchant_location: pick("merchant_location", e?.merchant_location ?? null),
    transaction_date: pick("transaction_date", e?.transaction_date ?? fallbackDate(receipt)),
    currency: pick("currency", e?.currency ?? null),
    total_amount: pick("total_amount", e?.total_amount ?? null),
    tax_amount: pick("tax_amount", e?.tax_amount ?? null),
    expense_type: pick("expense_type", (e?.expense_type as ExpenseType) ?? "Other"),
    payment_method: pick("payment_method", e?.payment_method ?? null),
    card_last4: pick("card_last4", e?.card_last4 ?? null),
    invoice_number: pick("invoice_number", e?.invoice_number ?? null),
    notes: pick("notes", null),
  };
}

function fallbackDate(receipt: Receipt): string | null {
  return receipt.photoTakenAt ? receipt.photoTakenAt.slice(0, 10) : null;
}

/** A receipt is ready for Concur when merchant, date and total are all present. */
export function isComplete(fields: ReceiptFields): boolean {
  return Boolean(fields.merchant_name && fields.transaction_date && fields.total_amount != null);
}

/** Reasons a human should look at this row before it is exported. */
export function reviewReasons(receipt: Receipt): string[] {
  const reasons: string[] = [];
  const fields = effectiveFields(receipt);
  const hasOverride = (key: keyof ReceiptFields) => receipt.overrides?.[key] !== undefined;

  if (receipt.status === "failed") reasons.push(receipt.error ?? "Reading failed.");
  if (receipt.extraction && !receipt.extraction.is_receipt) reasons.push("Does not look like a receipt.");
  if (!fields.merchant_name) reasons.push("No merchant.");
  if (!fields.transaction_date) reasons.push("No date.");
  if (fields.total_amount == null) reasons.push("No total.");
  if (!fields.currency && fields.total_amount != null) reasons.push("No currency.");
  if (receipt.extraction?.confidence === "low" && !hasOverride("total_amount")) {
    reasons.push("Low confidence.");
  }
  if (receipt.extraction?.legibility === "poor") reasons.push("Hard to read.");
  if (receipt.extraction?.is_duplicate_candidate) reasons.push("Possible duplicate photo.");
  for (const warning of receipt.extraction?.warnings ?? []) reasons.push(warning);
  return reasons;
}

/** YYYY-MM bucket used by the month filter, based on the purchase date. */
export function monthOf(receipt: Receipt): string | null {
  const date = effectiveFields(receipt).transaction_date;
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null;
}

/** Filename used in the export ZIP and the email subject. */
export function receiptSlug(receipt: Receipt): string {
  const f = effectiveFields(receipt);
  const date = f.transaction_date ?? "undated";
  const merchant = (f.merchant_name ?? "unknown")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unknown";
  const amount = f.total_amount != null ? f.total_amount.toFixed(2) : "0.00";
  const currency = f.currency ?? "";
  return [date, merchant, `${amount}${currency ? `-${currency}` : ""}`].join("_");
}
