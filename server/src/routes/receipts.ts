import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";
import { receipts } from "../db.js";
import { ReceiptOverridesSchema, type Receipt } from "../types.js";
import { effectiveFields, monthOf, reviewReasons } from "../extract/normalize.js";
import { extractionProgress, extractPending } from "../pipeline.js";

export const receiptsRouter = Router();

export function serialize(receipt: Receipt) {
  return {
    id: receipt.id,
    status: receipt.status,
    error: receipt.error,
    photoTakenAt: receipt.photoTakenAt,
    importedAt: receipt.importedAt,
    originalFilename: receipt.originalFilename,
    byteSize: receipt.byteSize,
    month: monthOf(receipt),
    fields: effectiveFields(receipt),
    overrides: receipt.overrides,
    extraction: receipt.extraction,
    reviewReasons: reviewReasons(receipt),
    matchedTransactionId: receipt.matchedTransactionId,
    emailedAt: receipt.emailedAt,
    exportedAt: receipt.exportedAt,
    imageUrl: `/api/receipts/${receipt.id}/image`,
  };
}

export type SerializedReceipt = ReturnType<typeof serialize>;

/** Filters the full set down to one calendar month of purchases. */
export function receiptsForMonth(month: string | null): Receipt[] {
  const all = receipts.all().filter((r) => r.status !== "ignored");
  if (!month) return all;
  return all.filter((r) => monthOf(r) === month);
}

receiptsRouter.get("/", (req, res) => {
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : null;
  const all = receipts.all();
  const months = Array.from(new Set(all.map(monthOf).filter((m): m is string => m !== null))).sort().reverse();
  res.json({
    months,
    receipts: receiptsForMonth(month).map(serialize),
    counts: {
      total: all.length,
      pending: all.filter((r) => r.status === "pending").length,
      failed: all.filter((r) => r.status === "failed").length,
    },
  });
});

receiptsRouter.get("/progress", (_req, res) => {
  res.json(extractionProgress());
});

receiptsRouter.post("/extract", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : undefined;
  if (extractionProgress().running) {
    res.status(409).json({ error: "A read is already running." });
    return;
  }
  // Kick off in the background; the browser watches /progress.
  void extractPending(ids).catch((err) => {
    console.error("Extraction run failed:", err);
  });
  res.status(202).json({ started: true });
});

receiptsRouter.get("/:id/image", (req, res) => {
  const receipt = receipts.get(req.params.id);
  if (!receipt) {
    res.status(404).json({ error: "No such receipt." });
    return;
  }
  const filePath = path.join(config.imagesDir, receipt.storedFilename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "The stored image file is missing." });
    return;
  }
  res.type(receipt.mimeType || "image/jpeg");
  res.sendFile(filePath);
});

receiptsRouter.patch("/:id", (req, res) => {
  const receipt = receipts.get(req.params.id);
  if (!receipt) {
    res.status(404).json({ error: "No such receipt." });
    return;
  }
  const parsed = ReceiptOverridesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Those values are not valid.", detail: parsed.error.issues });
    return;
  }
  const merged = { ...receipt.overrides, ...parsed.data };
  receipts.setOverrides(receipt.id, merged);
  const updated = receipts.get(receipt.id);
  res.json(updated ? serialize(updated) : null);
});

receiptsRouter.post("/:id/ignore", (req, res) => {
  const receipt = receipts.get(req.params.id);
  if (!receipt) {
    res.status(404).json({ error: "No such receipt." });
    return;
  }
  receipts.setStatus(receipt.id, receipt.status === "ignored" ? "extracted" : "ignored");
  const updated = receipts.get(receipt.id);
  res.json(updated ? serialize(updated) : null);
});

receiptsRouter.delete("/:id", (req, res) => {
  const receipt = receipts.get(req.params.id);
  if (!receipt) {
    res.status(404).json({ error: "No such receipt." });
    return;
  }
  const filePath = path.join(config.imagesDir, receipt.storedFilename);
  fs.rm(filePath, { force: true }, () => undefined);
  receipts.remove(receipt.id);
  res.json({ ok: true });
});
