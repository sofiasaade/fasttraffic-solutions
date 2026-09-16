// Inline-view proxy for Airtable attachments (Sofia, Sep 15 2026 —
// 1221 Kensington Rd NW): permits uploaded with an uppercase ".PDF" (or any
// generic upload) reach Airtable's CDN as binary/octet-stream, so browsers
// DOWNLOAD them instead of showing them in the viewer. This route re-serves
// the file with the correct content type and an inline disposition.
// Scope: authenticated sessions only, and ONLY Airtable attachment hosts —
// never a general-purpose proxy.
import type { Express } from "express";
import { sdk } from "./_core/sdk";

const ALLOWED_HOST = /(^|\.)airtableusercontent\.com$|(^|\.)airtable\.com$/i;

export function registerDocProxy(app: Express) {
  app.get("/api/docproxy", async (req, res) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user) return res.status(403).send("Sign in required.");

    const url = String(req.query.url ?? "");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).send("Bad url.");
    }
    if (parsed.protocol !== "https:" || !ALLOWED_HOST.test(parsed.hostname)) {
      return res.status(400).send("Only Airtable attachments can be proxied.");
    }

    try {
      const upstream = await fetch(url);
      if (!upstream.ok) return res.status(502).send("Attachment fetch failed.");
      const buf = Buffer.from(await upstream.arrayBuffer());
      const name = decodeURIComponent(parsed.pathname.split("/").pop() ?? "document");
      const upstreamType = upstream.headers.get("content-type") ?? "";
      const type = /\.pdf$/i.test(String(req.query.name ?? name)) || /pdf/i.test(upstreamType)
        ? "application/pdf"
        : upstreamType || "application/octet-stream";
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(buf);
    } catch (err) {
      console.error("[docproxy] failed", err);
      res.status(502).send("Attachment fetch failed.");
    }
  });
}
