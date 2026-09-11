// ATLAS — Executive Command Center. EVERY procedure uses executiveProcedure:
// a coordinator/technician session (or a direct API call) gets FORBIDDEN.
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { executiveBaseProcedure, executiveProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  execAuditLog,
  execCollections,
  execDecisions,
  execPriorities,
  invoices,
} from "../../drizzle/schema";
import { execAudit } from "../execAuth";
import { getConnection as getQbConnection, qbConfigured, qbGet, qbQuery } from "../qb";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

function calgaryToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
}

export const atlasRouter = router({
  /**
   * Session probe — role check only, so the client can learn that account
   * setup (definitive password + MFA) is still pending. Every DATA procedure
   * below refuses to serve until setup is complete.
   */
  me: executiveBaseProcedure.query(async ({ ctx }) => {
    const d = await db();
    const { executiveAuth } = await import("../../drizzle/schema");
    const rows = await d
      .select()
      .from(executiveAuth)
      .where(eq(executiveAuth.email, (ctx.user.email ?? "").toLowerCase()))
      .limit(1);
    const row = rows[0] ?? null;
    await execAudit(ctx.user.email ?? "executive", "view", "ATLAS opened");
    return {
      email: ctx.user.email,
      name: ctx.user.name,
      today: calgaryToday(),
      needsPasswordChange: row ? row.mustChangePassword : false,
      needsMfa: row ? !row.totpEnabled : false,
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
        quickbooks: await (async () => {
          const conn = await getQbConnection().catch(() => null);
          return conn
            ? { ok: true, label: `QuickBooks — ${conn.companyName ?? "conectado"}` }
            : { ok: false, label: "QuickBooks — not connected yet (F1d)" };
        })(),
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
    // When QuickBooks is connected, join the REAL open balance per invoice by
    // matching our qbNumber against the QB DocNumber. Read-only; failure-safe.
    let qbJoined = false;
    let qbError: string | null = null;
    const qbConn = await getQbConnection().catch(() => null);
    if (qbConn) {
      try {
        const res = await qbQuery<any>(
          "SELECT DocNumber, Balance, TotalAmt FROM Invoice WHERE Balance > '0' MAXRESULTS 1000",
        );
        const byDoc = new Map<string, { balance: number; total: number }>();
        for (const qi of res?.QueryResponse?.Invoice ?? []) {
          if (qi.DocNumber) byDoc.set(String(qi.DocNumber), { balance: qi.Balance, total: qi.TotalAmt });
        }
        for (const r of rows as any[]) {
          const m = r.qbNumber ? byDoc.get(String(r.qbNumber)) : undefined;
          r.qbBalanceCents = m ? Math.round(m.balance * 100) : null;
        }
        qbJoined = true;
      } catch (err) {
        qbError = String(err).slice(0, 200);
      }
    }

    await execAudit(ctx.user.email ?? "executive", "view", "collections");
    return {
      rows,
      totals,
      outstandingCents: rows.reduce((n, r) => n + r.totalCents, 0),
      qb: { connected: Boolean(qbConn), joined: qbJoined, error: qbError },
      note: qbJoined
        ? "Facturas de FTS OS; el saldo QB por factura viene en vivo de QuickBooks (solo lectura)."
        : "Basado en facturas de FTS OS (sent / in QB). El saldo contable exacto llega con QuickBooks (F1d).",
    };
  }),

  /* ==================== F1d — QUICKBOOKS (READ-ONLY) ==================== */

  /** Connection state — never exposes tokens, only metadata. */
  qbStatus: executiveProcedure.query(async () => {
    const conn = await getQbConnection().catch(() => null);
    return {
      configured: qbConfigured(),
      connected: Boolean(conn),
      companyName: conn?.companyName ?? null,
      connectedBy: conn?.connectedByEmail ?? null,
      refreshTokenExpiresAt: conn?.refreshTokenExpiresAt ?? null,
    };
  }),

  /**
   * CFO view — 100% real QuickBooks data, read-only. Anything the API doesn't
   * give us is reported as unavailable, never estimated.
   */
  cfo: executiveProcedure.query(async ({ ctx }) => {
    const conn = await getQbConnection().catch(() => null);
    if (!conn) return { connected: false as const };

    const today = calgaryToday();
    const monthStart = today.slice(0, 7) + "-01";
    const out: any = { connected: true as const, companyName: conn.companyName, errors: [] as string[] };

    // Cash: sum of Bank account balances.
    try {
      const res = await qbQuery<any>("SELECT Name, CurrentBalance FROM Account WHERE AccountType = 'Bank'");
      const accounts = (res?.QueryResponse?.Account ?? []).map((a: any) => ({
        name: a.Name,
        balanceCents: Math.round((a.CurrentBalance ?? 0) * 100),
      }));
      out.cash = {
        totalCents: accounts.reduce((n: number, a: any) => n + a.balanceCents, 0),
        accounts,
      };
    } catch (err) {
      out.errors.push("Bancos: " + String(err).slice(0, 150));
    }

    // AR: open invoices with aging by DueDate (QB is the accounting truth here).
    try {
      const res = await qbQuery<any>(
        "SELECT DocNumber, Balance, TotalAmt, DueDate, TxnDate, CustomerRef FROM Invoice WHERE Balance > '0' ORDERBY DueDate MAXRESULTS 1000",
      );
      const invs = res?.QueryResponse?.Invoice ?? [];
      const t0 = new Date(today + "T00:00:00").getTime();
      const buckets: Record<string, number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
      const byCustomer = new Map<string, number>();
      let totalCents = 0;
      for (const i of invs) {
        const cents = Math.round((i.Balance ?? 0) * 100);
        totalCents += cents;
        const ref = i.DueDate ?? i.TxnDate;
        const age = ref ? Math.floor((t0 - new Date(ref + "T00:00:00").getTime()) / 86400000) : 0;
        const b = age <= 0 ? "current" : age <= 30 ? "1-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";
        buckets[b] += cents;
        const cust = i.CustomerRef?.name ?? "(sin cliente)";
        byCustomer.set(cust, (byCustomer.get(cust) ?? 0) + cents);
      }
      out.ar = {
        totalCents,
        openInvoices: invs.length,
        buckets,
        topCustomers: Array.from(byCustomer.entries())
          .map(([name, cents]) => ({ name, cents }))
          .sort((a, b) => b.cents - a.cents)
          .slice(0, 10),
      };
    } catch (err) {
      out.errors.push("Cuentas por cobrar: " + String(err).slice(0, 150));
    }

    // P&L month-to-date, straight from the QB report.
    try {
      const rep = await qbGet<any>(
        `reports/ProfitAndLoss?start_date=${monthStart}&end_date=${today}`,
      );
      const find = (label: string): number | null => {
        let val: number | null = null;
        const walk = (rows: any[]) => {
          for (const r of rows ?? []) {
            const cols = r.Summary?.ColData ?? [];
            if (cols[0]?.value === label && cols[1]?.value != null) {
              const n = Number(cols[1].value);
              if (!Number.isNaN(n)) val = n;
            }
            if (r.Rows?.Row) walk(r.Rows.Row);
          }
        };
        walk(rep?.Rows?.Row ?? []);
        return val;
      };
      const income = find("Total Income") ?? find("Total Revenue");
      const expenses = find("Total Expenses");
      // Label varies by region/version ("Net Income", "Net Earnings", "Profit for the year");
      // when absent, net = income − expenses is exact arithmetic, not an estimate.
      let net = find("Net Income") ?? find("Net Earnings") ?? find("Profit");
      if (net == null && income != null && expenses != null) net = income - expenses;
      out.pnl = {
        from: monthStart,
        to: today,
        incomeCents: income != null ? Math.round(income * 100) : null,
        expensesCents: expenses != null ? Math.round(expenses * 100) : null,
        netCents: net != null ? Math.round(net * 100) : null,
      };
    } catch (err) {
      out.errors.push("P&L: " + String(err).slice(0, 150));
    }

    await execAudit(ctx.user.email ?? "executive", "view", "cfo (QuickBooks)");
    return out;
  }),

  /* ==================== CFO v2 — OVERVIEW (un solo fetch) ==================== */

  /**
   * Everything the CFO dashboard shows, with previous-period comparisons.
   * QuickBooks is the accounting source (read-only); app+Airtable provide the
   * operational layer (completed-but-not-billed). Anything unavailable is
   * returned as null with the reason — the UI must say "no disponible", not 0.
   */
  cfoOverview: executiveProcedure
    .input(
      z
        .object({
          period: z.enum(["month", "last_month", "quarter", "ytd", "12m"]).default("month"),
          seriesMonths: z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)]).default(12),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const period = input?.period ?? "month";
      const seriesMonths = input?.seriesMonths ?? 12;
      const conn = await getQbConnection().catch(() => null);
      const today = calgaryToday();
      const out: any = {
        connected: Boolean(conn),
        generatedAt: new Date().toISOString(),
        period,
        errors: [] as string[],
      };
      if (!conn) return out;

      /* ---- period ranges ---- */
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const monthStart = today.slice(0, 7) + "-01";
      const mk = (s: string, e: string) => ({ start: s, end: e });
      const shiftMonths = (base: string, n: number) => {
        const d0 = new Date(base + "T00:00:00");
        d0.setMonth(d0.getMonth() + n);
        return iso(d0);
      };
      let cur: { start: string; end: string };
      let prev: { start: string; end: string };
      if (period === "month") {
        cur = mk(monthStart, today);
        prev = mk(shiftMonths(monthStart, -1), shiftMonths(monthStart, -1).slice(0, 8) + today.slice(8, 10));
      } else if (period === "last_month") {
        const s = shiftMonths(monthStart, -1);
        const e = iso(new Date(new Date(monthStart + "T00:00:00").getTime() - 86400000));
        cur = mk(s, e);
        const s2 = shiftMonths(monthStart, -2);
        const e2 = iso(new Date(new Date(s + "T00:00:00").getTime() - 86400000));
        prev = mk(s2, e2);
      } else if (period === "quarter") {
        const m = Number(today.slice(5, 7));
        const qStartMonth = m - ((m - 1) % 3);
        const s = today.slice(0, 5) + String(qStartMonth).padStart(2, "0") + "-01";
        cur = mk(s, today);
        prev = mk(shiftMonths(s, -3), shiftMonths(s, -3 + 3).slice(0, 10) < today ? iso(new Date(new Date(s + "T00:00:00").getTime() - 86400000)) : today);
        prev = mk(shiftMonths(s, -3), iso(new Date(new Date(s + "T00:00:00").getTime() - 86400000)));
      } else if (period === "ytd") {
        cur = mk(today.slice(0, 4) + "-01-01", today);
        prev = mk(String(Number(today.slice(0, 4)) - 1) + "-01-01", String(Number(today.slice(0, 4)) - 1) + today.slice(4, 10));
      } else {
        cur = mk(shiftMonths(monthStart, -11), today);
        prev = mk(shiftMonths(monthStart, -23), iso(new Date(new Date(shiftMonths(monthStart, -11) + "T00:00:00").getTime() - 86400000)));
      }
      out.range = { cur, prev };

      /* ---- P&L for a range: income, expenses, COGS/gross when QB has them, expense categories ---- */
      const pnlFor = async (r: { start: string; end: string }) => {
        const rep = await qbGet<any>(`reports/ProfitAndLoss?start_date=${r.start}&end_date=${r.end}`);
        const res: any = { incomeCents: null, expensesCents: null, cogsCents: null, grossCents: null, categories: [] };
        const catRows: { name: string; cents: number }[] = [];
        const walk = (rows: any[], inExpenses: boolean) => {
          for (const row of rows ?? []) {
            const sum = row.Summary?.ColData ?? [];
            const label = sum[0]?.value;
            const val = sum[1]?.value != null ? Number(sum[1].value) : null;
            if (label === "Total Income" || label === "Total Revenue") res.incomeCents = Math.round((val ?? 0) * 100);
            if (label === "Total Expenses") res.expensesCents = Math.round((val ?? 0) * 100);
            if (label === "Total Cost of Goods Sold") res.cogsCents = Math.round((val ?? 0) * 100);
            if (label === "Gross Profit") res.grossCents = Math.round((val ?? 0) * 100);
            const isExpensesGroup = row.group === "Expenses";
            // leaf expense lines: ColData [name, value] with no nested rows
            if (inExpenses && row.ColData?.length >= 2 && !row.Rows) {
              const n = Number(row.ColData[1]?.value);
              if (row.ColData[0]?.value && !Number.isNaN(n) && n !== 0) {
                catRows.push({ name: row.ColData[0].value, cents: Math.round(n * 100) });
              }
            }
            if (row.Rows?.Row) walk(row.Rows.Row, inExpenses || isExpensesGroup);
          }
        };
        walk(rep?.Rows?.Row ?? [], false);
        res.categories = catRows.sort((a, b) => b.cents - a.cents);
        res.netCents =
          res.incomeCents != null && res.expensesCents != null
            ? res.incomeCents - (res.cogsCents ?? 0) - res.expensesCents
            : null;
        return res;
      };
      let pnlCur: any = null;
      let pnlPrev: any = null;
      try {
        pnlCur = await pnlFor(cur);
        pnlPrev = await pnlFor(prev);
        out.pnl = { cur: pnlCur, prev: pnlPrev };
      } catch (err) {
        out.errors.push("P&L: " + String(err).slice(0, 150));
      }

      /* ---- payments (cash collected) ---- */
      let payments: any[] = [];
      try {
        const res = await qbQuery<any>("SELECT TotalAmt, TxnDate FROM Payment ORDERBY TxnDate DESC MAXRESULTS 1000");
        payments = res?.QueryResponse?.Payment ?? [];
        out.paymentsCapped = payments.length === 1000;
        const inRange = (p: any, r: { start: string; end: string }) => p.TxnDate >= r.start && p.TxnDate <= r.end;
        out.collected = {
          curCents: Math.round(payments.filter((p) => inRange(p, cur)).reduce((n, p) => n + (p.TotalAmt ?? 0), 0) * 100),
          prevCents: Math.round(payments.filter((p) => inRange(p, prev)).reduce((n, p) => n + (p.TotalAmt ?? 0), 0) * 100),
        };
      } catch (err) {
        out.errors.push("Pagos recibidos: " + String(err).slice(0, 150));
      }

      /* ---- invoiced by month + collected by month (chart 1) ---- */
      try {
        const res = await qbQuery<any>("SELECT TotalAmt, TxnDate FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 1000");
        const invs = res?.QueryResponse?.Invoice ?? [];
        out.invoicesCapped = invs.length === 1000;
        const first = shiftMonths(monthStart, -(seriesMonths - 1));
        const keys: string[] = [];
        for (let k = 0; k < seriesMonths; k++) keys.push(shiftMonths(first, k).slice(0, 7));
        const invByM = new Map<string, { cents: number; count: number }>();
        const payByM = new Map<string, { cents: number; count: number }>();
        for (const i of invs) {
          const key = (i.TxnDate ?? "").slice(0, 7);
          const m = invByM.get(key) ?? { cents: 0, count: 0 };
          m.cents += Math.round((i.TotalAmt ?? 0) * 100);
          m.count++;
          invByM.set(key, m);
        }
        for (const p of payments) {
          const key = (p.TxnDate ?? "").slice(0, 7);
          const m = payByM.get(key) ?? { cents: 0, count: 0 };
          m.cents += Math.round((p.TotalAmt ?? 0) * 100);
          m.count++;
          payByM.set(key, m);
        }
        out.series = keys.map((key) => ({
          month: key,
          invoicedCents: invByM.get(key)?.cents ?? 0,
          invoicedCount: invByM.get(key)?.count ?? 0,
          collectedCents: payByM.get(key)?.cents ?? 0,
          collectedCount: payByM.get(key)?.count ?? 0,
        }));
      } catch (err) {
        out.errors.push("Serie mensual: " + String(err).slice(0, 150));
      }

      /* ---- cash + AR (reuse the same queries the classic cfo uses) ---- */
      try {
        const res = await qbQuery<any>("SELECT Name, CurrentBalance FROM Account WHERE AccountType = 'Bank'");
        const accounts = (res?.QueryResponse?.Account ?? []).map((a: any) => ({
          name: a.Name,
          balanceCents: Math.round((a.CurrentBalance ?? 0) * 100),
        }));
        out.cash = { totalCents: accounts.reduce((n: number, a: any) => n + a.balanceCents, 0), accounts };
      } catch (err) {
        out.errors.push("Bancos: " + String(err).slice(0, 150));
      }
      try {
        const res = await qbQuery<any>(
          "SELECT DocNumber, Balance, DueDate, TxnDate, CustomerRef FROM Invoice WHERE Balance > '0' MAXRESULTS 1000",
        );
        const invs = res?.QueryResponse?.Invoice ?? [];
        const t0 = new Date(today + "T00:00:00").getTime();
        const buckets: Record<string, { cents: number; count: number }> = {
          current: { cents: 0, count: 0 }, "1-30": { cents: 0, count: 0 }, "31-60": { cents: 0, count: 0 },
          "61-90": { cents: 0, count: 0 }, "90+": { cents: 0, count: 0 },
        };
        let totalCents = 0;
        let overdueCents = 0;
        const topOverdue: any[] = [];
        for (const i of invs) {
          const cents = Math.round((i.Balance ?? 0) * 100);
          totalCents += cents;
          const ref = i.DueDate ?? i.TxnDate;
          const age = ref ? Math.floor((t0 - new Date(ref + "T00:00:00").getTime()) / 86400000) : 0;
          const b = age <= 0 ? "current" : age <= 30 ? "1-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";
          buckets[b].cents += cents;
          buckets[b].count++;
          if (age > 0) {
            overdueCents += cents;
            topOverdue.push({ doc: i.DocNumber, customer: i.CustomerRef?.name ?? "", cents, age });
          }
        }
        // Open credit memos and unapplied payments reduce what is truly
        // collectible — without them the AR figure overstates (found in the
        // Sep 8 validation against QB's AgedReceivables report).
        let creditsCents = 0;
        try {
          const cms = await qbQuery<any>("SELECT Balance FROM CreditMemo MAXRESULTS 1000");
          creditsCents += Math.round(
            (cms?.QueryResponse?.CreditMemo ?? []).reduce((n: number, x: any) => n + (x.Balance ?? 0), 0) * 100,
          );
          const ups = await qbQuery<any>("SELECT UnappliedAmt FROM Payment MAXRESULTS 1000");
          creditsCents += Math.round(
            (ups?.QueryResponse?.Payment ?? []).reduce((n: number, x: any) => n + (x.UnappliedAmt ?? 0), 0) * 100,
          );
        } catch {
          // credits unavailable — report gross only, never a guessed net
          creditsCents = -1;
        }
        out.ar = {
          totalCents, overdueCents, openInvoices: invs.length, buckets,
          creditsCents: creditsCents >= 0 ? creditsCents : null,
          netCents: creditsCents >= 0 ? totalCents - creditsCents : null,
          topOverdue: topOverdue.sort((a, b) => b.cents - a.cents).slice(0, 5),
        };
      } catch (err) {
        out.errors.push("Cuentas por cobrar: " + String(err).slice(0, 150));
      }

      /* ---- obligations: AP, GST, taxes, loans + intercompany separated ---- */
      try {
        const res = await qbQuery<any>(
          "SELECT Name, AccountType, AccountSubType, CurrentBalance FROM Account WHERE Active = true MAXRESULTS 1000",
        );
        const accounts = (res?.QueryResponse?.Account ?? []) as any[];
        const pick = (types: string[]) =>
          accounts
            .filter((a) => types.includes(a.AccountType) && Math.round((a.CurrentBalance ?? 0) * 100) !== 0)
            .map((a) => ({ name: a.Name, type: a.AccountType, cents: Math.round((a.CurrentBalance ?? 0) * 100) }));
        const isInterco = (n: string) => /holding|intercompan|inter-compan|due to.*related|related part/i.test(n);
        const liabilities = pick(["Accounts Payable", "Other Current Liability", "Credit Card", "Long Term Liability"]);
        out.obligations = {
          ap: liabilities.filter((a) => a.type === "Accounts Payable" && !isInterco(a.name)),
          tax: liabilities.filter((a) => a.type === "Other Current Liability" && /gst|tax|impuesto|cra|receiver general/i.test(a.name) && !isInterco(a.name)),
          creditCards: liabilities.filter((a) => a.type === "Credit Card" && !isInterco(a.name)),
          loans: liabilities.filter((a) => a.type === "Long Term Liability" && !isInterco(a.name)),
          otherCurrent: liabilities.filter((a) => a.type === "Other Current Liability" && !/gst|tax|impuesto|cra|receiver general/i.test(a.name) && !isInterco(a.name)),
          intercompany: liabilities.filter((a) => isInterco(a.name)),
          payrollNote: "Nómina: no disponible — QuickBooks Payroll no expone estos datos por el API de contabilidad.",
        };
      } catch (err) {
        out.errors.push("Obligaciones: " + String(err).slice(0, 150));
      }

      /* ---- completed-but-not-billed aging (operational, Airtable+app) ---- */
      try {
        const d = await db();
        const appInv = await d.select().from(invoices);
        const live = appInv.filter((r) => !r.deletedAt && r.status !== "quote" && r.status !== "void");
        const invByJob = new Set(live.filter((r) => r.airtableJobId).map((r) => r.airtableJobId as string));
        const { fetchAccountingJobs } = await import("../airtable");
        const jobs = (await fetchAccountingJobs()) as any[];
        const now = Date.now();
        const cb = { "0-2": 0, "3-7": 0, "8-14": 0, "14+": 0, unknown: 0, total: 0 };
        for (const j of jobs) {
          const st = (j.status ?? "").toLowerCase();
          if (!(/ready to bill/.test(st) || /picked/.test(st)) || invByJob.has(j.id)) continue;
          cb.total++;
          const end = j.endDate ? new Date(String(j.endDate).slice(0, 10) + "T00:00:00").getTime() : null;
          if (end == null) { cb.unknown++; continue; }
          const days = Math.floor((now - end) / 86400000);
          if (days <= 2) cb["0-2"]++;
          else if (days <= 7) cb["3-7"]++;
          else if (days <= 14) cb["8-14"]++;
          else cb["14+"]++;
        }
        out.cbnb = {
          ...cb,
          valueNote:
            "Valor potencial: no calculable — estos trabajos aún no tienen factura ni cotización ligada. Cargo potencial omitido = requiere revisión humana.",
        };
      } catch (err) {
        out.errors.push("Completado sin facturar: " + String(err).slice(0, 150));
      }

      /* ---- executive summary: hechos / alertas / acciones ---- */
      const money0 = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-CA");
      const hechos: string[] = [];
      const alertas: string[] = [];
      const acciones: string[] = [];
      if (out.cash) hechos.push(`Hay ${money0(out.cash.totalCents)} de efectivo en ${out.cash.accounts.length} cuentas bancarias.`);
      if (pnlCur?.incomeCents != null) hechos.push(`En el periodo se facturaron ${money0(pnlCur.incomeCents)} (periodo anterior: ${pnlPrev?.incomeCents != null ? money0(pnlPrev.incomeCents) : "n/d"}).`);
      if (out.collected) hechos.push(`Se cobraron ${money0(out.collected.curCents)} en efectivo (anterior: ${money0(out.collected.prevCents)}). Facturar no es lo mismo que cobrar.`);
      if (out.ar) {
        const pct = out.ar.totalCents ? Math.round((out.ar.overdueCents / out.ar.totalCents) * 100) : 0;
        if (out.ar.overdueCents > 0) {
          alertas.push(`${money0(out.ar.overdueCents)} de la cartera está VENCIDA (${pct}% del total por cobrar de ${money0(out.ar.totalCents)}).`);
          if (out.ar.topOverdue?.length) {
            acciones.push(`Contactar primero las ${Math.min(5, out.ar.topOverdue.length)} facturas vencidas de mayor valor (empiezan con ${out.ar.topOverdue[0].customer} por ${money0(out.ar.topOverdue[0].cents)}). Abre Collections.`);
          }
        }
      }
      if (out.cbnb?.total > 0) {
        alertas.push(`${out.cbnb.total} trabajos completados siguen sin factura${out.cbnb["14+"] ? ` — ${out.cbnb["14+"]} llevan más de 14 días` : ""}. Ese dinero no entra hasta facturarlo.`);
        acciones.push("Completar la facturación de los trabajos más viejos de la lista Unbilled (meta interna: 24-48 h).");
      }
      if (pnlCur?.netCents != null && pnlCur.netCents < 0) alertas.push(`El periodo va con resultado neto NEGATIVO: ${money0(pnlCur.netCents)}.`);
      if (out.obligations) {
        const oblig = [...out.obligations.ap, ...out.obligations.tax].reduce((n: number, a: any) => n + a.cents, 0);
        if (oblig > 0) hechos.push(`Obligaciones registradas (proveedores + impuestos): ${money0(oblig)}.`);
        if (out.cash && oblig > out.cash.totalCents) alertas.push("Las obligaciones registradas superan el efectivo disponible — hay presión de caja.");
      }
      if (acciones.length < 3 && out.ar?.buckets?.["90+"]?.cents > 0) {
        acciones.push(`Decidir qué hacer con los ${money0(out.ar.buckets["90+"].cents)} con más de 90 días (cobrar, negociar o llevar a Decision Inbox).`);
      }
      out.summary = { hechos, alertas, acciones: acciones.slice(0, 3) };

      await execAudit(ctx.user.email ?? "executive", "view", `cfoOverview ${period}`);
      return out;
    }),

  /* ============== IMPUESTOS — VISTA APROXIMADA (Sofia, Sep 11) ============== */

  /**
   * Tax picture: GST owed per the books (FACT from QB liability accounts) and
   * an ESTIMATE of corporate income tax on YTD accounting profit using
   * published Alberta CCPC rates (11% small-business up to $500K, ~23% above).
   * Clearly labeled estimate — accounting profit ≠ taxable income (CCA etc.);
   * the accountant has the final word. Nothing here files or pays anything.
   */
  taxEstimate: executiveProcedure.query(async ({ ctx }) => {
    const conn = await getQbConnection().catch(() => null);
    if (!conn) return { connected: false as const };
    const today = calgaryToday();
    const yearStart = today.slice(0, 4) + "-01-01";
    const out: any = { connected: true as const, asOf: today, errors: [] as string[] };

    // FACT: GST / tax liability accounts as booked in QB.
    try {
      const res = await qbQuery<any>(
        "SELECT Name, AccountType, CurrentBalance FROM Account WHERE Active = true MAXRESULTS 1000",
      );
      const gst = (res?.QueryResponse?.Account ?? []).filter(
        (a: any) => a.AccountType === "Other Current Liability" && /gst|hst/i.test(a.Name),
      );
      out.gstAccounts = gst.map((a: any) => ({ name: a.Name, cents: Math.round((a.CurrentBalance ?? 0) * 100) }));
      out.gstCents = out.gstAccounts.reduce((n: number, a: any) => n + a.cents, 0);
    } catch (err) {
      out.errors.push("GST: " + String(err).slice(0, 120));
    }

    // FACT: YTD P&L → net accounting profit so far.
    try {
      const rep = await qbGet<any>(`reports/ProfitAndLoss?start_date=${yearStart}&end_date=${today}`);
      let income: number | null = null, expenses: number | null = null, cogs = 0;
      const walk = (rows: any[]) => {
        for (const r of rows ?? []) {
          const cols = r.Summary?.ColData ?? [];
          if (cols[0]?.value === "Total Income" || cols[0]?.value === "Total Revenue") income = Number(cols[1]?.value);
          if (cols[0]?.value === "Total Expenses") expenses = Number(cols[1]?.value);
          if (cols[0]?.value === "Total Cost of Goods Sold") cogs = Number(cols[1]?.value) || 0;
          if (r.Rows?.Row) walk(r.Rows.Row);
        }
      };
      walk(rep?.Rows?.Row ?? []);
      if (income != null && expenses != null) {
        const netYtdCents = Math.round((income - cogs - expenses) * 100);
        out.netYtdCents = netYtdCents;
        // ESTIMATE: Alberta CCPC — 11% (9% fed + 2% AB) up to the $500K
        // small-business limit; ~23% (15% + 8%) on the excess.
        const LIMIT = 500_000_00;
        const est = (net: number) =>
          net <= 0 ? 0 : Math.round(Math.min(net, LIMIT) * 0.11 + Math.max(0, net - LIMIT) * 0.23);
        out.taxYtdCents = est(netYtdCents);
        const doy = Math.max(
          1,
          Math.floor((new Date(today + "T00:00:00").getTime() - new Date(yearStart + "T00:00:00").getTime()) / 86400000) + 1,
        );
        const annualizedNetCents = Math.round((netYtdCents / doy) * 365);
        out.projection = {
          dayOfYear: doy,
          annualizedNetCents,
          taxFullYearCents: est(annualizedNetCents),
        };
        out.rates = { small: 0.11, general: 0.23, limitCents: LIMIT };
      } else {
        out.errors.push("P&L YTD incompleto — no se estima nada.");
      }
    } catch (err) {
      out.errors.push("P&L: " + String(err).slice(0, 120));
    }

    await execAudit(ctx.user.email ?? "executive", "view", "taxEstimate");
    return out;
  }),

  /* ============== COMPARATIVA DE TRABAJOS AÑO VS AÑO (Sofia, Sep 11) ============== */

  /**
   * Jobs this year vs last year, overall, per month and per client — from the
   * full Airtable job history (cancelled / permit-declined excluded).
   * "Same period" = Jan 1 up to today's month+day, both years.
   */
  jobsCompare: executiveProcedure.query(async ({ ctx }) => {
    const today = calgaryToday();
    const curYear = today.slice(0, 4);
    const prevYear = String(Number(curYear) - 1);
    const cutoff = today.slice(4); // "-MM-DD"

    const { fetchAllJobsForDetection } = await import("../airtable");
    const all = (await fetchAllJobsForDetection()) as any[];
    const jobs = all.filter((j) => {
      const st = (j.status ?? "").toLowerCase();
      if (/cancel|permit declined/.test(st)) return false;
      return Boolean(j.startDate);
    });

    const inYtd = (d: string, year: string) => d.startsWith(year) && d.slice(4) <= cutoff;
    const byMonth: Record<string, { cur: number; prev: number }> = {};
    for (let m = 1; m <= 12; m++) byMonth[String(m).padStart(2, "0")] = { cur: 0, prev: 0 };
    const byClient = new Map<string, { curYtd: number; prevYtd: number; prevFull: number }>();
    let curYtdTotal = 0;
    let prevYtdTotal = 0;
    let prevFullTotal = 0;
    let earliest = "9999";

    for (const j of jobs) {
      const d = String(j.startDate).slice(0, 10);
      if (d < earliest) earliest = d;
      const month = d.slice(5, 7);
      const client = (j.company ?? "(sin cliente)").trim() || "(sin cliente)";
      const rec = byClient.get(client) ?? { curYtd: 0, prevYtd: 0, prevFull: 0 };
      if (d.startsWith(curYear)) {
        byMonth[month].cur++;
        if (inYtd(d, curYear)) { curYtdTotal++; rec.curYtd++; }
      } else if (d.startsWith(prevYear)) {
        byMonth[month].prev++;
        prevFullTotal++;
        rec.prevFull++;
        if (inYtd(d, prevYear)) { prevYtdTotal++; rec.prevYtd++; }
      }
      byClient.set(client, rec);
    }

    const clients = Array.from(byClient.entries())
      .map(([name, v]) => ({ name, ...v, delta: v.curYtd - v.prevYtd }))
      .filter((c) => c.curYtd > 0 || c.prevYtd > 0);
    const top = [...clients].sort((a, b) => b.curYtd - a.curYtd || b.prevYtd - a.prevYtd).slice(0, 15);
    const lost = clients
      .filter((c) => c.curYtd === 0 && c.prevYtd >= 3)
      .sort((a, b) => b.prevYtd - a.prevYtd)
      .slice(0, 10);
    const nuevos = clients
      .filter((c) => c.prevFull === 0 && c.curYtd >= 1)
      .sort((a, b) => b.curYtd - a.curYtd)
      .slice(0, 10);

    await execAudit(ctx.user.email ?? "executive", "view", "jobsCompare");
    return {
      curYear,
      prevYear,
      asOf: today,
      coverageFrom: earliest,
      ytd: {
        cur: curYtdTotal,
        prev: prevYtdTotal,
        deltaPct: prevYtdTotal ? Math.round(((curYtdTotal - prevYtdTotal) / prevYtdTotal) * 100) : null,
      },
      prevFullTotal,
      months: Object.entries(byMonth).map(([m, v]) => ({
        month: m,
        cur: v.cur,
        prev: v.prev,
        future: Number(m) > Number(today.slice(5, 7)),
        partial: m === today.slice(5, 7),
      })),
      topClients: top,
      lostClients: lost,
      newClients: nuevos,
      activeClientsCur: clients.filter((c) => c.curYtd > 0).length,
      activeClientsPrev: clients.filter((c) => c.prevYtd > 0).length,
    };
  }),

  /* ========================= F2 — CEO / CASHFLOW / CMO ========================= */

  /**
   * CEO view: real monthly P&L trend (QB), operations pulse (Airtable + app),
   * and a written summary composed ONLY from those observed figures.
   */
  ceo: executiveProcedure.query(async ({ ctx }) => {
    const conn = await getQbConnection().catch(() => null);
    const today = calgaryToday();
    const out: any = { qbConnected: Boolean(conn), errors: [] as string[], months: [] };

    if (conn) {
      try {
        // Last 6 calendar months, one report call summarized by month.
        const start = (() => {
          const d0 = new Date(today.slice(0, 7) + "-01T00:00:00");
          d0.setMonth(d0.getMonth() - 5);
          return d0.toISOString().slice(0, 10);
        })();
        const rep = await qbGet<any>(
          `reports/ProfitAndLoss?start_date=${start}&end_date=${today}&summarize_column_by=Month`,
        );
        const columns: string[] = (rep?.Columns?.Column ?? []).map((c: any) => c.ColTitle ?? "");
        const rowFor = (labels: string[]): number[] | null => {
          let found: number[] | null = null;
          const walk = (rows: any[]) => {
            for (const r of rows ?? []) {
              const cols = r.Summary?.ColData ?? [];
              if (labels.includes(cols[0]?.value)) {
                found = cols.slice(1).map((c: any) => {
                  const n = Number(c.value);
                  return Number.isNaN(n) ? 0 : n;
                });
              }
              if (r.Rows?.Row) walk(r.Rows.Row);
            }
          };
          walk(rep?.Rows?.Row ?? []);
          return found;
        };
        const income = rowFor(["Total Income", "Total Revenue"]);
        const expenses = rowFor(["Total Expenses"]);
        // Column layout: [label, month1..monthN, Total] — drop the trailing Total.
        const monthTitles = columns.slice(1).filter((t) => !/total/i.test(t));
        out.months = monthTitles.map((title, i) => ({
          title,
          incomeCents: income ? Math.round((income[i] ?? 0) * 100) : null,
          expensesCents: expenses ? Math.round((expenses[i] ?? 0) * 100) : null,
          netCents:
            income && expenses
              ? Math.round(((income[i] ?? 0) - (expenses[i] ?? 0)) * 100)
              : null,
        }));
      } catch (err) {
        out.errors.push("Tendencia mensual (QB): " + String(err).slice(0, 150));
      }
    }

    // Operations pulse — same sources the snapshot uses.
    const d = await db();
    const inv = await d.select().from(invoices);
    const live = inv.filter((r) => !r.deletedAt && r.status !== "quote" && r.status !== "void");
    const monthStart = today.slice(0, 7) + "-01";
    const thisMonth = live.filter((r) => r.issueDate >= monthStart);
    const quotes = inv.filter((r) => !r.deletedAt && r.status === "quote");
    out.ops = {
      invoicedThisMonthCents: thisMonth.reduce((n, r) => n + r.totalCents, 0),
      invoicedThisMonthCount: thisMonth.length,
      quotesCount: quotes.length,
      quotesCents: quotes.reduce((n, r) => n + r.totalCents, 0),
    };
    try {
      const { fetchAccountingJobs } = await import("../airtable");
      const jobs = (await fetchAccountingJobs()) as any[];
      const invByJob = new Set(live.filter((r) => r.airtableJobId).map((r) => r.airtableJobId));
      let unbilled = 0;
      for (const j of jobs) {
        const st = (j.status ?? "").toLowerCase();
        if ((/ready to bill/.test(st) || /picked/.test(st)) && !invByJob.has(j.id)) unbilled++;
      }
      out.ops.unbilledJobs = unbilled;
    } catch {
      out.ops.unbilledJobs = null;
    }

    // Jobs per month, this year vs same month last year (Airtable start dates;
    // its query window covers ~18 months, enough for a 6-month YoY strip).
    try {
      const { fetchAllJobsForDetection } = await import("../airtable");
      const all = await fetchAllJobsForDetection();
      const counts = new Map<string, number>();
      for (const j of all as any[]) {
        const k = (j.startDate ?? "").slice(0, 7);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const rows: any[] = [];
      for (let back = 5; back >= 0; back--) {
        const d0 = new Date(today.slice(0, 7) + "-01T00:00:00");
        d0.setMonth(d0.getMonth() - back);
        const key = d0.toISOString().slice(0, 7);
        const prevKey = String(Number(key.slice(0, 4)) - 1) + key.slice(4);
        rows.push({
          month: key,
          jobs: counts.get(key) ?? 0,
          jobsPrevYear: counts.get(prevKey) ?? null,
          partial: key === today.slice(0, 7),
        });
      }
      out.jobsYoY = { rows, dayOfMonth: Number(today.slice(8, 10)) };
    } catch (err) {
      out.errors.push("Trabajos año vs año (Airtable): " + String(err).slice(0, 150));
    }

    // Written summary — every sentence traces to a figure above.
    const s: string[] = [];
    const m = out.months.filter((x: any) => x.netCents != null);
    if (m.length >= 2) {
      const last = m[m.length - 1];
      const prev = m[m.length - 2];
      const fmt = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-CA");
      // A partial month (QB titles it "Sep. 1-6, 2026") must not be compared
      // in % against a full month — that reads as a collapse that isn't real.
      const isPartial = /\d+\s*-\s*\d+/.test(last.title);
      if (isPartial) {
        s.push(`${last.title} va en ${fmt(last.incomeCents)} de ingresos (mes en curso; ${prev.title} cerró en ${fmt(prev.incomeCents)}).`);
      } else {
        s.push(
          `Ingresos de ${last.title}: ${fmt(last.incomeCents)} (mes anterior ${fmt(prev.incomeCents)}${
            prev.incomeCents > 0
              ? `, ${last.incomeCents >= prev.incomeCents ? "+" : ""}${Math.round(((last.incomeCents - prev.incomeCents) / prev.incomeCents) * 100)}%`
              : ""
          }).`,
        );
      }
      s.push(`Resultado neto de ${last.title}: ${fmt(last.netCents)} — fuente: P&L de QuickBooks.`);
      const fullPrev = m.filter((x: any) => !/\d+\s*-\s*\d+/.test(x.title));
      if (fullPrev.length >= 2) {
        const a = fullPrev[fullPrev.length - 2];
        const b = fullPrev[fullPrev.length - 1];
        if (a.incomeCents > 0 && b.incomeCents >= a.incomeCents) {
          s.push(`Tendencia: ${b.title} creció ${Math.round(((b.incomeCents - a.incomeCents) / a.incomeCents) * 100)}% sobre ${a.title}.`);
        }
      }
    }
    if (out.ops.unbilledJobs != null && out.ops.unbilledJobs > 0) {
      s.push(`Hay ${out.ops.unbilledJobs} trabajos completados sin factura — dinero en la mesa (ver Unbilled).`);
    }
    if (out.ops.quotesCount > 0) {
      s.push(`Pipeline de cotizaciones: ${out.ops.quotesCount} quotes por ${"$" + Math.round(out.ops.quotesCents / 100).toLocaleString("en-CA")}.`);
    }
    out.summary = s;
    out.profitability = {
      available: false,
      reason:
        "Datos de costos insuficientes: no hay costos por trabajo (salarios/combustible/equipo por proyecto) en ninguna fuente conectada. No se muestran márgenes estimados.",
    };

    await execAudit(ctx.user.email ?? "executive", "view", "ceo");
    return out;
  }),

  /**
   * Income attributed to the month the WORK happened, not the invoice date.
   * Sofia's problem: invoices often go out 1+ month after the job, so P&L by
   * invoice date misstates each month. Work date per QB invoice comes from
   * (in order): the earliest ServiceDate on its lines; the linked Airtable
   * job's end date (matched app invoice via DocNumber); otherwise the income
   * stays in its invoice month but is counted separately as "sin fecha de
   * trabajo" — attribution coverage is reported, never glossed over.
   */
  earnedIncome: executiveProcedure.query(async ({ ctx }) => {
    const conn = await getQbConnection().catch(() => null);
    if (!conn) return { connected: false as const };
    const today = calgaryToday();
    const out: any = { connected: true as const, errors: [] as string[] };

    // App invoice → Airtable job end-date map (100% of app invoices link a job).
    const jobEndByQbNumber = new Map<string, string>();
    const jobEndByInvoiceNumber = new Map<string, string>();
    try {
      const d = await db();
      const appInv = await d.select().from(invoices);
      const { fetchAccountingJobs } = await import("../airtable");
      const jobs = (await fetchAccountingJobs()) as any[];
      const endByJob = new Map<string, string>();
      for (const j of jobs) {
        if (j.id && j.endDate) endByJob.set(j.id, String(j.endDate).slice(0, 10));
      }
      for (const r of appInv) {
        if (r.deletedAt || !r.airtableJobId) continue;
        const end = endByJob.get(r.airtableJobId);
        if (!end) continue;
        if (r.qbNumber) jobEndByQbNumber.set(String(r.qbNumber), end);
        jobEndByInvoiceNumber.set(r.invoiceNumber, end);
      }
    } catch (err) {
      out.errors.push("Fechas de proyecto (Airtable): " + String(err).slice(0, 150));
    }

    try {
      // Full entities (SELECT *) so each invoice carries its Line ServiceDates.
      const res = await qbQuery<any>("SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 1000");
      const invs = (res?.QueryResponse?.Invoice ?? []) as any[];
      out.window = invs.length
        ? { from: invs[invs.length - 1].TxnDate, to: invs[0].TxnDate, count: invs.length, capped: invs.length === 1000 }
        : null;

      type MonthAgg = { earnedCents: number; unattributedCents: number };
      const byMonth = new Map<string, MonthAgg>();
      const agg = (key: string) => {
        let m = byMonth.get(key);
        if (!m) byMonth.set(key, (m = { earnedCents: 0, unattributedCents: 0 }));
        return m;
      };
      let attributedCents = 0;
      let totalCents = 0;
      for (const i of invs) {
        const cents = Math.round((i.TotalAmt ?? 0) * 100);
        totalCents += cents;
        let work: string | null = null;
        for (const l of i.Line ?? []) {
          const sd = l.SalesItemLineDetail?.ServiceDate;
          if (sd && (!work || sd < work)) work = sd;
        }
        if (!work && i.DocNumber) work = jobEndByQbNumber.get(String(i.DocNumber)) ?? null;
        if (work) {
          agg(work.slice(0, 7)).earnedCents += cents;
          attributedCents += cents;
        } else {
          agg((i.TxnDate ?? today).slice(0, 7)).unattributedCents += cents;
        }
      }
      out.coverage = totalCents ? attributedCents / totalCents : 0;

      // Monthly expenses from the real P&L (expenses land close to their month).
      const first = Array.from(byMonth.keys()).sort()[0];
      const start = (first ?? today.slice(0, 7)) + "-01";
      const rep = await qbGet<any>(
        `reports/ProfitAndLoss?start_date=${start}&end_date=${today}&summarize_column_by=Month`,
      );
      const columns: string[] = (rep?.Columns?.Column ?? []).map((c: any) => c.ColTitle ?? "");
      let expensesRow: number[] | null = null;
      const walk = (rows: any[]) => {
        for (const r of rows ?? []) {
          const cols = r.Summary?.ColData ?? [];
          if (cols[0]?.value === "Total Expenses") {
            expensesRow = cols.slice(1).map((c: any) => Number(c.value) || 0);
          }
          if (r.Rows?.Row) walk(r.Rows.Row);
        }
      };
      walk(rep?.Rows?.Row ?? []);
      // Map QB's column titles ("Apr. 2026", "Sep. 1-6, 2026") to YYYY-MM keys.
      const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const expByMonth = new Map<string, number>();
      columns.slice(1).forEach((title, idx) => {
        if (/total/i.test(title)) return;
        const m = title.toLowerCase().match(/([a-z]{3})[^\d]*(\d{4})/);
        if (m && MONTHS[m[1]] && expensesRow) {
          expByMonth.set(`${m[2]}-${MONTHS[m[1]]}`, Math.round((expensesRow[idx] ?? 0) * 100));
        }
      });

      const keys = Array.from(new Set([...Array.from(byMonth.keys()), ...Array.from(expByMonth.keys())])).sort();
      out.months = keys.map((key) => {
        const m = byMonth.get(key) ?? { earnedCents: 0, unattributedCents: 0 };
        const exp = expByMonth.get(key) ?? null;
        return {
          month: key,
          earnedCents: m.earnedCents,
          unattributedCents: m.unattributedCents,
          expensesCents: exp,
          netCents: exp != null ? m.earnedCents + m.unattributedCents - exp : null,
          netAttributedCents: exp != null ? m.earnedCents - exp : null,
        };
      });
    } catch (err) {
      out.errors.push("Ingreso por mes de trabajo: " + String(err).slice(0, 200));
    }

    await execAudit(ctx.user.email ?? "executive", "view", "earnedIncome");
    return out;
  }),

  /**
   * 13-week cash view. Inflows = REAL due dates of open QB invoices.
   * The expense reference is the actual weekly average of the last 12 weeks
   * from QB's P&L — labeled as a reference, never presented as a forecast fact.
   */
  cashflow13: executiveProcedure.query(async ({ ctx }) => {
    const conn = await getQbConnection().catch(() => null);
    if (!conn) return { connected: false as const };
    const today = calgaryToday();
    const t0 = new Date(today + "T00:00:00").getTime();
    const out: any = { connected: true as const, errors: [] as string[] };

    try {
      const res = await qbQuery<any>("SELECT Name, CurrentBalance FROM Account WHERE AccountType = 'Bank'");
      out.cashCents = Math.round(
        (res?.QueryResponse?.Account ?? []).reduce((n: number, a: any) => n + (a.CurrentBalance ?? 0), 0) * 100,
      );
    } catch (err) {
      out.errors.push("Bancos: " + String(err).slice(0, 150));
    }

    try {
      const res = await qbQuery<any>(
        "SELECT Balance, DueDate, TxnDate FROM Invoice WHERE Balance > '0' MAXRESULTS 1000",
      );
      const weeks: { inflowCents: number }[] = Array.from({ length: 13 }, () => ({ inflowCents: 0 }));
      let overdueCents = 0;
      for (const i of res?.QueryResponse?.Invoice ?? []) {
        const cents = Math.round((i.Balance ?? 0) * 100);
        const ref = i.DueDate ?? i.TxnDate;
        const days = ref ? Math.floor((new Date(ref + "T00:00:00").getTime() - t0) / 86400000) : 0;
        if (days < 0) overdueCents += cents;
        else {
          const w = Math.min(Math.floor(days / 7), 12);
          weeks[w].inflowCents += cents;
        }
      }
      out.overdueCents = overdueCents;
      out.weeks = weeks.map((w, idx) => {
        const startD = new Date(t0 + idx * 7 * 86400000);
        return { start: startD.toISOString().slice(0, 10), inflowCents: w.inflowCents };
      });
    } catch (err) {
      out.errors.push("Vencimientos AR: " + String(err).slice(0, 150));
    }

    try {
      const start = new Date(t0 - 84 * 86400000).toISOString().slice(0, 10);
      const rep = await qbGet<any>(`reports/ProfitAndLoss?start_date=${start}&end_date=${today}`);
      let expenses: number | null = null;
      const walk = (rows: any[]) => {
        for (const r of rows ?? []) {
          const cols = r.Summary?.ColData ?? [];
          if (cols[0]?.value === "Total Expenses" && cols[1]?.value != null) expenses = Number(cols[1].value);
          if (r.Rows?.Row) walk(r.Rows.Row);
        }
      };
      walk(rep?.Rows?.Row ?? []);
      out.avgWeeklyExpenseCents = expenses != null ? Math.round(((expenses as number) / 12) * 100) : null;
    } catch (err) {
      out.errors.push("Promedio de gastos: " + String(err).slice(0, 150));
    }

    await execAudit(ctx.user.email ?? "executive", "view", "cashflow13");
    return out;
  }),

  /**
   * CMO view: who the revenue actually comes from. All from QB invoice history
   * (up to the API's 1000-row page — the covered window is reported).
   */
  cmo: executiveProcedure.query(async ({ ctx }) => {
    const conn = await getQbConnection().catch(() => null);
    if (!conn) return { connected: false as const };
    const today = calgaryToday();
    const out: any = { connected: true as const, errors: [] as string[] };

    try {
      const res = await qbQuery<any>(
        "SELECT TotalAmt, TxnDate, CustomerRef FROM Invoice ORDERBY TxnDate DESC MAXRESULTS 1000",
      );
      const invs = (res?.QueryResponse?.Invoice ?? []) as any[];
      out.window = invs.length
        ? { from: invs[invs.length - 1].TxnDate, to: invs[0].TxnDate, count: invs.length, capped: invs.length === 1000 }
        : null;

      const yearStart = today.slice(0, 4) + "-01-01";
      const byCustomer = new Map<string, number>();
      const firstSeen = new Map<string, string>();
      for (const i of invs) {
        const name = i.CustomerRef?.name ?? "(sin cliente)";
        const dte = i.TxnDate ?? "";
        if (!firstSeen.has(name) || dte < firstSeen.get(name)!) firstSeen.set(name, dte);
        if (dte >= yearStart) {
          byCustomer.set(name, (byCustomer.get(name) ?? 0) + Math.round((i.TotalAmt ?? 0) * 100));
        }
      }
      const totalYear = Array.from(byCustomer.values()).reduce((a, b) => a + b, 0);
      const top = Array.from(byCustomer.entries())
        .map(([name, cents]) => ({ name, cents, share: totalYear ? cents / totalYear : 0 }))
        .sort((a, b) => b.cents - a.cents);
      out.year = {
        from: yearStart,
        totalCents: totalYear,
        customers: byCustomer.size,
        top: top.slice(0, 10),
        top3Share: top.slice(0, 3).reduce((n, c) => n + c.share, 0),
      };

      // New customers per month (first invoice ever inside that month), last 6 months.
      const months: { title: string; newCustomers: number }[] = [];
      for (let k = 5; k >= 0; k--) {
        const d0 = new Date(today.slice(0, 7) + "-01T00:00:00");
        d0.setMonth(d0.getMonth() - k);
        const key = d0.toISOString().slice(0, 7);
        let n = 0;
        firstSeen.forEach((first) => {
          if (first.slice(0, 7) === key) n++;
        });
        months.push({ title: key, newCustomers: n });
      }
      out.newByMonth = months;
      if (out.window?.capped) {
        out.errors.push(
          "El historial cubre las últimas 1000 facturas — clientes más antiguos que esa ventana pueden contarse como 'nuevos'.",
        );
      }
    } catch (err) {
      out.errors.push("Clientes (QB): " + String(err).slice(0, 150));
    }

    await execAudit(ctx.user.email ?? "executive", "view", "cmo");
    return out;
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
