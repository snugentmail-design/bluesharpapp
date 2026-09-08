import type {
  ExtractionProgress,
  ImportSummary,
  PickerSession,
  ReceiptFields,
  Receipt,
  ReceiptsResponse,
  ReconcileResponse,
  Status,
} from "./types";

const BASE = process.env.REACT_APP_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Request to ${path} failed with ${res.status}.`);
  }
  return body as T;
}

export const api = {
  base: BASE,

  status: () => request<Status>("/api/auth/status"),

  googleAuthUrl: () => request<{ url: string }>("/api/auth/google/start"),

  disconnectGoogle: () => request<{ ok: true }>("/api/auth/google/disconnect", { method: "POST" }),

  createPickerSession: () => request<PickerSession>("/api/picker/session", { method: "POST" }),

  pollPickerSession: (id: string) =>
    request<{ sessionId: string; mediaItemsSet: boolean; pollIntervalMs: number }>(
      `/api/picker/session/${encodeURIComponent(id)}`
    ),

  importPicked: (id: string) =>
    request<ImportSummary>(`/api/picker/session/${encodeURIComponent(id)}/import`, { method: "POST" }),

  listReceipts: (month: string | null) =>
    request<ReceiptsResponse>(`/api/receipts${month ? `?month=${encodeURIComponent(month)}` : ""}`),

  extract: (ids?: string[]) =>
    request<{ started: boolean }>("/api/receipts/extract", {
      method: "POST",
      body: JSON.stringify(ids ? { ids } : {}),
    }),

  progress: () => request<ExtractionProgress>("/api/receipts/progress"),

  updateReceipt: (id: string, patch: Partial<ReceiptFields>) =>
    request<Receipt>(`/api/receipts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  toggleIgnore: (id: string) =>
    request<Receipt>(`/api/receipts/${encodeURIComponent(id)}/ignore`, { method: "POST" }),

  deleteReceipt: (id: string) =>
    request<{ ok: true }>(`/api/receipts/${encodeURIComponent(id)}`, { method: "DELETE" }),

  uploadStatement: (label: string, csv: string) =>
    request<{ label: string; headers: string[]; mapping: Record<string, string | null>; count: number; skipped: number }>(
      "/api/export/statement",
      { method: "POST", body: JSON.stringify({ label, csv }) }
    ),

  clearStatement: () => request<{ ok: true }>("/api/export/statement", { method: "DELETE" }),

  reconcile: (month: string | null) =>
    request<ReconcileResponse>(`/api/export/reconcile${month ? `?month=${encodeURIComponent(month)}` : ""}`),

  emailStatus: () =>
    request<{ configured: boolean; verified: boolean; error?: string }>("/api/export/email/status"),

  emailToConcur: (payload: { month: string | null; target: "receipts" | "expenseit"; onlyUnsent: boolean }) =>
    request<{ sent: number; failed: number; target: string; results: Array<{ receiptId: string; ok: boolean; error?: string }> }>(
      "/api/export/email",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  csvUrl: (month: string | null) => `${BASE}/api/export/csv${month ? `?month=${encodeURIComponent(month)}` : ""}`,
  zipUrl: (month: string | null) => `${BASE}/api/export/zip${month ? `?month=${encodeURIComponent(month)}` : ""}`,
  imageUrl: (receipt: Receipt) => `${BASE}${receipt.imageUrl}`,
};
