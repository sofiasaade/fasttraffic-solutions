import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  formSubmissions,
  InsertFormSubmission,
  InsertSafetyDefect,
  safetyDefects,
  startWorkAuthorizations,
  techDaySessions,
} from "../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

/* --------------------------- Form submissions --------------------------- */

/**
 * Insert an immutable form submission. Idempotent on clientUuid: submitting
 * the same offline draft twice returns the ORIGINAL row instead of a
 * duplicate.
 */
export async function insertFormSubmission(data: InsertFormSubmission) {
  const d = await db();
  const existing = await d
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.clientUuid, data.clientUuid))
    .limit(1);
  if (existing.length > 0) return { row: existing[0], duplicate: true };
  await d.insert(formSubmissions).values(data);
  const rows = await d
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.clientUuid, data.clientUuid))
    .limit(1);
  return { row: rows[0], duplicate: false };
}

export async function listSubmissionsForTech(
  technicianName: string,
  shiftDate?: string,
) {
  const d = await db();
  return d
    .select()
    .from(formSubmissions)
    .where(
      shiftDate
        ? and(
            eq(formSubmissions.technicianName, technicianName),
            eq(formSubmissions.shiftDate, shiftDate),
          )
        : eq(formSubmissions.technicianName, technicianName),
    )
    .orderBy(desc(formSubmissions.id))
    .limit(200);
}

export async function getSubmission(id: number) {
  const d = await db();
  const rows = await d
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Latest submission of a form for a tech on a date (ignoring returned ones). */
export async function latestSubmission(
  technicianName: string,
  shiftDate: string,
  formNumber: string,
) {
  const d = await db();
  const rows = await d
    .select()
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.technicianName, technicianName),
        eq(formSubmissions.shiftDate, shiftDate),
        eq(formSubmissions.formNumber, formNumber),
      ),
    )
    .orderBy(desc(formSubmissions.id))
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------- Defects ------------------------------- */

export async function nextDefectRef(): Promise<string> {
  const d = await db();
  const rows = await d.select({ n: sql<number>`count(*)` }).from(safetyDefects);
  return `CA-${String(Number(rows[0]?.n ?? 0) + 1).padStart(4, "0")}`;
}

export async function insertDefect(data: Omit<InsertSafetyDefect, "refNumber">) {
  const d = await db();
  const refNumber = await nextDefectRef();
  await d.insert(safetyDefects).values({ ...data, refNumber });
  return refNumber;
}

export async function listOpenDefectsForUnit(unitName: string) {
  const d = await db();
  return d
    .select()
    .from(safetyDefects)
    .where(
      and(eq(safetyDefects.unitName, unitName), eq(safetyDefects.status, "open")),
    );
}

export async function listDefects(status?: string) {
  const d = await db();
  return d
    .select()
    .from(safetyDefects)
    .where(status ? eq(safetyDefects.status, status) : undefined)
    .orderBy(desc(safetyDefects.id))
    .limit(300);
}

/** Authorized release of a defect (supervisor/coordinator only). */
export async function releaseDefect(
  id: number,
  by: string,
  actionTaken: string,
) {
  const d = await db();
  await d
    .update(safetyDefects)
    .set({ status: "released", releasedBy: by, releasedAt: new Date(), actionTaken })
    .where(eq(safetyDefects.id, id));
}

/* ------------------------- Day stages / start work ------------------------- */

export async function setDayStage(
  technicianName: string,
  date: string,
  stage: "departWarehouseAt" | "arriveSiteAt" | "returnWarehouseAt",
) {
  const d = await db();
  await d
    .update(techDaySessions)
    .set({ [stage]: new Date() } as any)
    .where(
      and(
        eq(techDaySessions.technicianName, technicianName),
        eq(techDaySessions.date, date),
      ),
    );
}

export async function getStartWorkAuth(
  technicianName: string,
  date: string,
  airtableJobId: string,
) {
  const d = await db();
  const rows = await d
    .select()
    .from(startWorkAuthorizations)
    .where(
      and(
        eq(startWorkAuthorizations.technicianName, technicianName),
        eq(startWorkAuthorizations.date, date),
        eq(startWorkAuthorizations.airtableJobId, airtableJobId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertStartWorkAuth(data: {
  airtableJobId: string;
  technicianName: string;
  date: string;
  snapshotJson: string;
}) {
  const d = await db();
  await d.insert(startWorkAuthorizations).values(data);
}

/** All submissions for a set of jobs (coordinator safety package view). */
export async function listSubmissionsForJobs(jobIds: string[]) {
  if (jobIds.length === 0) return [];
  const d = await db();
  return d
    .select()
    .from(formSubmissions)
    .where(inArray(formSubmissions.airtableJobId, jobIds))
    .orderBy(desc(formSubmissions.id));
}
