import { stringify } from "csv-stringify/sync";
import archiver from "archiver";
import path from "node:path";
import fs from "node:fs";
import type { Writable } from "node:stream";
import { config } from "../config.js";
import type { Receipt } from "../types.js";
import { effectiveFields, receiptSlug, reviewReasons } from "../extract/normalize.js";

/**
 * Columns match the SAP Concur Quick Expense / Available Expenses import shape.
 * Concur's importer is tolerant about extra columns, so the review helpers ride
 * along at the end for the person checking the file before upload.
 */
const CSV_COLUMNS = [
  "Transaction Date",
  "Expense Type",
  "Vendor",
  "City of Purchase",
  "Payment Type",
  "Amount",
  "Currency",
  "Tax Amount",
  "Receipt Number",
  "Card Last 4",
  "Comment",
  "Needs Review",
  "Review Notes",
  "Receipt File",
] as const;

export function toConcurCsv(receipts: Receipt[]): string {
  const rows = receipts.map((receipt) => {
    const f = effectiveFields(receipt);
    const reasons = reviewReasons(receipt);
    return {
      "Transaction Date": f.transaction_date ?? "",
      "Expense Type": f.expense_type,
      Vendor: f.merchant_name ?? "",
      "City of Purchase": f.merchant_location ?? "",
      "Payment Type": f.payment_method ?? "",
      Amount: f.total_amount != null ? f.total_amount.toFixed(2) : "",
      Currency: f.currency ?? "",
      "Tax Amount": f.tax_amount != null ? f.tax_amount.toFixed(2) : "",
      "Receipt Number": f.invoice_number ?? "",
      "Card Last 4": f.card_last4 ?? "",
      Comment: f.notes ?? "",
      "Needs Review": reasons.length > 0 ? "YES" : "",
      "Review Notes": reasons.join(" "),
      "Receipt File": `${receiptSlug(receipt)}${path.extname(receipt.storedFilename)}`,
    };
  });

  return stringify(rows, { header: true, columns: [...CSV_COLUMNS] });
}

/** Streams a ZIP of every receipt image, renamed to date_merchant_amount. */
export function writeReceiptZip(receipts: Receipt[], out: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });
    out.on("close", resolve);
    out.on("finish", resolve);
    archive.pipe(out);

    const usedNames = new Set<string>();
    for (const receipt of receipts) {
      const filePath = path.join(config.imagesDir, receipt.storedFilename);
      if (!fs.existsSync(filePath)) continue;

      const ext = path.extname(receipt.storedFilename) || ".jpg";
      let name = `${receiptSlug(receipt)}${ext}`;
      let counter = 2;
      while (usedNames.has(name)) {
        name = `${receiptSlug(receipt)}_${counter}${ext}`;
        counter += 1;
      }
      usedNames.add(name);
      archive.file(filePath, { name });
    }

    archive.append(toConcurCsv(receipts), { name: "concur-expenses.csv" });
    archive.finalize().catch(reject);
  });
}
