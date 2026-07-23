# Migration Scope — Moving FTS off Manus

This document scopes what it takes to run the Fast Traffic Solutions app **outside Manus**
(self-hosted), with the full app flow working as it does today.

> **Status:** scoping only. No migration work has started. The whole effort is gated on
> **Step 1 — getting the data out of Manus** (see "Gating items" below).

## Why this is needed

The GitHub repo contains the **code**, but the running app's "brain" lives inside the Manus
platform: the database, the login provider, and several backend services. Deployed anywhere
else *without these*, the frontend loads but the app cannot authenticate or load data — it
renders a **blank page**. (That is exactly what happens on the current Vercel deploy.)

## What stays vs. what must be replaced

| Piece | Today (Manus) | Migration action | Effort |
|---|---|---|---|
| Session / JWT | `jose` JWT in a cookie (`JWT_SECRET`) | Keep as-is | none |
| Airtable sync | Your own Airtable API | Keep — carry the API key over | trivial |
| Database | MySQL, 26 tables, hosted on Manus | New managed MySQL + **export/import your data** | medium (blocked on export) |
| Login | Manus OAuth provider | Swap provider (Google / Clerk / email), keep JWT layer | medium |
| Maps (Day View, Permit Map) | `forge.manus.im` Google proxy | Your own Google Maps API key (billed) | small |
| File storage (logo, job photos) | `/manus-storage/...` | S3 / Cloudflare R2 + **migrate existing files** | medium |
| AI chat / permit extraction | `forge.manus.im` LLM | OpenAI/Anthropic key — or drop if unused | small (or skip) |
| Build runtime | `vite-plugin-manus-runtime`, debug collector | Remove Manus-only plugins, verify prod static serving | small |
| Hosting | Manus | Railway or Render (runs the always-on server + MySQL) | small |

## Hosting: not Vercel

The server is a single always-on Express process (`server/_core/index.ts` → `server.listen`).
Vercel is built for serverless functions, so deploying there means splitting frontend/backend
and restructuring the server. **Railway or Render** run the existing `node dist/index.js` plus a
managed MySQL database side-by-side with almost no code changes — much closer to the current
architecture.

## Gating items (only you / Manus can unblock)

1. **Your data (BLOCKER).** Everything depends on getting a **MySQL dump or external connection**
   out of Manus (workers, jobs, schedules, equipment, trucks). If Manus won't export the database,
   the migration stalls here. **Confirm this first, before any code work.**
2. **Uploaded files.** Logo + job photos in Manus storage must be exported too.
3. **Keys to provide:** Google Maps API key; an LLM key (only if keeping AI features);
   confirm the Airtable API key.
4. **Two decisions:** (a) how users log in afterward (Google sign-in is the easiest swap);
   (b) keep the AI features or drop them.

## Effort & cost (honest estimate)

- Once data export + keys are in hand: roughly a **multi-day engineering effort**.
- **New ongoing monthly costs** not paid on Manus: app host + database + Maps/LLM usage.
- Doable, but it is a project — and it stands or falls on **Step 1: can the data leave Manus?**

## Environment variables (full list to source from Manus)

```
DATABASE_URL                 # MySQL connection (the data)
JWT_SECRET                   # session signing — can be regenerated
OAUTH_SERVER_URL             # Manus OAuth — replaced during migration
VITE_APP_ID                  # Manus OAuth app id — replaced
VITE_OAUTH_PORTAL_URL        # Manus login portal — replaced
BUILT_IN_FORGE_API_URL       # forge.manus.im — replaced (maps/LLM/storage)
BUILT_IN_FORGE_API_KEY       # forge bearer token — replaced
VITE_FRONTEND_FORGE_API_KEY  # frontend forge token — replaced
VITE_FRONTEND_FORGE_API_URL  # frontend forge url — replaced
OWNER_OPEN_ID                # owner identity — revisit with new auth
AIRTABLE_API_KEY             # external — KEEP
AIRTABLE_BASE_ID             # external — KEEP
AIRTABLE_JOBS_TABLE_ID       # external — KEEP
PORT                         # host-provided
```
