import express from "express";
import cors from "cors";
import { config, ensureDirs } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { pickerRouter } from "./routes/picker.js";
import { receiptsRouter } from "./routes/receipts.js";
import { exportRouter } from "./routes/export.js";

ensureDirs();

const app = express();

app.use(cors({ origin: config.appOrigin, credentials: true }));
// Statement CSVs are posted as a JSON string, so allow a generous body.
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: 1 });
});

app.use("/api/auth", authRouter);
app.use("/api/picker", pickerRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/export", exportRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`Receipt reconciler API listening on ${config.serverOrigin}`);
  if (!config.google.clientId) console.warn("GOOGLE_CLIENT_ID is not set. Google Photos import is disabled.");
  if (!config.anthropic.apiKey) console.warn("ANTHROPIC_API_KEY is not set. Receipt reading is disabled.");
});
