import { OAuth2Client, type Credentials } from "google-auth-library";
import { config, assertGoogleConfigured } from "../config.js";
import { kv } from "../db.js";

const TOKEN_KEY = "google_oauth_tokens";
const PROFILE_KEY = "google_profile";

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  assertGoogleConfigured();
  if (!client) {
    client = new OAuth2Client({
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      redirectUri: config.google.redirectUri,
    });
    // google-auth-library emits this whenever it silently refreshes the access
    // token, which is the only chance we get to persist a rotated refresh token.
    client.on("tokens", (tokens: Credentials) => {
      const existing = loadCredentials() ?? {};
      const merged: Credentials = { ...existing, ...tokens };
      if (!merged.refresh_token && existing.refresh_token) {
        merged.refresh_token = existing.refresh_token;
      }
      kv.set(TOKEN_KEY, JSON.stringify(merged));
    });
    const stored = loadCredentials();
    if (stored) client.setCredentials(stored);
  }
  return client;
}

function loadCredentials(): Credentials | null {
  const raw = kv.get(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function buildAuthUrl(state: string): string {
  return getClient().generateAuthUrl({
    access_type: "offline",
    // Forcing the consent screen is what makes Google hand back a refresh token
    // on a repeat authorisation. Without it a re-connect yields access only.
    prompt: "consent",
    include_granted_scopes: true,
    scope: config.google.scopes,
    state,
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const c = getClient();
  const { tokens } = await c.getToken(code);
  const existing = loadCredentials() ?? {};
  const merged: Credentials = { ...existing, ...tokens };
  if (!merged.refresh_token && existing.refresh_token) {
    merged.refresh_token = existing.refresh_token;
  }
  kv.set(TOKEN_KEY, JSON.stringify(merged));
  c.setCredentials(merged);

  if (tokens.id_token) {
    const payload = decodeIdToken(tokens.id_token);
    if (payload?.email) kv.set(PROFILE_KEY, JSON.stringify({ email: payload.email }));
  }
}

function decodeIdToken(idToken: string): { email?: string } | null {
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { email?: string };
  } catch {
    return null;
  }
}

export function isConnected(): boolean {
  const creds = loadCredentials();
  return Boolean(creds?.refresh_token || creds?.access_token);
}

export function connectedEmail(): string | null {
  const raw = kv.get(PROFILE_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

export function disconnect(): void {
  kv.delete(TOKEN_KEY);
  kv.delete(PROFILE_KEY);
  client = null;
}

/** Returns a valid access token, refreshing it first if it is close to expiry. */
export async function getAccessToken(): Promise<string> {
  const c = getClient();
  if (!isConnected()) {
    throw new Error("Google account is not connected. Open the app and press Connect Google Photos.");
  }
  const { token } = await c.getAccessToken();
  if (!token) {
    throw new Error("Google refused to issue an access token. Disconnect and reconnect the account.");
  }
  return token;
}
