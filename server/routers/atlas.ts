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

    // Written summary — every sentence traces to a figure above.
    const s: string[] = [];
    const m = out.months.filter((x: any) => x.netCents != null);
    if (m.length >= 2) {
      const last = m[m.length - 1];
      const prev = m[m.length - 2];
      const fmt = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-CA");
      s.push(
        `Ingresos de ${last.title}: ${fmt(last.incomeCents)} (mes anterior ${fmt(prev.incomeCents)}${
          prev.incomeCents > 0
            ? `, ${last.incomeCents >= prev.incomeCents ? "+" : ""}${Math.round(((last.incomeCents - prev.incomeCents) / prev.incomeCents) * 100)}%`
            : ""
        }).`,
      );
      s.push(`Resultado neto de ${last.title}: ${fmt(last.netCents)} — fuente: P&L de QuickBooks.`);
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
