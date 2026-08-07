import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
import { invoices, invoiceItems } from "../../drizzle/schema";
import { fetchAccountingJobs } from "../airtable";

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
  /** Airtable billing info per project — READ-ONLY (app never writes to Airtable). */
  airtableAccounting: adminProcedure.query(async () => {
    return fetchAccountingJobs();
  }),

  listInvoices: adminProcedure.query(async () => {
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

  createInvoice: adminProcedure
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

  setInvoiceStatus: adminProcedure
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

  deleteInvoice: adminProcedure
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
