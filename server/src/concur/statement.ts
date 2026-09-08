import { parse } from "csv-parse/sync";
import crypto from "node:crypto";
import type { StatementTransaction } from "../types.js";

const DATE_HEADERS = ["transaction date", "date", "posting date", "posted", "trans date", "purchase date"];
const DESC_HEADERS = ["description", "merchant", "vendor", "payee", "details", "narrative", "reference", "name"];
const AMOUNT_HEADERS = ["amount", "transaction amount", "value", "debit", "billed amount", "charge", "total"];
const CURRENCY_HEADERS = ["currency", "transaction currency", "billed currency", "ccy", "curr"];

function findHeader(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map((h) => ({ raw: h, key: h.trim().toLowerCase() }));
  for (const candidate of candidates) {
    const exact = normalized.find((h) => h.key === candidate);
    if (exact) return exact.raw;
  }
  for (const candidate of candidates) {
    const partial = normalized.find((h) => h.key.includes(candidate));
    if (partial) return partial.raw;
  }
  return null;
}

/** Parses "1,234.56", "(12.30)", "-12.30", "£4.50" and "12,30" into a number. */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  text = text.replace(/[^0-9.,]/g, "");
  if (!text) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) {
    // European style: dots group thousands, the comma is the decimal point.
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }

  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Normalises the many date formats a bank or Concur export can emit. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (slash && slash[1] && slash[2] && slash[3]) {
    let [, a, b, y] = slash;
    let year = Number.parseInt(y, 10);
    if (year < 100) year += 2000;
    let day = Number.parseInt(a, 10);
    let month = Number.parseInt(b, 10);
    // Day-first is the UK and European convention. Only swap when the first
    // component cannot be a day, which unambiguously marks a US-style date.
    if (day > 12 && month <= 12) {
      // already day-first
    } else if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

export type StatementParseResult = {
  transactions: StatementTransaction[];
  headers: string[];
  mapping: { date: string | null; description: string | null; amount: string | null; currency: string | null };
  skipped: number;
};

/**
 * Reads a card statement exported from Concur or a bank. Column names are
 * detected rather than fixed, because every issuer names them differently.
 */
export function parseStatementCsv(csv: string): StatementParseResult {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  const first = rows[0];
  const headers = first ? Object.keys(first) : [];
  const mapping = {
    date: findHeader(headers, DATE_HEADERS),
    description: findHeader(headers, DESC_HEADERS),
    amount: findHeader(headers, AMOUNT_HEADERS),
    currency: findHeader(headers, CURRENCY_HEADERS),
  };

  const transactions: StatementTransaction[] = [];
  let skipped = 0;

  for (const row of rows) {
    const amount = mapping.amount ? parseAmount(row[mapping.amount]) : null;
    const date = mapping.date ? parseDate(row[mapping.date]) : null;
    const description = (mapping.description ? row[mapping.description] : "") ?? "";

    if (amount == null && !date && !description.trim()) {
      skipped += 1;
      continue;
    }

    const fingerprint = crypto
      .createHash("sha1")
      .update(JSON.stringify([date, description, amount, transactions.length]))
      .digest("hex")
      .slice(0, 16);

    transactions.push({
      id: fingerprint,
      date,
      description: description.trim(),
      // Statements often show spend as a negative. Expense amounts are positive.
      amount: amount == null ? null : Math.abs(amount),
      currency: mapping.currency ? (row[mapping.currency] ?? "").trim().toUpperCase() || null : null,
      raw: row,
    });
  }

  return { transactions, headers, mapping, skipped };
}
