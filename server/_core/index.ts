import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerScheduledRoutes } from "../scheduledRoutes";
import { registerDevLogin } from "../devLogin";
import { registerPinLogin } from "../pinLogin";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerPinLogin(app);
  // LOCAL DEV ONLY: enables /api/dev-login so the app can be viewed without Manus OAuth.
  // Local dev login is also allowed in production while ENABLE_DEV_LOGIN=true
  // (the pilot sign-in until real per-user auth ships). Keep the URL private.
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_LOGIN === "true"
  ) {
    registerDevLogin(app);
  }
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Scheduled (Heartbeat) HTTP cron handlers — must be before Vite/static fallthrough
  registerScheduledRoutes(app);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // In hosted environments (Railway, etc.) PORT is injected and the router
  // targets exactly that port — bind to it directly, no scanning/drift. Only
  // fall back to a free-port search for local dev when PORT isn't set.
  const port = process.env.PORT
    ? parseInt(process.env.PORT)
    : await findAvailablePort(3000);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
