# Running Fast Traffic OS locally (no Manus)

This runs the whole app on your Mac against a **local TiDB database** — no Manus, no internet
dependency for the core app. Airtable is **read-only** and currently **not connected** (jobs are
not loaded yet); everything else (login, Workers, Scheduler, Equipment, Trucks) runs locally.

## Open it (while it's already running)

1. Go to: **http://localhost:3000/api/dev-login** ← logs you in as the coordinator
2. You'll be redirected into the app. You stay logged in after that.

> Always start at `/api/dev-login` the first time. If you go straight to `http://localhost:3000`
> before logging in, it will try the (disabled) Manus login and show a blank page.

## Start it again later (after a reboot, or if it's stopped)

From a Terminal:

```bash
cd ~/Desktop/fasttraffic-solutions
./start-local.sh
```

That starts the local database (if needed) and the app, then prints the login link above.
Leave that Terminal window open while you use the app. Press `Ctrl+C` to stop the app.

## What works vs. what doesn't (yet)

| Area | Status |
|---|---|
| Login (local) | ✅ Works — coordinator |
| Workers / technicians | ✅ 28 seeded locally |
| Scheduler, Equipment, Trucks | ✅ Local (Equipment/Trucks seed when first opened) |
| Dispatch / Jobs (from Airtable) | ⏸️ Not loaded — needs a read-only Airtable sync (your go-ahead) |
| Maps, AI chat, file storage | ❌ Off — those were Manus services |
| App logo image | ❌ Was served from Manus storage; shows as broken until re-hosted |

## How this was set up (for reference)

- Node + pnpm installed under `~/.local/node`; TiDB via `tiup` under `~/.tiup`.
- Local DB: `mysql://root@127.0.0.1:4000/fts` (see `.env`).
- Login bypass: `server/devLogin.ts` + a dev-only route in `server/_core/index.ts`
  (both guarded by `NODE_ENV !== "production"`). **Local only — do not deploy.**
