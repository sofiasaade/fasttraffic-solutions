import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || (ctx.user.role !== 'admin' && ctx.user.role !== 'executive')) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * ATLAS: only the Executive Owner role passes — enforced on EVERY call.
 * Base variant: role check only (used by atlas.me so the client can learn
 * that account setup is pending).
 */
export const executiveBaseProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'executive') {
      throw new TRPCError({ code: "FORBIDDEN", message: "Executive access only." });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Strict variant for every data procedure: the executive account must have
 * finished setup (definitive password + MFA enabled) before ANY figure is
 * served. This closes the client-side-only enrolment gap — reloading past
 * the setup screen no longer reaches data.
 */
export const executiveProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'executive') {
      throw new TRPCError({ code: "FORBIDDEN", message: "Executive access only." });
    }
    const user = ctx.user;

    const { getDb } = await import("../db");
    const { executiveAuth } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    const rows = await db
      .select()
      .from(executiveAuth)
      .where(eq(executiveAuth.email, (user.email ?? "").toLowerCase()))
      .limit(1);
    const row = rows[0];
    if (!row || row.mustChangePassword || !row.totpEnabled) {
      throw new TRPCError({ code: "FORBIDDEN", message: "SETUP_REQUIRED" });
    }

    return next({
      ctx: {
        ...ctx,
        user,
      },
    });
  }),
);
