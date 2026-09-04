// ATLAS — Executive Command Center. EVERY procedure uses executiveProcedure:
// a coordinator/technician session (or a direct API call) gets FORBIDDEN.
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { executiveProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  execAuditLog,
  execCollections,
  execDecisions,
  execPriorities,
  invoices,
} from "../../drizzle/schema";
import { execAudit } from "../execAuth";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

function calgaryToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
}

export const atlasRouter = router({
  /** Session probe — also writes the access-log entry for this visit. */
  me: executiveProcedure.query(async ({ ctx }) => {
    await execAudit(ctx.user.email ?? "executive", "view", "ATLAS opened");
    return {
      email: ctx.user.email,
      name: ctx.user.name,
      today: calgaryToday(),
    };
  }),

  /** Access / export / change log for the executive module (newest first). */
  auditLog: executiveProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      return d
        .select()
        .from(execAuditLog)
        .orderBy(desc(execAuditLog.id))
        .limit(input?.limit ?? 100);
    }),

  /**
   * Current Company Snapshot — ONLY from sources the app actually has today
   * (own invoices + Airtable operations). QuickBooks figures join in F1d;
   * until then cash/AR-contable show as "not connected", never invented.
   */
  snapshot: executiveProcedure.query(async ({ ctx }) => {
    const d = await db();
    const today = calgaryToday();
    const monthStart = today.slice(0, 7) + "-01";

    const rows = await d.select().from(invoices);
    const live = rows.filter((r) => !r.deletedAt && r.status !== "quote" && r.status !== "void");
    const thisMonth = live.filter((r) => r.issueDate >= monthStart);
    const prevMonthStart = (() => {
      const d0 = new Date(monthStart + "T00:00:00");
      d0.setMonth(d0.getMonth() - 1);
      return d0.toISOString().slice(0, 10);
    })();
    const prevMonth = live.filter(
      (r) => r.issueDate >= prevMonthStart && r.issueDate < monthStart,
    );

    const sum = (list: typeof live) => list.reduce((n, r) => n + r.totalCents, 0);
    const outstanding = live.filter((r) => r.status === "sent" || r.status === "in_qb");
    const drafts = live.filter((r) => r.status === "draft");
    const quotes = rows.filter((r) => !r.deletedAt && r.status === "quote");

    // Airtable operational picture (billing pipeline) — via the same cached
    // fetchers the Accounting screen uses.
    const { fetchAccountingJobs } = await import("../airtable");
    let readyToBill = 0;
    let pickedUp = 0;
    let unbilledOver48h = 0;
    let unbilledJobs: { id: string; company: string | null; endDate: string | null; status: string | null; ageDays: number | null }[] = [];
    let airtableOk = true;
    try {
      const jobs = await fetchAccountingJobs();
      const { getDb: _g } = await import("../db");
      const invByJob = new Set(
        live.filter((r) => r.airtableJobId).map((r) => r.airtableJobId as string),
      );
      const now = Date.now();
      for (const j of jobs as any[]) {
        const st = (j.status ?? "").toLowerCase();
        const isReady = /ready to bill/.test(st);
        const isPicked = /picked/.test(st);
        if (isReady) readyToBill++;
        if (isPicked) pickedUp++;
        if ((isReady || isPicked) && !invByJob.has(j.id)) {
          const end = j.endDate ? new Date(j.endDate.slice(0, 10) + "T00:00:00").getTime() : null;
          const ageDays = end ? Math.floor((now - end) / 86400000) : null;
          if (ageDays != null && ageDays >= 2) unbilledOver48h++;
          unbilledJobs.push({
            id: j.id,
            company: j.company ?? null,
            endDate: j.endDate ?? null,
            status: j.status ?? null,
            ageDays,
          });
        }
      }
      unbilledJobs.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
    } catch {
      airtableOk = false;
    }

    await execAudit(ctx.user.email ?? "executive", "view", "snapshot");
    return {
      generatedAt: new Date().toISOString(),
      sources: {
        appInvoices: { ok: true, label: "FTS OS invoices (TiDB)" },
        airtable: { ok: airtableOk, label: "Airtable operations" },
        quickbooks: { ok: false, label: "QuickBooks — not connected yet (F1d)" },
      },
      billing: {
        invoicedThisMonthCents: sum(thisMonth),
        invoicedThisMonthCount: thisMonth.length,
        invoicedPrevMonthCents: sum(prevMonth),
        invoicedPrevMonthCount: prevMonth.length,
        paidCents: sum(live.filter((r) => r.status === "paid")),
        outstandingAppCents: sum(outstanding),
        outstandingAppCount: outstanding.length,
        draftCents: sum(drafts),
        draftCount: drafts.length,
        quotesPipelineCents: sum(quotes as any),
        quotesCount: quotes.length,
      },
      unbilled: {
        readyToBill,
        pickedUp,
        withoutInvoice: unbilledJobs.length,
        over48h: unbilledOver48h,
        jobs: unbilledJobs.slice(0, 50),
      },
    };
  }),

  /* ======================= F1c — COLLECTIONS ======================= */

  /**
   * Collections worklist: every outstanding app invoice (sent / in_qb) joined
   * with its follow-up record. Aging is computed from dueDate when the invoice
   * has one, otherwise from issueDate — and the basis is reported per row so
   * nothing is presented as more precise than it is. QB balances join in F1d.
   */
  collectionsList: executiveProcedure.query(async ({ ctx }) => {
    const d = await db();
    const inv = await d.select().from(invoices);
    const followUps = await d.select().from(execCollections);
    const fuByInvoice = new Map(followUps.map((f) => [f.invoiceId, f]));
    const today = calgaryToday();
    const t0 = new Date(today + "T00:00:00").getTime();

    const rows = inv
      .filter((r) => !r.deletedAt && (r.status === "sent" || r.status === "in_qb"))
      .map((r) => {
        const basis = r.dueDate ? "due" : "issue";
        const ref = r.dueDate ?? r.issueDate;
        const ageDays = Math.floor((t0 - new Date(ref + "T00:00:00").getTime()) / 86400000);
        const bucket =
          basis === "due" && ageDays <= 0
            ? "current"
            : ageDays <= 30
              ? "1-30"
              : ageDays <= 60
                ? "31-60"
                : ageDays <= 90
                  ? "61-90"
                  : "90+";
        const f = fuByInvoice.get(r.id) ?? null;
        return {
          invoiceId: r.id,
          invoiceNumber: r.invoiceNumber,
          qbNumber: r.qbNumber,
          clientName: r.clientName,
          status: r.status,
          issueDate: r.issueDate,
          dueDate: r.dueDate,
          totalCents: r.totalCents,
          ageDays,
          agingBasis: basis as "due" | "issue",
          bucket,
          followUp: f,
        };
      })
      .sort((a, b) => b.ageDays - a.ageDays);

    const totals: Record<string, { cents: number; count: number }> = {};
    for (const r of rows) {
      const t = (totals[r.bucket] ??= { cents: 0, count: 0 });
      t.cents += r.totalCents;
      t.count++;
    }
    await execAudit(ctx.user.email ?? "executive", "view", "collections");
    return {
      rows,
      totals,
      outstandingCents: rows.reduce((n, r) => n + r.totalCents, 0),
      note: "Basado en facturas de FTS OS (sent / in QB). El saldo contable exacto llega con QuickBooks (F1d).",
    };
  }),

  /** Upsert the follow-up record for one invoice (promise, dispute, next step). */
  collectionsUpdate: executiveProcedure
    .input(
      z.object({
        invoiceId: z.number().int(),
        lastContact: z.string().max(10).nullable().optional(),
        contactOutcome: z.string().max(300).nullable().optional(),
        nextFollowUp: z.string().max(10).nullable().optional(),
        responsible: z.string().max(64).nullable().optional(),
        promiseToPay: z.boolean().optional(),
        promiseDate: z.string().max(10).nullable().optional(),
        dispute: z.boolean().optional(),
        disputeNote: z.string().max(500).nullable().optional(),
        riskLevel: z.enum(["low", "med", "high"]).optional(),
        notes: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const { invoiceId, ...fields } = input;
      const existing = await d
        .select()
        .from(execCollections)
        .where(eq(execCollections.invoiceId, invoiceId))
        .limit(1);
      if (existing[0]) {
        await d.update(execCollections).set(fields).where(eq(execCollections.invoiceId, invoiceId));
      } else {
        await d.insert(execCollections).values({ invoiceId, ...fields });
      }
      await execAudit(ctx.user.email ?? "executive", "edit", `collections invoice #${invoiceId}`);
      return { ok: true };
    }),

  /* ================== F1e — MY EXECUTIVE PRIORITIES ================== */

  prioritiesList: executiveProcedure.query(async () => {
    const d = await db();
    return d.select().from(execPriorities).orderBy(desc(execPriorities.id));
  }),

  priorityCreate: executiveProcedure
    .input(
      z.object({
        title: z.string().min(1).max(300),
        notes: z.string().max(4000).nullable().optional(),
        category: z.string().max(24).default("CEO"),
        priority: z.enum(["low", "med", "high"]).default("med"),
        dueDate: z.string().max(10).nullable().optional(),
        relatedLabel: z.string().max(256).nullable().optional(),
        nextAction: z.string().max(500).nullable().optional(),
        recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await d.insert(execPriorities).values(input);
      await execAudit(ctx.user.email ?? "executive", "edit", `priority created: ${input.title.slice(0, 80)}`);
      return { ok: true };
    }),

  priorityUpdate: executiveProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string().min(1).max(300).optional(),
        notes: z.string().max(4000).nullable().optional(),
        category: z.string().max(24).optional(),
        priority: z.enum(["low", "med", "high"]).optional(),
        dueDate: z.string().max(10).nullable().optional(),
        status: z
          .enum([
            "not_started",
            "in_progress",
            "waiting",
            "delegated",
            "decision_required",
            "completed",
            "cancelled",
          ])
          .optional(),
        delegatedTo: z.string().max(128).nullable().optional(),
        waitingOn: z.string().max(128).nullable().optional(),
        relatedLabel: z.string().max(256).nullable().optional(),
        nextAction: z.string().max(500).nullable().optional(),
        recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const { id, ...fields } = input;
      const patch: Record<string, unknown> = { ...fields };
      if (fields.status === "completed") patch.completedAt = new Date();
      else if (fields.status) patch.completedAt = null;
      await d.update(execPriorities).set(patch).where(eq(execPriorities.id, id));
      await execAudit(ctx.user.email ?? "executive", "edit", `priority #${id} updated`);
      return { ok: true };
    }),

  priorityDelete: executiveProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await d.delete(execPriorities).where(eq(execPriorities.id, input.id));
      await execAudit(ctx.user.email ?? "executive", "edit", `priority #${input.id} deleted`);
      return { ok: true };
    }),

  /* ===================== F1e — DECISION INBOX ===================== */

  decisionsList: executiveProcedure.query(async () => {
    const d = await db();
    return d.select().from(execDecisions).orderBy(desc(execDecisions.id));
  }),

  decisionCreate: executiveProcedure
    .input(
      z.object({
        title: z.string().min(1).max(300),
        context: z.string().max(8000).nullable().optional(),
        options: z
          .array(z.object({ label: z.string().max(300), impact: z.string().max(500).optional() }))
          .max(10)
          .optional(),
        recommendation: z.string().max(4000).nullable().optional(),
        missingInfo: z.string().max(2000).nullable().optional(),
        dueDate: z.string().max(10).nullable().optional(),
        ownerAfter: z.string().max(128).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const { options, ...rest } = input;
      await d.insert(execDecisions).values({
        ...rest,
        optionsJson: options?.length ? JSON.stringify(options) : null,
      });
      await execAudit(ctx.user.email ?? "executive", "edit", `decision created: ${input.title.slice(0, 80)}`);
      return { ok: true };
    }),

  /**
   * Record the owner's decision. ATLAS never executes anything from it —
   * it only stores the judgement and who carries it out.
   */
  decisionDecide: executiveProcedure
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(["approved", "rejected", "postponed", "open"]),
        decisionNote: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await d
        .update(execDecisions)
        .set({
          status: input.status,
          decisionNote: input.decisionNote ?? null,
          decidedAt: input.status === "open" ? null : new Date(),
        })
        .where(eq(execDecisions.id, input.id));
      await execAudit(ctx.user.email ?? "executive", "edit", `decision #${input.id} → ${input.status}`);
      return { ok: true };
    }),

  decisionDelete: executiveProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await d.delete(execDecisions).where(eq(execDecisions.id, input.id));
      await execAudit(ctx.user.email ?? "executive", "edit", `decision #${input.id} deleted`);
      return { ok: true };
    }),
});
