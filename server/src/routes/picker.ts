import { Router } from "express";
import QRCode from "qrcode";
import { createSession, deleteSession, getSession, parseDurationMs } from "../google/picker.js";
import { importPickedItems } from "../pipeline.js";

export const pickerRouter = Router();

pickerRouter.post("/session", async (_req, res) => {
  try {
    const session = await createSession();
    const qrDataUrl = session.pickerUri ? await QRCode.toDataURL(session.pickerUri, { margin: 1, width: 320 }) : null;
    res.json({
      sessionId: session.id,
      pickerUri: session.pickerUri,
      qrDataUrl,
      pollIntervalMs: parseDurationMs(session.pollingConfig?.pollInterval, 3000),
      expireTime: session.expireTime ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

pickerRouter.get("/session/:id", async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    res.json({
      sessionId: session.id,
      mediaItemsSet: Boolean(session.mediaItemsSet),
      pollIntervalMs: parseDurationMs(session.pollingConfig?.pollInterval, 3000),
      expireTime: session.expireTime ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

pickerRouter.post("/session/:id/import", async (req, res) => {
  try {
    const summary = await importPickedItems(req.params.id);
    // The picking session has served its purpose; releasing it revokes Google's
    // grant on those items rather than leaving it open until it expires.
    await deleteSession(req.params.id).catch(() => undefined);
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
