// ATLAS — Executive Command Center: individual login for the Executive Owner.
// Email + scrypt-hashed password + TOTP (RFC 6238) MFA. Sessions are minted as
// role "executive"; every ATLAS procedure re-validates the role server-side,
// so hiding buttons is irrelevant — direct URL/API calls are rejected too.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { sdk } from "./_core/sdk";
import * as dbUsers from "./db";
import { getDb } from "./db";
import { execAuditLog, executiveAuth } from "../drizzle/schema";

const EXEC_SESSION_MS = 12 * 60 * 60 * 1000; // 12h hard cap (idle logout is client-side)
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

/* ------------------------------ password ------------------------------ */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* -------------------------------- TOTP -------------------------------- */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  const cleaned = s.replace(/=+$/, "").toUpperCase();
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP: 6 digits, 30s step, HMAC-SHA1. */
export function totpCode(secretB32: string, timeMs = Date.now()): string {
  const counter = Math.floor(timeMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/** Accept the current window ±1 (clock drift). */
export function verifyTotp(secretB32: string, code: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Date.now();
  return [-1, 0, 1].some((w) => totpCode(secretB32, now + w * 30_000) === clean);
}

/* ------------------------------- audit ------------------------------- */

export async function execAudit(
  email: string,
  action: string,
  detail?: string | null,
  ip?: string | null,
) {
  try {
    const d = await db();
    await d.insert(execAuditLog).values({
      email,
      action,
      detail: detail?.slice(0, 500) ?? null,
      ip: ip?.slice(0, 64) ?? null,
    });
  } catch {
    // auditing must never break the request
  }
}

/* ------------------------------- routes ------------------------------- */

function clientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown"
  );
}

function setExecCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: EXEC_SESSION_MS,
  });
}

async function getExecRow(email: string) {
  const d = await db();
  const rows = await d
    .select()
    .from(executiveAuth)
    .where(eq(executiveAuth.email, email.toLowerCase().trim()))
    .limit(1);
  return rows[0] ?? null;
}

export function registerExecAuth(app: Express) {
  // Step 1+2 combined: email + password (+ TOTP once enabled).
  app.post("/api/exec-login", async (req, res) => {
    const email = String(req.body?.email ?? "").toLowerCase().trim();
    const password = String(req.body?.password ?? "");
    const totp = String(req.body?.totp ?? "");
    const ip = clientIp(req);
    const fail = async (msg: string, detail: string) => {
      await execAudit(email || "(empty)", "login_failed", detail, ip);
      res.status(401).json({ ok: false, error: msg });
    };
    try {
      const row = await getExecRow(email);
      if (!row) return fail("Wrong email, password or code.", "unknown email");
      if (row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) {
        return fail(
          "Account temporarily locked — try again in a few minutes.",
          "locked",
        );
      }
      const d = await db();
      if (!verifyPassword(password, row.passwordHash)) {
        const attempts = row.failedAttempts + 1;
        await d
          .update(executiveAuth)
          .set({
            failedAttempts: attempts,
            lockedUntil:
              attempts >= MAX_FAILED
                ? new Date(Date.now() + LOCK_MINUTES * 60_000)
                : null,
          })
          .where(eq(executiveAuth.id, row.id));
        return fail("Wrong email, password or code.", `bad password (${attempts})`);
      }
      if (row.totpEnabled) {
        if (!row.totpSecret || !verifyTotp(row.totpSecret, totp)) {
          const attempts = row.failedAttempts + 1;
          await d
            .update(executiveAuth)
            .set({
              failedAttempts: attempts,
              lockedUntil:
                attempts >= MAX_FAILED
                  ? new Date(Date.now() + LOCK_MINUTES * 60_000)
                  : null,
            })
            .where(eq(executiveAuth.id, row.id));
          return fail("Wrong email, password or code.", "bad totp");
        }
      }
      await d
        .update(executiveAuth)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(executiveAuth.id, row.id));

      const openId = `executive-${row.id}`;
      await dbUsers.upsertUser({
        openId,
        name: "Sofia Bermudez",
        email: row.email,
        loginMethod: "exec-mfa",
        role: "executive",
        lastSignedIn: new Date(),
      });
      const token = await sdk.createSessionToken(openId, {
        name: "Sofia Bermudez",
        expiresInMs: EXEC_SESSION_MS,
      });
      setExecCookie(res, token);
      await execAudit(email, "login", row.totpEnabled ? "with MFA" : "password only (MFA pending)", ip);
      res.json({
        ok: true,
        mustChangePassword: row.mustChangePassword,
        totpEnabled: row.totpEnabled,
      });
    } catch (err) {
      console.error("[exec-login] failed", err);
      res.status(500).json({ ok: false, error: "Sign-in failed." });
    }
  });

  // Authenticated helpers below — all re-verify the executive session.
  const requireExec = async (req: Request, res: Response) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user || user.role !== "executive") {
      res.status(403).json({ ok: false, error: "Executive session required." });
      return null;
    }
    return user;
  };

  // TOTP enrolment: returns the secret + otpauth URI once; confirm activates.
  app.post("/api/exec-totp-setup", async (req, res) => {
    const user = await requireExec(req, res);
    if (!user) return;
    const row = await getExecRow(user.email ?? "");
    if (!row) return res.status(404).json({ ok: false });
    if (row.totpEnabled)
      return res.status(400).json({ ok: false, error: "MFA is already enabled." });
    const d = await db();
    let secret = row.totpSecret;
    if (!secret) {
      secret = base32Encode(randomBytes(20));
      await d
        .update(executiveAuth)
        .set({ totpSecret: secret })
        .where(eq(executiveAuth.id, row.id));
    }
    const uri = `otpauth://totp/FTS%20ATLAS:${encodeURIComponent(row.email)}?secret=${secret}&issuer=FTS%20ATLAS&digits=6&period=30`;
    res.json({ ok: true, secret, uri });
  });

  app.post("/api/exec-totp-confirm", async (req, res) => {
    const user = await requireExec(req, res);
    if (!user) return;
    const code = String(req.body?.code ?? "");
    const row = await getExecRow(user.email ?? "");
    if (!row?.totpSecret) return res.status(400).json({ ok: false });
    if (!verifyTotp(row.totpSecret, code)) {
      return res
        .status(400)
        .json({ ok: false, error: "Code didn't match — try the next one." });
    }
    const d = await db();
    await d
      .update(executiveAuth)
      .set({ totpEnabled: true })
      .where(eq(executiveAuth.id, row.id));
    await execAudit(row.email, "mfa_enabled", null, clientIp(req));
    res.json({ ok: true });
  });

  app.post("/api/exec-change-password", async (req, res) => {
    const user = await requireExec(req, res);
    if (!user) return;
    const current = String(req.body?.current ?? "");
    const next = String(req.body?.next ?? "");
    if (next.length < 10) {
      return res.status(400).json({
        ok: false,
        error: "New password needs at least 10 characters.",
      });
    }
    const row = await getExecRow(user.email ?? "");
    if (!row || !verifyPassword(current, row.passwordHash)) {
      return res
        .status(401)
        .json({ ok: false, error: "Current password is wrong." });
    }
    const d = await db();
    await d
      .update(executiveAuth)
      .set({ passwordHash: hashPassword(next), mustChangePassword: false })
      .where(eq(executiveAuth.id, row.id));
    await execAudit(row.email, "password_changed", null, clientIp(req));
    res.json({ ok: true });
  });
}
