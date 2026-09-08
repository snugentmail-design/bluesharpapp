import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The data layer reads its location from the environment at import time, so the
// temp directory must be set before anything else is loaded.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-test-"));
process.env.DATA_DIR = tempDir;

const { receipts } = await import("../src/db.js");
const { config } = await import("../src/config.js");
const { toConcurCsv, writeReceiptZip } = await import("../src/concur/export.js");
const { effectiveFields, receiptSlug, reviewReasons, isComplete } = await import(
  "../src/extract/normalize.js"
);
const { parseStatementCsv } = await import("../src/concur/statement.js");
const { reconcile } = await import("../src/concur/reconcile.js");
const { ReceiptExtractionSchema } = await import("../src/types.js");

// A one-pixel JPEG stands in for a photo. Nothing under test decodes the bytes.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

function seed(id: string, fields: { merchant: string; date: string; total: number; tax?: number }) {
  const storedFilename = `${id}.jpg`;
  fs.writeFileSync(path.join(config.imagesDir, storedFilename), JPEG);
  const extraction = ReceiptExtractionSchema.parse({
    is_receipt: true,
    merchant_name: fields.merchant,
    merchant_location: "London",
    country_code: "GB",
    transaction_date: fields.date,
    transaction_time: "12:04",
    currency: "GBP",
    total_amount: fields.total,
    subtotal_amount: null,
    tax_amount: fields.tax ?? null,
    tax_rate_percent: null,
    tip_amount: null,
    payment_method: "Visa",
    card_last4: "4321",
    vat_number: null,
    invoice_number: "INV-1",
    expense_type: "Meals - Self",
    attendee_count: null,
    line_items: [{ description: "Flat white", amount: fields.total }],
    contains_alcohol: false,
    is_duplicate_candidate: false,
    legibility: "clear",
    confidence: "high",
    warnings: [],
  });

  receipts.insert({
    id,
    googleMediaItemId: `google-${id}`,
    sha256: id,
    storedFilename,
    originalFilename: "PXL_20250304_120400.jpg",
    mimeType: "image/jpeg",
    byteSize: JPEG.byteLength,
    photoTakenAt: `${fields.date}T12:04:00Z`,
    importedAt: new Date().toISOString(),
    pickerSessionId: "session-1",
    status: "extracted",
    error: null,
    extraction,
    overrides: {},
    matchedTransactionId: null,
    emailedAt: null,
    exportedAt: null,
  });
}

before(() => {
  seed("aaaa", { merchant: "Pret A Manger", date: "2025-03-04", total: 4.5, tax: 0.75 });
  seed("bbbb", { merchant: "Hilton Reading", date: "2025-03-05", total: 212 });
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("stored receipts round-trip through the database", () => {
  const all = receipts.all();
  assert.equal(all.length, 2);
  assert.equal(all.every((r) => r.status === "extracted"), true);
});

test("a manual correction overrides what the model read", () => {
  receipts.setOverrides("aaaa", { total_amount: 5.25, merchant_name: "Pret A Manger, Kings Cross" });
  const updated = receipts.get("aaaa")!;
  const fields = effectiveFields(updated);
  assert.equal(fields.total_amount, 5.25);
  assert.equal(fields.merchant_name, "Pret A Manger, Kings Cross");
  // Untouched fields still come from the extraction.
  assert.equal(fields.tax_amount, 0.75);
  assert.equal(reviewReasons(updated).length, 0);
  receipts.setOverrides("aaaa", {});
});

test("the export filename carries date, merchant and amount", () => {
  assert.equal(receiptSlug(receipts.get("bbbb")!), "2025-03-05_Hilton-Reading_212.00-GBP");
});

test("the Concur CSV has one row per receipt with the expected columns", () => {
  const csv = toConcurCsv(receipts.all());
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^Transaction Date,Expense Type,Vendor/);
  assert.ok(csv.includes("Hilton Reading"));
  assert.ok(csv.includes("212.00"));
  assert.ok(csv.includes("2025-03-04"));
});

test("an incomplete receipt is flagged rather than silently exported", () => {
  receipts.setOverrides("bbbb", { total_amount: null });
  const receipt = receipts.get("bbbb")!;
  assert.equal(isComplete(effectiveFields(receipt)), false);
  assert.ok(reviewReasons(receipt).includes("No total."));
  const csv = toConcurCsv([receipt]);
  assert.ok(csv.includes("YES"));
  receipts.setOverrides("bbbb", {});
});

test("the ZIP contains every image plus the spreadsheet", async () => {
  const zipPath = path.join(tempDir, "out.zip");
  const out = fs.createWriteStream(zipPath);
  await writeReceiptZip(receipts.all(), out);

  const bytes = fs.readFileSync(zipPath);
  assert.ok(bytes.byteLength > 0);
  // Local file headers carry the entry names in plain text.
  const text = bytes.toString("latin1");
  assert.ok(text.includes("concur-expenses.csv"));
  assert.ok(text.includes("2025-03-05_Hilton-Reading_212.00-GBP.jpg"));
  assert.ok(text.includes("2025-03-04_Pret-A-Manger_4.50-GBP.jpg"));
});

test("a real statement reconciles against the stored receipts", () => {
  const csv = [
    "Transaction Date,Description,Billed Amount,Currency",
    "04/03/2025,PRET A MANGE 456 LONDON,-4.50,GBP",
    "06/03/2025,HILTON READING GB,-212.00,GBP",
    "07/03/2025,UBER TRIP HELP.UBER.COM,-18.40,GBP",
  ].join("\n");

  const { transactions } = parseStatementCsv(csv);
  const result = reconcile(transactions, receipts.all());

  assert.equal(result.matched.length, 2);
  assert.equal(result.transactionsWithoutReceipt.length, 1);
  assert.equal(result.transactionsWithoutReceipt[0]!.description, "UBER TRIP HELP.UBER.COM");
  assert.equal(result.receiptsWithoutTransaction.length, 0);
});
