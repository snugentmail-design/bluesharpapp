import { getAccessToken } from "./oauth.js";

const PICKER_BASE = "https://photospicker.googleapis.com/v1";

export type PickingSession = {
  id: string;
  pickerUri: string;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
  expireTime?: string;
  mediaItemsSet?: boolean;
};

export type PickedMediaItem = {
  id: string;
  createTime?: string;
  type?: string;
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    filename?: string;
    mediaFileMetadata?: {
      width?: number;
      height?: number;
      cameraMake?: string;
      cameraModel?: string;
    };
  };
};

async function pickerFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${PICKER_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Photos Picker API ${res.status} on ${path}: ${body.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function createSession(): Promise<PickingSession> {
  return pickerFetch<PickingSession>("/sessions", { method: "POST", body: "{}" });
}

export function getSession(sessionId: string): Promise<PickingSession> {
  return pickerFetch<PickingSession>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export function deleteSession(sessionId: string): Promise<void> {
  return pickerFetch<void>(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

/** Walks every page of the picked-item list for a finished session. */
export async function listPickedMediaItems(sessionId: string): Promise<PickedMediaItem[]> {
  const items: PickedMediaItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await pickerFetch<{ mediaItems?: PickedMediaItem[]; nextPageToken?: string }>(
      `/mediaItems?${params.toString()}`
    );
    if (page?.mediaItems) items.push(...page.mediaItems);
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return items;
}

/**
 * Downloads the bytes for one picked item. Google renders the resize server-side
 * from the size parameters, so we get an email-sized, OCR-legible copy without
 * an image library on this machine.
 */
export async function downloadMediaFile(baseUrl: string, longEdge: number): Promise<Buffer> {
  const token = await getAccessToken();
  const url = `${baseUrl}=w${longEdge}-h${longEdge}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to download media from Google Photos (${res.status}): ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Parses the "3.5s" style duration Google returns in pollingConfig. */
export function parseDurationMs(duration: string | undefined, fallbackMs: number): number {
  if (!duration) return fallbackMs;
  const match = /^([0-9]*\.?[0-9]+)s$/.exec(duration.trim());
  if (!match || match[1] === undefined) return fallbackMs;
  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : fallbackMs;
}
