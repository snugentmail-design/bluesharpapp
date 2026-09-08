import { Router } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { kv } from "../db.js";
import { buildAuthUrl, connectedEmail, disconnect, exchangeCode, isConnected } from "../google/oauth.js";
import { isEmailConfigured } from "../concur/email.js";

export const authRouter = Router();

const STATE_KEY = "google_oauth_state";

authRouter.get("/status", (_req, res) => {
  res.json({
    googleConnected: isConnected(),
    googleEmail: connectedEmail(),
    googleConfigured: Boolean(config.google.clientId && config.google.clientSecret),
    anthropicConfigured: Boolean(config.anthropic.apiKey),
    emailConfigured: isEmailConfigured(),
    emailFrom: config.smtp.from || null,
    receiptsAddress: config.concur.receiptsAddress,
    expenseItAddress: config.concur.expenseItAddress,
    defaultCurrency: config.defaultCurrency,
  });
});

authRouter.get("/google/start", (_req, res) => {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    kv.set(STATE_KEY, state);
    res.json({ url: buildAuthUrl(state) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

authRouter.get("/google/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const expected = kv.get(STATE_KEY);

  if (req.query.error) {
    res.redirect(`${config.appOrigin}/?connected=0&reason=${encodeURIComponent(String(req.query.error))}`);
    return;
  }
  if (!code || !state || !expected || state !== expected) {
    res.status(400).send("The sign-in link did not match this session. Close this tab and press Connect again.");
    return;
  }

  kv.delete(STATE_KEY);
  try {
    await exchangeCode(code);
    res.redirect(`${config.appOrigin}/?connected=1`);
  } catch (err) {
    res.status(500).send(`Google sign-in failed: ${(err as Error).message}`);
  }
});

authRouter.post("/google/disconnect", (_req, res) => {
  disconnect();
  res.json({ ok: true });
});
