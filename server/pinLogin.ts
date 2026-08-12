// PIN-based sign-in for the pilot: coordinator PIN → console; technician
// name + PIN → their own app. Public route (no session yet); mints the same
// JWT cookie the app uses. Roles are enforced downstream by adminProcedure.
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Response } from "express";
import { sdk } from "./_core/sdk";
import * as db from "./db";
import {
  getSetting,
  getTechnicianByName,
  getTechnicianByPin,
  linkTechnicianToUser,
} from "./opsDb";

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: ONE_YEAR_MS,
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function registerPinLogin(app: Express) {
  app.post("/api/pin-login", async (req, res) => {
    try {
      const role = String(req.body?.role ?? "");
      const pin = String(req.body?.pin ?? "").trim();
      if (!/^\d{4,8}$/.test(pin)) {
        res.status(400).json({ ok: false, error: "Enter your PIN." });
        return;
      }

      // Coordinator: single shared PIN from settings.
      if (role === "coordinator") {
        const coordPin = (await getSetting("coordinator_pin")) ?? "";
        if (!coordPin || pin !== coordPin) {
          res.status(401).json({ ok: false, error: "Wrong coordinator PIN." });
          return;
        }
        await db.upsertUser({
          openId: "dev-owner",
          name: "Coordinator",
          email: "sofia@ftstraffic.ca",
          loginMethod: "pin",
          lastSignedIn: new Date(),
        });
        const token = await sdk.createSessionToken("dev-owner", {
          name: "Coordinator",
          expiresInMs: ONE_YEAR_MS,
        });
        setSessionCookie(res, token);
        res.json({ ok: true, redirect: "/dashboard" });
        return;
      }

      // Technician: match by name + PIN (name optional; PIN alone also works).
      const name = String(req.body?.name ?? "").trim();
      const tech = name
        ? await getTechnicianByName(name)
        : await getTechnicianByPin(pin);
      if (!tech || tech.pin !== pin || tech.active === false) {
        res.status(401).json({ ok: false, error: "Wrong name or PIN." });
        return;
      }
      const openId = `tech-${slug(tech.airtableName)}`;
      await db.upsertUser({
        openId,
        name: tech.displayName ?? tech.airtableName,
        email: null,
        loginMethod: "pin-tech",
        role: "user",
        lastSignedIn: new Date(),
      });
      const user = await db.getUserByOpenId(openId);
      if (user) await linkTechnicianToUser(tech.airtableName, user.id);
      const token = await sdk.createSessionToken(openId, {
        name: tech.displayName ?? tech.airtableName,
        expiresInMs: ONE_YEAR_MS,
      });
      setSessionCookie(res, token);
      res.json({ ok: true, redirect: "/app" });
    } catch (err) {
      console.error("[pin-login] failed", err);
      res.status(500).json({ ok: false, error: "Sign-in failed." });
    }
  });

  // Coordinator preview of a technician's app WITHOUT their PIN. Requires a
  // VALID coordinator (admin) session — this safely replaces the old
  // ENABLE_DEV_LOGIN backdoor the roster used to link to.
  app.post("/api/preview-tech", async (req, res) => {
    try {
      const admin = await sdk.authenticateRequest(req).catch(() => null);
      if (!admin || admin.role !== "admin") {
        res.status(403).json({ ok: false, error: "Coordinator session required." });
        return;
      }
      const name = String(req.body?.tech ?? "").trim();
      const tech = name ? await getTechnicianByName(name) : null;
      if (!tech || tech.active === false) {
        res.status(404).json({ ok: false, error: "Technician not found." });
        return;
      }
      const openId = `tech-${slug(tech.airtableName)}`;
      await db.upsertUser({
        openId,
        name: tech.displayName ?? tech.airtableName,
        email: null,
        loginMethod: "pin-tech",
        role: "user",
        lastSignedIn: new Date(),
      });
      const user = await db.getUserByOpenId(openId);
      if (user) await linkTechnicianToUser(tech.airtableName, user.id);
      const token = await sdk.createSessionToken(openId, {
        name: tech.displayName ?? tech.airtableName,
        expiresInMs: ONE_YEAR_MS,
      });
      setSessionCookie(res, token);
      res.json({ ok: true, redirect: "/app" });
    } catch (err) {
      console.error("[preview-tech] failed", err);
      res.status(500).json({ ok: false, error: "Preview failed." });
    }
  });
}
