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
  unitCents: z.number().int().min(0),
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

  /**
   * Auto-quote a project from the FTS pricing rules (Reglas de Cobro v3.0)
   * using the job's Airtable data: client tier, sign count, setup type, days,
   * stamp, parking ban, stockpile, boards and city permit pass-through.
   */
  suggestQuote: accountingProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const [{ fetchJobById, fetchJobRawFields }, { buildQuote, parseEquipment }] =
        await Promise.all([
          import("../airtable"),
          import("../../shared/pricingRules"),
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
      const hasStamp = files.some((f) => /stamp/i.test(f.filename ?? ""));
      const hasPlan = files.length > 0;

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

      // Street Use Permit cost: the field often lists several amounts, e.g.
      // "($221.05) (July 15-16) ($173.52) (July 20-22)" — sum every $ amount.
      const pc = rawGet("Permit Cost");
      let permitCostCents: number | null = null;
      if (pc) {
        const amounts = pc.match(/\$\s*[\d,]+(?:\.\d{1,2})?/g);
        if (amounts?.length) {
          const total = amounts.reduce(
            (n, a) => n + Number(a.replace(/[$,\s]/g, "")),
            0,
          );
          if (total > 0) permitCostCents = Math.round(total * 100);
        } else {
          const n = Number(pc.replace(/[$,\s]/g, ""));
          if (Number.isFinite(n) && n > 0) permitCostCents = Math.round(n * 100);
        }
      }

      const quote = buildQuote({
        company: job.company,
        equipment,
        signs,
        days,
        setupDuration: job.setupDuration,
        weekendStart,
        hasStamp,
        hasPlan,
        parkingBan,
        stockpile,
        arrowBoards,
        messageBoards,
        permitCostCents,
      });

      return {
        ...quote,
        inputs: { signs, days, setupDuration: job.setupDuration, weekendStart, hasStamp, parkingBan, stockpile, arrowBoards, messageBoards },
      };
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

  setInvoiceStatus: accountingProcedure
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(["draft", "sent", "paid", "void"]),
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
