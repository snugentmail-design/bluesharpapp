import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { receipts } from "./db.js";
import { downloadMediaFile, listPickedMediaItems, type PickedMediaItem } from "./google/picker.js";
import { extractReceipt } from "./extract/claude.js";
import type { Receipt } from "./types.js";

export type ImportSummary = {
  imported: number;
  duplicates: number;
  failed: number;
  errors: string[];
  receiptIds: string[];
};

function extensionFor(item: PickedMediaItem): string {
  const filename = item.mediaFile?.filename ?? "";
  const ext = path.extname(filename).toLowerCase();
  if (ext) return ext;
  const mime = item.mediaFile?.mimeType ?? "";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("heic") || mime.includes("heif")) return ".heic";
  return ".jpg";
}

/**
 * Pulls every item the user ticked in the Google picker, stores the bytes, and
 * records one row per new receipt. Items already imported are skipped, both by
 * Google's media item id and by content hash, so re-picking a month is safe.
 */
export async function importPickedItems(sessionId: string): Promise<ImportSummary> {
  const items = await listPickedMediaItems(sessionId);
  const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0, errors: [], receiptIds: [] };

  for (const item of items) {
    try {
      if (item.id && receipts.findByGoogleId(item.id)) {
        summary.duplicates += 1;
        continue;
      }
      const baseUrl = item.mediaFile?.baseUrl;
      if (!baseUrl) {
        summary.failed += 1;
        summary.errors.push(`${item.mediaFile?.filename ?? item.id}: Google returned no download URL.`);
        continue;
      }

      const bytes = await downloadMediaFile(baseUrl, config.imageLongEdge);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

      const existing = receipts.findBySha(sha256);
      if (existing) {
        summary.duplicates += 1;
        continue;
      }

      const id = crypto.randomUUID();
      const storedFilename = `${id}${extensionFor(item)}`;
      await fs.writeFile(path.join(config.imagesDir, storedFilename), bytes);

      const receipt: Receipt = {
        id,
        googleMediaItemId: item.id ?? null,
        sha256,
        storedFilename,
        originalFilename: item.mediaFile?.filename ?? null,
        mimeType: item.mediaFile?.mimeType ?? "image/jpeg",
        byteSize: bytes.byteLength,
        photoTakenAt: item.createTime ?? null,
        importedAt: new Date().toISOString(),
        pickerSessionId: sessionId,
        status: "pending",
        error: null,
        extraction: null,
        overrides: {},
        matchedTransactionId: null,
        emailedAt: null,
        exportedAt: null,
      };
      receipts.insert(receipt);
      summary.imported += 1;
      summary.receiptIds.push(id);
    } catch (err) {
      summary.failed += 1;
      summary.errors.push(`${item.mediaFile?.filename ?? item.id}: ${(err as Error).message}`);
    }
  }

  return summary;
}

export type ExtractionProgress = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  startedAt: string | null;
  lastError: string | null;
};

const progress: ExtractionProgress = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  startedAt: null,
  lastError: null,
};

export function extractionProgress(): ExtractionProgress {
  return { ...progress };
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Reads every pending receipt. Runs in the background so the browser can poll
 * progress instead of holding a request open for minutes.
 */
export async function extractPending(ids?: string[]): Promise<void> {
  if (progress.running) return;

  const queue = ids
    ? ids.map((id) => receipts.get(id)).filter((r): r is Receipt => r !== null)
    : receipts.byStatus("pending");

  if (queue.length === 0) return;

  progress.running = true;
  progress.total = queue.length;
  progress.done = 0;
  progress.failed = 0;
  progress.startedAt = new Date().toISOString();
  progress.lastError = null;

  try {
    await runWithConcurrency(queue, config.anthropic.concurrency, async (receipt) => {
      receipts.setStatus(receipt.id, "extracting");
      const result = await extractReceipt(path.join(config.imagesDir, receipt.storedFilename), {
        mimeType: receipt.mimeType,
        photoTakenAt: receipt.photoTakenAt,
      });
      if (result.ok) {
        receipts.setExtraction(receipt.id, result.extraction);
      } else {
        receipts.setStatus(receipt.id, "failed", result.error);
        progress.failed += 1;
        progress.lastError = result.error;
      }
      progress.done += 1;
    });
  } finally {
    progress.running = false;
  }
}
