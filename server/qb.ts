// ATLAS F1d — QuickBooks Online, READ-ONLY.
//
// Hard rules (from the owner's spec):
//  * Connection only through Intuit's official OAuth 2.0 — we never see QB passwords.
//  * This module exposes exactly ONE way to touch the QB API: qbGet(). There is
//    no POST/PUT/DELETE helper anywhere, so the app cannot create or edit
//    invoices, payments, journal entries, or send anything from QuickBooks.
//  * Client id/secret come from env vars only (QB_CLIENT_ID / QB_CLIENT_SECRET).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { qbConnection } from "../drizzle/schema";
import { execAudit } from "./execAuth";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "75";

function apiBase() {
  return ENV.qbEnvironment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export function qbConfigured(): boolean {
  return Boolean(ENV.qbClientId && ENV.qbClientSecret);
}

function redirectUri(req?: Request): string {
  if (ENV.qbRedirectUri) return ENV.qbRedirectUri;
  const host = req?.get("host") ?? "localhost";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}/api/qb/callback`;
}

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

/* ----------------------------- state (CSRF) ----------------------------- */
// Signed, expiring state so the callback can't be forged. No server memory needed.

function signState(): string {
  const payload = `${Date.now()}.${randomBytes(8).toString("hex")}`;
  const sig = createHmac("sha256", ENV.cookieSecret || "qb-state").update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyState(state: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const expected = createHmac("sha256", ENV.cookieSecret || "qb-state")
    .update(`${ts}.${nonce}`)
    .digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Date.now() - Number(ts) < 15 * 60_000; // 15-minute window
}

/* ------------------------------- tokens ------------------------------- */

function basicAuth(): string {
  return "Basic " + Buffer.from(`${ENV.qbClientId}:${ENV.qbClientSecret}`).toString("base64");
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: basicAuth(),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QB token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };
}

async function saveTokens(
  realmId: string,
  t: Awaited<ReturnType<typeof tokenRequest>>,
  connectedByEmail?: string | null,
  companyName?: string | null,
) {
  const d = await db();
  const now = Date.now();
  const row = {
    realmId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    accessTokenExpiresAt: new Date(now + t.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000),
  };
  const existing = await d.select().from(qbConnection).limit(1);
  if (existing[0]) {
    await d
      .update(qbConnection)
      .set({ ...row, ...(companyName ? { companyName } : {}) })
      .where(eq(qbConnection.id, existing[0].id));
  } else {
    await d.insert(qbConnection).values({
      ...row,
      connectedByEmail: connectedByEmail ?? null,
      companyName: companyName ?? null,
    });
  }
}

export async function getConnection() {
  const d = await db();
  const rows = await d.select().from(qbConnection).limit(1);
  return rows[0] ?? null;
}

/** Valid access token, refreshing via Intuit when it's about to expire. */
async function freshAccessToken(): Promise<{ token: string; realmId: string }> {
  const conn = await getConnection();
  if (!conn) throw new Error("QuickBooks is not connected");
  if (new Date(conn.refreshTokenExpiresAt).getTime() < Date.now()) {
    throw new Error("QuickBooks connection expired — reconnect from ATLAS");
  }
  if (new Date(conn.accessTokenExpiresAt).getTime() - Date.now() > 5 * 60_000) {
    return { token: conn.accessToken, realmId: conn.realmId };
  }
  const t = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: conn.refreshToken,
  });
  await saveTokens(conn.realmId, t);
  return { token: t.access_token, realmId: conn.realmId };
}

/* --------------------------- READ-ONLY client --------------------------- */

/**
 * The ONLY door to the QuickBooks API. GET, always. `path` is relative to
 * /v3/company/{realmId}/ — e.g. "query?query=..." or "reports/ProfitAndLoss?...".
 */
export async function qbGet<T = any>(path: string): Promise<T> {
  const { token, realmId } = await freshAccessToken();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${apiBase()}/v3/company/${realmId}/${path}${sep}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QB API ${res.status} on ${path.split("?")[0]}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function qbQuery<T = any>(q: string): Promise<T> {
  return qbGet<T>(`query?query=${encodeURIComponent(q)}`);
}

/* ------------------------------- routes ------------------------------- */

async function requireExec(req: Request, res: Response) {
  const user = await sdk.authenticateRequest(req).catch(() => null);
  if (!user || user.role !== "executive") {
    res.status(403).json({ ok: false, error: "Executive session required." });
    return null;
  }
  return user;
}

export function registerQbRoutes(app: Express) {
  // Kick off Intuit's consent screen. Executive session required.
  app.get("/api/qb/connect", async (req, res) => {
    const user = await requireExec(req, res);
    if (!user) return;
    if (!qbConfigured()) {
      return res
        .status(400)
        .send("QuickBooks no está configurado todavía: faltan QB_CLIENT_ID / QB_CLIENT_SECRET en Railway.");
    }
    const url =
      `${AUTHORIZE_URL}?client_id=${encodeURIComponent(ENV.qbClientId)}` +
      `&response_type=code&scope=${encodeURIComponent(SCOPE)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri(req))}` +
      `&state=${encodeURIComponent(signState())}`;
    await execAudit(user.email ?? "executive", "qb_connect_started", null);
    res.redirect(url);
  });

  // Intuit redirects here with ?code&realmId&state.
  app.get("/api/qb/callback", async (req, res) => {
    const user = await requireExec(req, res);
    if (!user) return;
    try {
      const { code, realmId, state, error } = req.query as Record<string, string>;
      if (error) return res.redirect("/atlas?qb=denied");
      if (!code || !realmId || !state || !verifyState(state)) {
        return res.redirect("/atlas?qb=invalid");
      }
      const t = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(req),
      });
      await saveTokens(realmId, t, user.email ?? null);
      // Confirm with a read and capture the company name.
      try {
        const info = await qbGet<any>(`companyinfo/${realmId}`);
        const name = info?.CompanyInfo?.CompanyName ?? null;
        if (name) {
          const d = await db();
          const conn = await getConnection();
          if (conn) await d.update(qbConnection).set({ companyName: name }).where(eq(qbConnection.id, conn.id));
        }
      } catch {
        // connection saved; company name is cosmetic
      }
      await execAudit(user.email ?? "executive", "qb_connected", `realm ${realmId}`);
      res.redirect("/atlas?qb=connected");
    } catch (err) {
      console.error("[qb/callback] failed", err);
      await execAudit(user.email ?? "executive", "qb_connect_failed", String(err).slice(0, 300));
      res.redirect("/atlas?qb=error");
    }
  });

  // Disconnect: revoke the token at Intuit and drop our copy.
  app.post("/api/qb/disconnect", async (req, res) => {
    const user = await requireExec(req, res);
    if (!user) return;
    const conn = await getConnection();
    if (conn) {
      try {
        await fetch(REVOKE_URL, {
          method: "POST",
          headers: { authorization: basicAuth(), "content-type": "application/json" },
          body: JSON.stringify({ token: conn.refreshToken }),
        });
      } catch {
        // still drop locally
      }
      const d = await db();
      await d.delete(qbConnection).where(eq(qbConnection.id, conn.id));
    }
    await execAudit(user.email ?? "executive", "qb_disconnected", null);
    res.json({ ok: true });
  });
}
