import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { runChangeDetection } from "./changeDetection";

/**
 * Register `/api/scheduled/*` HTTP cron handlers. These are triggered by the
 * Manus Heartbeat platform (project-level cron). Auth is via
 * `sdk.authenticateRequest` which sets `isCron=true` for cron callbacks.
 *
 * Must be mounted BEFORE the Vite/static fallthrough in index.ts.
 */
export function registerScheduledRoutes(app: Express): void {
  app.post(
    "/api/scheduled/detectJobChanges",
    async (req: Request, res: Response) => {
      try {
        const user = await sdk.authenticateRequest(req);
        if (!user.isCron) {
          return res.status(403).json({ error: "cron-only" });
        }
        const result = await runChangeDetection();
        return res.json({ ok: true, result });
      } catch (error) {
        const err = error as Error;
        return res.status(500).json({
          error: err.message,
          stack: err.stack,
          context: { url: req.originalUrl },
          timestamp: new Date().toISOString(),
        });
      }
    },
  );
}
