import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getSetting, setSetting } from "../opsDb";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
import { invoices, invoiceItems } from "../../drizzle/schema";
import { fetchAccountingJobs } from "../airtable";

// ---- Accounting lock: a second PIN on top of the coordinator session ----
const ACCT_COOKIE = "fts_acct";
const ACCT_PIN_KEY = "accounting_pin";
const DEFAULT_ACCT_PIN = "8642";
const UNLOCK_HOURS = 8;

function acctToken(userId: string | number): string {
  const secret = process.env.JWT_SECRET || "fts-accounting-gate";
  return crypto
    .createHmac("sha256", secret)
    .update(`acct:${userId}`)
    .digest("hex");
}

function isUnlocked(ctx: { req: any; user: { id: string | number } }): boolean {
  const raw = ctx.req?.headers?.cookie as string | undefined;
  if (!raw) return false;
  const tok = parseCookieHeader(raw)[ACCT_COOKIE];
  return !!tok && tok === acctToken(ctx.user.id);
}

/** Current accounting PIN; seeds the default the first time it is read. */
async function getAccountingPin(): Promise<string> {
  const pin = await getSetting(ACCT_PIN_KEY);
  if (pin) return pin;
  await setSetting(ACCT_PIN_KEY, DEFAULT_ACCT_PIN);
  return DEFAULT_ACCT_PIN;
}

/** adminProcedure + the accounting PIN cookie — all data procs use this. */
const accountingProcedure = adminProcedure.use(async ({ ctx, next }) => {
  if (!isUnlocked(ctx as any)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Accounting is locked — enter the accounting PIN.",
    });
  }
  return next();
});

const itemInput = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  // Negative = discount line (e.g. "Signs rental discount (25%)").
  unitCents: z.number().int(),
});

function computeTotals(items: { quantity: number; unitCents: number }[], gstRate: number) {
  const subtotalCents = items.reduce(
    (n, it) => n + Math.round(it.quantity * it.unitCents),
    0,
  );
  const gstCents = Math.round((subtotalCents * gstRate) / 100);
  return { subtotalCents, gstCents, totalCents: subtotalCents + gstCents };
}

export const accountingRouter = router({
  /** Is the accounting section unlocked for this session? */
  lockStatus: adminProcedure.query(async ({ ctx }) => {
    return { unlocked: isUnlocked(ctx as any) };
  }),

  /** Validate the accounting PIN and unlock for a few hours. */
  unlock: adminProcedure
    .input(z.object({ pin: z.string().regex(/^\d{4,8}$/) }))
    .mutation(async ({ ctx, input }) => {
      const expected = await getAccountingPin();
      if (input.pin !== expected) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Wrong accounting PIN." });
      }
      (ctx as any).res.cookie(ACCT_COOKIE, acctToken(ctx.user.id), {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: UNLOCK_HOURS * 3600 * 1000,
      });
      return { ok: true as const };
    }),

  /** Lock the section again (clears the unlock cookie). */
  lock: adminProcedure.mutation(async ({ ctx }) => {
    (ctx as any).res.clearCookie(ACCT_COOKIE, { path: "/" });
    return { ok: true as const };
  }),

  /** Change the accounting PIN (requires the section to be unlocked). */
  setAccountingPin: accountingProcedure
    .input(z.object({ pin: z.string().regex(/^\d{4,8}$/) }))
    .mutation(async ({ input }) => {
      await setSetting(ACCT_PIN_KEY, input.pin);
      return { ok: true as const };
    }),

  /** Airtable billing info per project — READ-ONLY (app never writes to Airtable). */
  airtableAccounting: accountingProcedure.query(async () => {
    return fetchAccountingJobs();
  }),

  /** Airtable jobs with status "Billed" — the estimator's training corpus. */
  airtableBilled: accountingProcedure.query(async () => {
    const { fetchBilledJobs } = await import("../airtable");
    return fetchBilledJobs();
  }),

  /**
   * Auto-quote a project from the FTS pricing rules (Reglas de Cobro v3.0)
   * using the job's Airtable data: client tier, sign count, setup type, days,
   * stamp, parking ban, stockpile, boards and city permit pass-through.
   */
  suggestQuote: accountingProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const [
        { fetchJobById, fetchJobRawFields },
        { buildQuote, parseEquipment, parseSubmissionType },
        { isPermitPulledByFts },
      ] = await Promise.all([
        import("../airtable"),
        import("../../shared/pricingRules"),
        import("../../shared/permitSchedule"),
      ]);
      const job = await fetchJobById(input.jobId);
      const raw = await fetchJobRawFields(input.jobId);
      const rawMap = new Map(raw.map((f) => [f.name.toLowerCase(), f.value]));
      const rawGet = (name: string) => rawMap.get(name.toLowerCase()) ?? null;

      const equipment = parseEquipment(job.signsCount ?? null);
      const signs = equipment.totalSigns;

      // Days: Airtable "Number of Days" first, else inclusive date span.
      let days = Number(rawGet("Number of Days")) || 0;
      if (!days && job.startDate && job.endDate) {
        const s = new Date(job.startDate.slice(0, 10) + "T00:00:00");
        const e = new Date(job.endDate.slice(0, 10) + "T00:00:00");
        days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
      }
      if (!days) days = 1;

      const start = job.startDate
        ? new Date(job.startDate.slice(0, 10) + "T00:00:00")
        : null;
      const weekendStart = !!start && (start.getDay() === 0 || start.getDay() === 6);

      const files = (job.planFile ?? []) as { filename?: string | null }[];
      // Only FTS-made plans (FTS-* / Stamped filenames) are billable. If the
      // attachments have no FTS plan, the plan was provided BY THE CLIENT —
      // no TMP/stamp charge (Sofia's rule).
      const { pickPlans: pickFtsPlans } = await import("../../shared/planDocs");
      const ftsPlans = pickFtsPlans(files);
      const hasStamp = ftsPlans.some((f) => /stamp/i.test(f.filename ?? ""));
      const hasPlan = ftsPlans.length > 0;
      // Distinct stamped plans, labeled by their FTS code — one stamp charge
      // each. Revisions dedupe by code (e.g. "…2603-21…_C (1)" vs "…2603-21").
      const stampCodes = Array.from(
        new Set(
          ftsPlans
            .filter((f) => /stamp/i.test(f.filename ?? ""))
            .map(
              (f) =>
                (f.filename ?? "").match(/FTS-\d{2}-\d{3,}(?:-\d+)*/i)?.[0] ??
                (f.filename ?? "").replace(/\.pdf$/i, "").slice(0, 40),
            ),
        ),
      );

      const affirmative = (v: string | null) =>
        !!v && !/^(no|none|n\/a|-)$/i.test(v.trim());
      const parkingBan = affirmative(rawGet("Parking Ban"));
      const stockpile = affirmative(rawGet("Stockpile"));

      const num = (v: string | null) => {
        const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
        return Number.isFinite(n) ? n : 0;
      };
      const arrowBoards = Math.max(equipment.arrowBoards, num(rawGet("Arrow Boards")));
      const messageBoards = Math.max(
        equipment.messageBoards,
        num(rawGet("Message Boards")),
      );

      // Street Use Permit costs: the field lists one or more amounts, e.g.
      // "($221.05) (July 15-16) ($173.52) (July 20-22)". Each permit becomes
      // its OWN line, paired in order with the cached SU permit extractions
      // (SU code + valid dates).
      const pc = rawGet("Permit Cost");
      let permitCostCents: number | null = null;
      const costEntries: { cents: number; dateText: string | null }[] = [];
      if (pc) {
        // Walk tokens in order: every $ amount starts a permit entry; a
        // following parenthesized text (without $) is that permit's dates.
        const tokens = pc.match(/\(([^)]*)\)|\$\s*[\d,]+(?:\.\d{1,2})?/g) ?? [];
        for (const tok of tokens) {
          const inner = tok.startsWith("(") ? tok.slice(1, -1).trim() : tok.trim();
          const amt = inner.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
          if (amt) {
            costEntries.push({
              cents: Math.round(Number(amt[1].replace(/,/g, "")) * 100),
              dateText: null,
            });
          } else if (
            inner &&
            costEntries.length > 0 &&
            !costEntries[costEntries.length - 1].dateText
          ) {
            costEntries[costEntries.length - 1].dateText = inner;
          }
        }
        if (costEntries.length === 0) {
          const n = Number(pc.replace(/[$,\s]/g, ""));
          if (Number.isFinite(n) && n > 0) permitCostCents = Math.round(n * 100);
        }
      }

      // Cached SU permit schedules for this job (code + valid dates), in order.
      const { getPermitExtractionsMap } = await import("../opsDb");
      const readSuPermits = async () => {
        const extRows =
          (await getPermitExtractionsMap([input.jobId])).get(input.jobId) ?? [];
        return extRows
          .filter(
            (r: any) => r.parseStatus === "ok" && !String(r.filename).startsWith("plan:"),
          )
          .map((r: any) => ({
            code:
              r.permitNumber ??
              (String(r.filename).match(/SU-?\d{2}-?\d+/i)?.[0] ?? null),
            from: r.validFromDate as string | null,
            to: r.validToDate as string | null,
            onBehalfOf: (r.onBehalfOf as string | null) ?? null,
          }))
          .sort((a: any, b: any) => (a.from ?? "9999").localeCompare(b.from ?? "9999"));
      };
      let suPermits = await readSuPermits();
      if (suPermits.length === 0 && costEntries.length > 0) {
        // Ready-to-bill jobs never went through the map's permit warm-up —
        // extract this job's SU permits on demand (cached afterwards).
        const { getPermitSchedulesForJobs } = await import("../permitExtraction");
        await getPermitSchedulesForJobs([
          { id: input.jobId, planFile: (job.planFile ?? []) as any },
        ]).catch(() => null);
        suPermits = await readSuPermits();
      }

      const fmtShort = (iso: string | null) => {
        if (!iso) return null;
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-CA", {
          month: "short",
          day: "numeric",
        });
      };
      const clientPulledPermits: string[] = [];
      const permitLines = costEntries
        .map((e, i) => {
          const su = suPermits[i];
          // Sofia's rule: the permit's "On Behalf Of (Onsite – In the
          // right-of-way)" decides who pulled it. Fast Traffic → billable
          // pass-through; any other name → the client pulled (and pays) it —
          // keep it for reference only, never on the invoice.
          if (su && !isPermitPulledByFts(su.onBehalfOf)) {
            clientPulledPermits.push(
              `${su.code ?? "Street Use Permit"} (On Behalf Of: ${su.onBehalfOf})`,
            );
            return null;
          }
          const dates = su?.from
            ? `${fmtShort(su.from)}${su.to && su.to !== su.from ? ` – ${fmtShort(su.to)}` : ""}`
            : e.dateText;
          return {
            label: `Street Use Permit${su?.code ? ` ${su.code}` : ""}${dates ? ` — ${dates}` : ""}`,
            cents: e.cents,
          };
        })
        .filter((p): p is { label: string; cents: number } => p !== null);

      const planOnly = /plan\s*only/i.test(
        `${job.jobAddress ?? ""} ${job.projectTitle ?? ""} ${rawGet("Type of Submission") ?? ""} ${rawGet("Location") ?? ""}`,
      );
      const submissionRaw = rawGet("Type of Submission");
      const submissionType = parseSubmissionType(submissionRaw);

      const quote = buildQuote({
        company: job.company,
        planOnly,
        submissionType,
        equipment,
        signs,
        panelSigns: equipment.wmSigns + equipment.looseSigns,
        days,
        setupDuration: job.setupDuration,
        impact: job.impact,
        weekendStart,
        hasStamp,
        hasPlan,
        stampedPlans: stampCodes.length > 0 ? stampCodes : undefined,
        parkingBan,
        stockpile,
        arrowBoards,
        messageBoards,
        permitCostCents,
        permitLines: permitLines.length > 0 ? permitLines : undefined,
      });

      // Billable flagging logged by the coordinator (per person-hour) — one
      // line per rate so mixed regular/overtime hours stay separate.
      const { listFlaggingHoursForJob } = await import("../opsDb");
      const flagging = planOnly ? [] : await listFlaggingHoursForJob(input.jobId);
      if (flagging.length > 0) {
        const byRate = new Map<number, number>();
        for (const f of flagging) {
          const rate = f.hourlyRateCents ?? 4000;
          byRate.set(rate, (byRate.get(rate) ?? 0) + (f.hours ?? 0));
        }
        for (const [rate, hours] of Array.from(byRate.entries())) {
          if (hours <= 0) continue;
          quote.lines.push({
            description: `Flaggers — ${hours}h × $${(rate / 100).toFixed(2)}/h`,
            quantity: hours,
            unitCents: rate,
            section: "service",
          });
          quote.reasons.push(
            `Flagging logged in operations: ${hours}h × $${(rate / 100).toFixed(2)}/h = $${((hours * rate) / 100).toFixed(2)}`,
          );
        }
      }

      if (!hasPlan && files.length > 0) {
        quote.reasons.push(
          "Plan provided BY CLIENT (no FTS plan in the attachments) — TMP/stamp NOT charged",
        );
      }
      for (const p of clientPulledPermits) {
        quote.reasons.push(
          `Permit pulled BY THE CLIENT — not billed (reference only): ${p}`,
        );
      }

      return {
        ...quote,
        submissionType,
        submissionRaw,
        inputs: { signs, days, setupDuration: job.setupDuration, weekendStart, hasStamp, parkingBan, stockpile, arrowBoards, messageBoards },
      };
    }),

  /**
   * Operational results for a project, to verify the invoice against what the
   * field actually did: per-day technician assignments (with times and
   * completion), novedades (field notes) and billable flagging hours.
   */
  jobOperations: accountingProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const dbx = await db();
      const [{ jobAssignments }, ops] = await Promise.all([
        import("../../drizzle/schema"),
        import("../opsDb"),
      ]);
      const assignments = await dbx
        .select()
        .from(jobAssignments)
        .where(eq(jobAssignments.airtableJobId, input.jobId));
      assignments.sort((a, b) =>
        (a.scheduledDate ?? "9999").localeCompare(b.scheduledDate ?? "9999"),
      );
      const [notes, flagging] = await Promise.all([
        ops.listJobNotes(input.jobId),
        ops.listFlaggingHoursForJob(input.jobId),
      ]);
      const flaggingHoursTotal = flagging.reduce((n, f) => n + (f.hours ?? 0), 0);
      const flaggingAmountCents = flagging.reduce(
        (n, f) => n + Math.round((f.hours ?? 0) * (f.hourlyRateCents ?? 4000)),
        0,
      );
      return { assignments, notes, flagging, flaggingHoursTotal, flaggingAmountCents };
    }),

  /**
   * Cross-check the Airtable "Signs Count" field against the sign schedule
   * printed inside the TMP plan PDF. Cones are drawn as dots (not text), so
   * they come back as "drawn" — verify those visually on the plan.
   */
  verifySigns: accountingProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const [{ fetchJobById }, { verifySignsAgainstPlan }] = await Promise.all([
        import("../airtable"),
        import("../signVerification"),
      ]);
      const job = await fetchJobById(input.jobId);
      return verifySignsAgainstPlan(job.signsCount, job.planFile as any);
    }),

  listInvoices: accountingProcedure.query(async () => {
    const dbx = await db();
    const rows = await dbx.select().from(invoices).orderBy(desc(invoices.id));
    const items = await dbx.select().from(invoiceItems);
    const byInvoice = new Map<number, typeof items>();
    for (const it of items) {
      const arr = byInvoice.get(it.invoiceId) ?? [];
      arr.push(it);
      byInvoice.set(it.invoiceId, arr);
    }
    return rows.map((inv) => ({
      ...inv,
      items: (byInvoice.get(inv.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }),

  createInvoice: accountingProcedure
    .input(
      z.object({
        airtableJobId: z.string().nullable().optional(),
        clientName: z.string().min(1),
        jobAddress: z.string().nullable().optional(),
        issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        gstRate: z.number().min(0).max(30).default(5),
        notes: z.string().nullable().optional(),
        items: z.array(itemInput).min(1),
        /** Auto-quote snapshot for later rule tuning (what Claude suggested). */
        suggested: z
          .array(
            z.object({
              description: z.string(),
              quantity: z.number(),
              unitCents: z.number(),
            }),
          )
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const dbx = await db();
      // Next sequential number: FTS-INV-0001, 0002, ...
      const last = await dbx
        .select({ n: invoices.invoiceNumber })
        .from(invoices)
        .orderBy(desc(invoices.id))
        .limit(1);
      const lastNum = last[0]?.n?.match(/(\d+)$/)?.[1];
      const next = (lastNum ? Number(lastNum) : 0) + 1;
      const invoiceNumber = `FTS-INV-${String(next).padStart(4, "0")}`;

      const totals = computeTotals(input.items, input.gstRate);
      const [res] = await dbx.insert(invoices).values({
        invoiceNumber,
        airtableJobId: input.airtableJobId ?? null,
        clientName: input.clientName,
        jobAddress: input.jobAddress ?? null,
        issueDate: input.issueDate,
        dueDate: input.dueDate ?? null,
        status: "draft",
        gstRate: input.gstRate,
        notes: input.notes ?? null,
        suggestedJson: input.suggested ? JSON.stringify(input.suggested) : null,
        ...totals,
      });
      const invoiceId = (res as any).insertId as number;
      for (let i = 0; i < input.items.length; i++) {
        const it = input.items[i];
        await dbx.insert(invoiceItems).values({
          invoiceId,
          description: it.description,
          quantity: it.quantity,
          unitCents: it.unitCents,
          amountCents: Math.round(it.quantity * it.unitCents),
          sortOrder: i,
        });
      }
      return { id: invoiceId, invoiceNumber };
    }),

  /** Edit an existing invoice (fields + all line items). Paid/void are locked. */
  updateInvoice: accountingProcedure
    .input(
      z.object({
        id: z.number().int(),
        clientName: z.string().min(1),
        jobAddress: z.string().nullable().optional(),
        issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        gstRate: z.number().min(0).max(30).default(5),
        notes: z.string().nullable().optional(),
        items: z.array(itemInput).min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const dbx = await db();
      const [inv] = await dbx
        .select()
        .from(invoices)
        .where(eq(invoices.id, input.id))
        .limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      if (inv.status === "paid" || inv.status === "void" || inv.status === "in_qb") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${inv.status === "in_qb" ? "QuickBooks-posted" : inv.status} invoice can't be edited — change its status first.`,
        });
      }
      const totals = computeTotals(input.items, input.gstRate);
      await dbx
        .update(invoices)
        .set({
          clientName: input.clientName,
          jobAddress: input.jobAddress ?? null,
          issueDate: input.issueDate,
          dueDate: input.dueDate ?? null,
          gstRate: input.gstRate,
          notes: input.notes ?? null,
          ...totals,
        })
        .where(eq(invoices.id, input.id));
      await dbx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
      for (let i = 0; i < input.items.length; i++) {
        const it = input.items[i];
        await dbx.insert(invoiceItems).values({
          invoiceId: input.id,
          description: it.description,
          quantity: it.quantity,
          unitCents: it.unitCents,
          amountCents: Math.round(it.quantity * it.unitCents),
          sortOrder: i,
        });
      }
      return { ok: true as const, invoiceNumber: inv.invoiceNumber };
    }),

  /** Record the QuickBooks invoice number once posted there. */
  setQbNumber: accountingProcedure
    .input(z.object({ id: z.number().int(), qbNumber: z.string().trim().max(32).nullable() }))
    .mutation(async ({ input }) => {
      const dbx = await db();
      await dbx
        .update(invoices)
        .set({ qbNumber: input.qbNumber || null })
        .where(eq(invoices.id, input.id));
      return { ok: true as const };
    }),

  setInvoiceStatus: accountingProcedure
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(["draft", "sent", "paid", "void", "in_qb"]),
      }),
    )
    .mutation(async ({ input }) => {
      const dbx = await db();
      await dbx
        .update(invoices)
        .set({ status: input.status })
        .where(eq(invoices.id, input.id));
      return { ok: true };
    }),

  deleteInvoice: accountingProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const dbx = await db();
      const [inv] = await dbx
        .select()
        .from(invoices)
        .where(eq(invoices.id, input.id))
        .limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      // Only drafts can be deleted; sent/paid stay for the record (use void).
      if (inv.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only draft invoices can be deleted — mark it void instead.",
        });
      }
      await dbx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
      await dbx.delete(invoices).where(eq(invoices.id, input.id));
      return { ok: true };
    }),
});
