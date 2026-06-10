import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { coordinatorRouter } from "./routers/coordinator";
import { technicianRouter } from "./routers/technician";
import { getTechnicianByUserId } from "./opsDb";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    // Returns the role-aware profile: whether user is coordinator (admin)
    // and/or linked to a technician identity.
    profile: protectedProcedure.query(async ({ ctx }) => {
      let technician = null;
      try {
        technician = (await getTechnicianByUserId(ctx.user.id)) ?? null;
      } catch {
        technician = null;
      }
      return {
        user: ctx.user,
        isCoordinator: ctx.user.role === "admin",
        technician,
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  coordinator: coordinatorRouter,
  technician: technicianRouter,
});

export type AppRouter = typeof appRouter;
