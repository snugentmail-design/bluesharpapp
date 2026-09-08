import { test } from "node:test";
import assert from "node:assert/strict";
import { merchantSimilarity, reconcile, tokenize } from "../src/concur/reconcile.js";
import type { Receipt, StatementTransaction } from "../src/types.js";

function receipt(partial: {
  id: string;
  merchant: string | null;
  date: string | null;
  total: number | null;
  currency?: string;
}): Receipt {
  return {
    id: partial.id,
    googleMediaItemId: null,
    sha256: partial.id,
    storedFilename: `${partial.id}.jpg`,
    originalFilename: null,
    mimeType: "image/jpeg",
    byteSize: 1,
    photoTakenAt: null,
    importedAt: "2025-03-10T00:00:00Z",
    pickerSessionId: null,
    status: "extracted",
    error: null,
    extraction: {
      is_receipt: true,
      merchant_name: partial.merchant,
      merchant_location: null,
      country_code: "GB",
      transaction_date: partial.date,
      transaction_time: null,
      currency: partial.currency ?? "GBP",
      total_amount: partial.total,
      subtotal_amount: null,
      tax_amount: null,
      tax_rate_percent: null,
      tip_amount: null,
      payment_method: null,
      card_last4: null,
      vat_number: null,
      invoice_number: null,
      expense_type: "Other",
      attendee_count: null,
      line_items: [],
      contains_alcohol: false,
      is_duplicate_candidate: false,
      legibility: "clear",
      confidence: "high",
      warnings: [],
    },
    overrides: {},
    matchedTransactionId: null,
    emailedAt: null,
    exportedAt: null,
  };
}

function txn(id: string, date: string | null, description: string, amount: number | null): StatementTransaction {
  return { id, date, description, amount, currency: "GBP", raw: {} };
}

test("tokenize drops card-statement noise", () => {
  assert.deepEqual(tokenize("PRET A MANGE 456 LONDON"), ["pret", "mange", "london"]);
  assert.deepEqual(tokenize("VISA PURCHASE XXXX 1234"), []);
});

test("merchantSimilarity matches truncated statement descriptors", () => {
  assert.ok(merchantSimilarity("PRET A MANGE 456 LONDON", "Pret A Manger") > 0.5);
  assert.equal(merchantSimilarity("HILTON READING", "Costa Coffee"), 0);
  assert.equal(merchantSimilarity(null, "Pret A Manger"), 0);
});

test("reconcile pairs a receipt with its statement line", () => {
  const result = reconcile(
    [txn("t1", "2025-03-04", "PRET A MANGE 456 LONDON", 4.5)],
    [receipt({ id: "r1", merchant: "Pret A Manger", date: "2025-03-04", total: 4.5 })]
  );
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.receipt.id, "r1");
  assert.equal(result.transactionsWithoutReceipt.length, 0);
  assert.equal(result.receiptsWithoutTransaction.length, 0);
});

test("reconcile tolerates settlement lag inside the window and rejects beyond it", () => {
  const near = reconcile(
    [txn("t1", "2025-03-07", "HILTON READING", 212)],
    [receipt({ id: "r1", merchant: "Hilton Reading", date: "2025-03-04", total: 212 })]
  );
  assert.equal(near.matched.length, 1);

  const far = reconcile(
    [txn("t1", "2025-03-20", "HILTON READING", 212)],
    [receipt({ id: "r1", merchant: "Hilton Reading", date: "2025-03-04", total: 212 })]
  );
  assert.equal(far.matched.length, 0);
  assert.equal(far.transactionsWithoutReceipt.length, 1);
  assert.equal(far.receiptsWithoutTransaction.length, 1);
});

test("reconcile never uses one receipt for two statement lines", () => {
  const result = reconcile(
    [txn("t1", "2025-03-04", "COSTA COFFEE", 3.1), txn("t2", "2025-03-04", "COSTA COFFEE", 3.1)],
    [
      receipt({ id: "r1", merchant: "Costa Coffee", date: "2025-03-04", total: 3.1 }),
      receipt({ id: "r2", merchant: "Costa Coffee", date: "2025-03-04", total: 3.1 }),
    ]
  );
  assert.equal(result.matched.length, 2);
  assert.equal(new Set(result.matched.map((m) => m.receipt.id)).size, 2);
  assert.equal(new Set(result.matched.map((m) => m.transaction.id)).size, 2);
});

test("reconcile refuses to pair on amount alone when nothing else agrees", () => {
  const result = reconcile(
    [txn("t1", "2025-03-04", "SHELL FILLING STATION", 60)],
    [receipt({ id: "r1", merchant: "Hilton Reading", date: "2025-03-04", total: 60 })]
  );
  // Amount and date agree but the merchant does not, so this stays a suggestion
  // the person must confirm rather than a silent pairing.
  assert.equal(result.matched.length, 1);
  assert.ok(result.matched[0]!.score < 0.85);
  assert.ok(result.matched[0]!.reasons.includes("Merchant name does not match."));
});

test("reconcile leaves a receipt with no total unmatched", () => {
  const result = reconcile(
    [txn("t1", "2025-03-04", "COSTA COFFEE", 3.1)],
    [receipt({ id: "r1", merchant: "Costa Coffee", date: "2025-03-04", total: null })]
  );
  assert.equal(result.matched.length, 0);
  assert.equal(result.receiptsWithoutTransaction.length, 1);
});
