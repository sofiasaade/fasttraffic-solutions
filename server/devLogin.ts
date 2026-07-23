// LOCAL DEV ONLY — not for production. Mints a valid session cookie without Manus OAuth,
// so the app can be run and viewed locally. Wired into _core/index.ts behind a NODE_ENV check.
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Response } from "express";
import { sdk } from "./_core/sdk";
import * as db from "./db";
import {
  getTechnicianByName,
  linkTechnicianToUser,
  seedTechnicians,
} from "./opsDb";

const DEV_OPEN_ID = "dev-owner";

function setSessionCookie(res: Response, token: string) {
  // sameSite:lax + secure:false so the cookie is accepted over http://localhost.
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

export function registerDevLogin(app: Express) {
  app.get("/api/dev-login", async (req, res) => {
    try {
      // ?tech=<Airtable name> → sign in as that TECHNICIAN (role user), link the
      // account to their roster entry, and land on the technician app (/app).
      // No param → sign in as the coordinator (admin), land on the console.
      const techName =
        typeof req.query.tech === "string" ? req.query.tech.trim() : "";

      if (techName) {
        await seedTechnicians();
        const tech = await getTechnicianByName(techName);
        if (!tech) {
          res.status(404).json({ error: `Technician not found: ${techName}` });
          return;
        }
        const openId = `dev-tech-${slug(tech.airtableName)}`;
        await db.upsertUser({
          openId,
          name: tech.displayName ?? tech.airtableName,
          email: null,
          loginMethod: "dev-tech",
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
        res.redirect("/app");
        return;
      }

      // First user defaults to admin (coordinator) per upsertUser logic.
      await db.upsertUser({
        openId: DEV_OPEN_ID,
        name: "Sofia (Local Dev)",
        email: "sofia@ftstraffic.ca",
        loginMethod: "dev",
        lastSignedIn: new Date(),
      });
      const token = await sdk.createSessionToken(DEV_OPEN_ID, {
        name: "Sofia (Local Dev)",
        expiresInMs: ONE_YEAR_MS,
      });
      setSessionCookie(res, token);
      // ?back=roster → land on the technician list inside the tech app.
      res.redirect(req.query.back === "roster" ? "/app" : "/");
    } catch (err) {
      console.error("[dev-login] failed", err);
      res.status(500).json({ error: String(err) });
    }
  });
}
