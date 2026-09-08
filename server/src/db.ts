import { DatabaseSync } from "node:sqlite";
import { config, ensureDirs } from "./config.js";
import type { Receipt, ReceiptFields, ReceiptStatus } from "./types.js";

ensureDirs();

export const db = new DatabaseSync(config.dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  google_media_item_id TEXT UNIQUE,
  sha256 TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  photo_taken_at TEXT,
  imported_at TEXT NOT NULL,
  picker_session_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  extraction_json TEXT,
  overrides_json TEXT,
  matched_transaction_id TEXT,
  emailed_at TEXT,
  exported_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_sha ON receipts(sha256);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_taken ON receipts(photo_taken_at);

CREATE TABLE IF NOT EXISTS tokens (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  rows_json TEXT NOT NULL
);
`);

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function rowToReceipt(row: Row): Receipt {
  return {
    id: String(row.id),
    googleMediaItemId: str(row.google_media_item_id),
    sha256: String(row.sha256),
    storedFilename: String(row.stored_filename),
    originalFilename: str(row.original_filename),
    mimeType: str(row.mime_type) ?? "image/jpeg",
    byteSize: Number(row.byte_size ?? 0),
    photoTakenAt: str(row.photo_taken_at),
    importedAt: String(row.imported_at),
    pickerSessionId: str(row.picker_session_id),
    status: String(row.status) as ReceiptStatus,
    error: str(row.error),
    extraction: parseJson(row.extraction_json),
    overrides: parseJson<Partial<ReceiptFields>>(row.overrides_json) ?? {},
    matchedTransactionId: str(row.matched_transaction_id),
    emailedAt: str(row.emailed_at),
    exportedAt: str(row.exported_at),
  };
}

export const receipts = {
  insert(r: Receipt): void {
    db.prepare(
      `INSERT INTO receipts (
        id, google_media_item_id, sha256, stored_filename, original_filename,
        mime_type, byte_size, photo_taken_at, imported_at, picker_session_id,
        status, error, extraction_json, overrides_json, matched_transaction_id,
        emailed_at, exported_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      r.id,
      r.googleMediaItemId,
      r.sha256,
      r.storedFilename,
      r.originalFilename,
      r.mimeType,
      r.byteSize,
      r.photoTakenAt,
      r.importedAt,
      r.pickerSessionId,
      r.status,
      r.error,
      r.extraction ? JSON.stringify(r.extraction) : null,
      JSON.stringify(r.overrides ?? {}),
      r.matchedTransactionId,
      r.emailedAt,
      r.exportedAt
    );
  },

  get(id: string): Receipt | null {
    const row = db.prepare("SELECT * FROM receipts WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToReceipt(row) : null;
  },

  findByGoogleId(googleMediaItemId: string): Receipt | null {
    const row = db
      .prepare("SELECT * FROM receipts WHERE google_media_item_id = ?")
      .get(googleMediaItemId) as Row | undefined;
    return row ? rowToReceipt(row) : null;
  },

  findBySha(sha256: string): Receipt | null {
    const row = db.prepare("SELECT * FROM receipts WHERE sha256 = ?").get(sha256) as Row | undefined;
    return row ? rowToReceipt(row) : null;
  },

  all(): Receipt[] {
    const rows = db
      .prepare("SELECT * FROM receipts ORDER BY COALESCE(photo_taken_at, imported_at) DESC")
      .all() as Row[];
    return rows.map(rowToReceipt);
  },

  byStatus(status: ReceiptStatus): Receipt[] {
    const rows = db
      .prepare("SELECT * FROM receipts WHERE status = ? ORDER BY imported_at ASC")
      .all(status) as Row[];
    return rows.map(rowToReceipt);
  },

  setStatus(id: string, status: ReceiptStatus, error?: string | null): void {
    db.prepare("UPDATE receipts SET status = ?, error = ? WHERE id = ?").run(
      status,
      error ?? null,
      id
    );
  },

  setExtraction(id: string, extraction: unknown): void {
    db.prepare("UPDATE receipts SET extraction_json = ?, status = 'extracted', error = NULL WHERE id = ?").run(
      JSON.stringify(extraction),
      id
    );
  },

  setOverrides(id: string, overrides: Partial<ReceiptFields>): void {
    db.prepare("UPDATE receipts SET overrides_json = ? WHERE id = ?").run(
      JSON.stringify(overrides),
      id
    );
  },

  setMatch(id: string, transactionId: string | null): void {
    db.prepare("UPDATE receipts SET matched_transaction_id = ? WHERE id = ?").run(transactionId, id);
  },

  markEmailed(id: string, when: string): void {
    db.prepare("UPDATE receipts SET emailed_at = ? WHERE id = ?").run(when, id);
  },

  markExported(ids: string[], when: string): void {
    const stmt = db.prepare("UPDATE receipts SET exported_at = ? WHERE id = ?");
    for (const id of ids) stmt.run(when, id);
  },

  remove(id: string): void {
    db.prepare("DELETE FROM receipts WHERE id = ?").run(id);
  },
};

export const kv = {
  get(key: string): string | null {
    const row = db.prepare("SELECT value FROM tokens WHERE key = ?").get(key) as Row | undefined;
    return row ? String(row.value) : null;
  },
  set(key: string, value: string): void {
    db.prepare(
      "INSERT INTO tokens (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, value);
  },
  delete(key: string): void {
    db.prepare("DELETE FROM tokens WHERE key = ?").run(key);
  },
};

export const statements = {
  save(id: string, label: string, rows: unknown[]): void {
    db.prepare(
      `INSERT INTO statements (id, label, uploaded_at, rows_json) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, uploaded_at = excluded.uploaded_at, rows_json = excluded.rows_json`
    ).run(id, label, new Date().toISOString(), JSON.stringify(rows));
  },
  latest(): { id: string; label: string; uploadedAt: string; rows: unknown[] } | null {
    const row = db
      .prepare("SELECT * FROM statements ORDER BY uploaded_at DESC LIMIT 1")
      .get() as Row | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      label: String(row.label),
      uploadedAt: String(row.uploaded_at),
      rows: parseJson<unknown[]>(row.rows_json) ?? [],
    };
  },
  clear(): void {
    db.exec("DELETE FROM statements");
  },
};
