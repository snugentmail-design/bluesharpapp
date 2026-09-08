import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    return "";
  }
  return v;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(env("DATA_DIR", path.resolve(process.cwd(), "data")));

export const config = {
  port: envInt("PORT", 8787),
  /** Origin the browser loads the UI from. Used for CORS and OAuth redirects. */
  appOrigin: env("APP_ORIGIN", "http://localhost:3000"),
  /** Origin this server is reachable at. Must match the Google OAuth redirect URI. */
  serverOrigin: env("SERVER_ORIGIN", `http://localhost:${envInt("PORT", 8787)}`),

  dataDir,
  imagesDir: path.join(dataDir, "images"),
  dbPath: path.join(dataDir, "receipts.db"),

  google: {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    get redirectUri() {
      return `${env("SERVER_ORIGIN", `http://localhost:${envInt("PORT", 8787)}`)}/api/auth/google/callback`;
    },
    scopes: [
      "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
      "openid",
      "email",
    ],
  },

  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("ANTHROPIC_MODEL", "claude-opus-5"),
    /** How many receipts to send to the model at once. */
    concurrency: envInt("EXTRACT_CONCURRENCY", 4),
  },

  /**
   * Long edge, in pixels, of the copy pulled from Google Photos. Google renders
   * the resize for us via the baseUrl size parameters, so we never need an image
   * library locally. 2048 keeps small print legible and files email-sized.
   */
  imageLongEdge: envInt("IMAGE_LONG_EDGE", 2048),

  concur: {
    /** receipts@concur.com drops images into Available Receipts. */
    receiptsAddress: env("CONCUR_RECEIPTS_ADDRESS", "receipts@concur.com"),
    /** receipts@expenseit.com creates an expense from the image, if licensed. */
    expenseItAddress: env("CONCUR_EXPENSEIT_ADDRESS", "receipts@expenseit.com"),
  },

  smtp: {
    host: env("SMTP_HOST"),
    port: envInt("SMTP_PORT", 587),
    secure: env("SMTP_SECURE", "false") === "true",
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    /** Must be an address verified on the SAP Concur profile. */
    from: env("SMTP_FROM"),
  },

  /** Default currency assumed when a receipt shows a bare number with no symbol. */
  defaultCurrency: env("DEFAULT_CURRENCY", "GBP"),

  /** Home timezone, used to bucket photo timestamps into calendar months. */
  timezone: env("TIMEZONE", "Europe/London"),
};

export function ensureDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.imagesDir, { recursive: true });
}

export function assertGoogleConfigured(): void {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set. See README.md, section 'Google Cloud setup'."
    );
  }
}

export function assertAnthropicConfigured(): void {
  if (!config.anthropic.apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set, so receipts cannot be read. See README.md, section 'Anthropic API key'."
    );
  }
}
