import type { Receipt, StatementTransaction } from "../types.js";
import { effectiveFields } from "../extract/normalize.js";

export type MatchPair = {
  transaction: StatementTransaction;
  receipt: Receipt;
  score: number;
  reasons: string[];
};

export type ReconcileResult = {
  matched: MatchPair[];
  transactionsWithoutReceipt: StatementTransaction[];
  receiptsWithoutTransaction: Receipt[];
};

const NOISE_WORDS = new Set([
  "ltd", "limited", "llc", "inc", "plc", "the", "co", "company", "uk", "gb", "us",
  "pos", "purchase", "payment", "card", "visa", "debit", "credit", "contactless",
  "xx", "xxxx", "ref", "sale", "store", "shop", "online", "www", "com",
]);

/** Reduces a merchant string to comparable word tokens. */
export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !NOISE_WORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Token overlap between two merchant strings, 0 to 1. Card statements abbreviate
 * heavily ("PRET A MANGE 456 LONDON"), so partial prefix matches count.
 */
export function merchantSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  let hits = 0;
  for (const token of ta) {
    const found = tb.some(
      (other) =>
        other === token ||
        (token.length >= 4 && other.startsWith(token.slice(0, 4))) ||
        (other.length >= 4 && token.startsWith(other.slice(0, 4)))
    );
    if (found) hits += 1;
  }
  return hits / Math.max(ta.length, tb.length);
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : Number.POSITIVE_INFINITY;
}

export type MatchOptions = {
  /** Card settlement can lag the purchase, so allow a window either side. */
  maxDayGap?: number;
  /** Absolute tolerance on the amount, to absorb rounding and tip adjustments. */
  amountTolerance?: number;
  /** Pairs below this score are not offered as matches. */
  minScore?: number;
};

const DEFAULTS: Required<MatchOptions> = { maxDayGap: 5, amountTolerance: 0.02, minScore: 0.55 };

/** Scores one candidate pairing. Returns null when it fails a hard gate. */
export function scorePair(
  transaction: StatementTransaction,
  receipt: Receipt,
  options: Required<MatchOptions>
): { score: number; reasons: string[] } | null {
  const fields = effectiveFields(receipt);
  const reasons: string[] = [];

  if (transaction.amount == null || fields.total_amount == null) return null;

  const amountGap = Math.abs(transaction.amount - fields.total_amount);
  if (amountGap > Math.max(options.amountTolerance, Math.abs(transaction.amount) * 0.02)) {
    return null;
  }
  const amountScore = amountGap <= options.amountTolerance ? 1 : 0.8;
  reasons.push(amountGap <= options.amountTolerance ? "Amount matches exactly." : "Amount matches within 2%.");

  let dateScore = 0.35;
  if (transaction.date && fields.transaction_date) {
    const gap = daysBetween(transaction.date, fields.transaction_date);
    if (gap > options.maxDayGap) return null;
    dateScore = gap === 0 ? 1 : Math.max(0, 1 - gap / (options.maxDayGap + 1));
    reasons.push(gap === 0 ? "Same date." : `${gap} day${gap === 1 ? "" : "s"} apart.`);
  } else {
    reasons.push("No date on one side.");
  }

  const nameScore = merchantSimilarity(transaction.description, fields.merchant_name);
  if (nameScore > 0.6) reasons.push("Merchant name matches.");
  else if (nameScore > 0.2) reasons.push("Merchant name partly matches.");
  else reasons.push("Merchant name does not match.");

  if (
    transaction.currency &&
    fields.currency &&
    transaction.currency.toUpperCase() !== fields.currency.toUpperCase()
  ) {
    reasons.push(`Currency differs (${transaction.currency} vs ${fields.currency}).`);
  }

  const score = amountScore * 0.5 + dateScore * 0.3 + nameScore * 0.2;
  if (score < options.minScore) return null;
  return { score, reasons };
}

/**
 * Greedy one-to-one assignment: every candidate pair is scored, then the best
 * pairs are taken in order so no receipt or transaction is used twice. Two
 * identical GBP 4.50 coffees on the same day therefore pair off rather than both
 * claiming the same statement line.
 */
export function reconcile(
  transactions: StatementTransaction[],
  receipts: Receipt[],
  options: MatchOptions = {}
): ReconcileResult {
  const opts = { ...DEFAULTS, ...options };
  const candidates: MatchPair[] = [];

  for (const transaction of transactions) {
    for (const receipt of receipts) {
      const scored = scorePair(transaction, receipt, opts);
      if (scored) {
        candidates.push({ transaction, receipt, score: scored.score, reasons: scored.reasons });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedTransactions = new Set<string>();
  const usedReceipts = new Set<string>();
  const matched: MatchPair[] = [];

  for (const candidate of candidates) {
    if (usedTransactions.has(candidate.transaction.id) || usedReceipts.has(candidate.receipt.id)) continue;
    usedTransactions.add(candidate.transaction.id);
    usedReceipts.add(candidate.receipt.id);
    matched.push(candidate);
  }

  return {
    matched,
    transactionsWithoutReceipt: transactions.filter((t) => !usedTransactions.has(t.id)),
    receiptsWithoutTransaction: receipts.filter((r) => !usedReceipts.has(r.id)),
  };
}
