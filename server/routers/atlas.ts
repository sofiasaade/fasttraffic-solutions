// ATLAS — Executive Command Center. EVERY procedure uses executiveProcedure:
// a coordinator/technician session (or a direct API call) gets FORBIDDEN.
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { executiveProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { execAuditLog, invoices } from "../../drizzle/schema";
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
});
