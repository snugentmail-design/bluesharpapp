import { Router } from "express";
import crypto from "node:crypto";
import { receipts, statements } from "../db.js";
import { toConcurCsv, writeReceiptZip } from "../concur/export.js";
import { emailReceipt, isEmailConfigured, targetAddress, verifyEmail, type EmailTarget } from "../concur/email.js";
import { parseStatementCsv } from "../concur/statement.js";
import { reconcile } from "../concur/reconcile.js";
import { receiptsForMonth, serialize } from "./receipts.js";
import type { StatementTransaction } from "../types.js";
import { isComplete, effectiveFields } from "../extract/normalize.js";

export const exportRouter = Router();

function monthParam(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function selected(month: string | null, ids: string[] | undefined) {
  if (ids && ids.length > 0) {
    return ids.map((id) => receipts.get(id)).filter((r): r is NonNullable<typeof r> => r !== null);
  }
  return receiptsForMonth(month);
}

exportRouter.get("/csv", (req, res) => {
  const month = monthParam(req.query.month);
  const rows = selected(month, undefined);
  const csv = toConcurCsv(rows);
  receipts.markExported(rows.map((r) => r.id), new Date().toISOString());
  res.type("text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="concur-${month ?? "all"}.csv"`);
  res.send(csv);
});

exportRouter.get("/zip", async (req, res) => {
  const month = monthParam(req.query.month);
  const rows = selected(month, undefined);
  res.type("application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="receipts-${month ?? "all"}.zip"`);
  try {
    await writeReceiptZip(rows, res);
    receipts.markExported(rows.map((r) => r.id), new Date().toISOString());
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
    else res.end();
  }
});

exportRouter.get("/email/status", async (_req, res) => {
  if (!isEmailConfigured()) {
    res.json({ configured: false, verified: false, error: "SMTP is not configured." });
    return;
  }
  try {
    await verifyEmail();
    res.json({ configured: true, verified: true });
  } catch (err) {
    res.json({ configured: true, verified: false, error: (err as Error).message });
  }
});

exportRouter.post("/email", async (req, res) => {
  const target: EmailTarget = req.body?.target === "expenseit" ? "expenseit" : "receipts";
  const month = monthParam(req.body?.month);
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : undefined;
  const onlyUnsent = req.body?.onlyUnsent !== false;

  let rows = selected(month, ids);
  if (onlyUnsent) rows = rows.filter((r) => !r.emailedAt);
  rows = rows.filter((r) => isComplete(effectiveFields(r)));

  if (rows.length === 0) {
    res.json({ sent: 0, failed: 0, results: [], target: targetAddress(target) });
    return;
  }

  const results = [];
  let sent = 0;
  let failed = 0;
  for (const receipt of rows) {
    const outcome = await emailReceipt(receipt, target);
    if (outcome.ok) {
      receipts.markEmailed(receipt.id, new Date().toISOString());
      sent += 1;
    } else {
      failed += 1;
    }
    results.push(outcome);
  }
  res.json({ sent, failed, results, target: targetAddress(target) });
});

exportRouter.post("/statement", (req, res) => {
  const csv = typeof req.body?.csv === "string" ? req.body.csv : null;
  const label = typeof req.body?.label === "string" ? req.body.label : "statement.csv";
  if (!csv) {
    res.status(400).json({ error: "No CSV content was supplied." });
    return;
  }
  try {
    const parsed = parseStatementCsv(csv);
    statements.save(crypto.randomUUID(), label, parsed.transactions);
    res.json({
      label,
      headers: parsed.headers,
      mapping: parsed.mapping,
      skipped: parsed.skipped,
      count: parsed.transactions.length,
    });
  } catch (err) {
    res.status(400).json({ error: `Could not read that CSV: ${(err as Error).message}` });
  }
});

exportRouter.get("/reconcile", (req, res) => {
  const month = monthParam(req.query.month);
  const stored = statements.latest();
  const transactions = (stored?.rows ?? []) as StatementTransaction[];
  const scoped = month ? transactions.filter((t) => (t.date ?? "").startsWith(month)) : transactions;
  const rows = receiptsForMonth(month);

  const result = reconcile(scoped, rows);

  res.json({
    statement: stored ? { label: stored.label, uploadedAt: stored.uploadedAt, count: transactions.length } : null,
    matched: result.matched.map((m) => ({
      transaction: m.transaction,
      receipt: serialize(m.receipt),
      score: Number(m.score.toFixed(3)),
      reasons: m.reasons,
    })),
    transactionsWithoutReceipt: result.transactionsWithoutReceipt,
    receiptsWithoutTransaction: result.receiptsWithoutTransaction.map(serialize),
  });
});

exportRouter.delete("/statement", (_req, res) => {
  statements.clear();
  res.json({ ok: true });
});
