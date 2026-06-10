import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  appSettings,
  changeHistory,
  hazardAssessments,
  InsertChangeHistory,
  InsertHazardAssessment,
  InsertNotification,
  InsertTechnician,
  InsertTimeLog,
  notifications,
  technicians,
  timeLogs,
} from "../drizzle/schema";
import {
  ALBERTA_OT_THRESHOLD_DEFAULT,
  TECHNICIANS,
} from "../shared/airtableFields";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

/* ----------------------------- Technicians ----------------------------- */

export async function seedTechnicians() {
  const d = await db();
  for (const name of TECHNICIANS) {
    const trimmed = name.trim();
    await d
      .insert(technicians)
      .values({ airtableName: name, displayName: trimmed })
      .onDuplicateKeyUpdate({ set: { displayName: trimmed } });
  }
}

export async function listTechnicians() {
  const d = await db();
  return d.select().from(technicians).orderBy(technicians.displayName);
}

export async function getTechnicianByUserId(userId: number) {
  const d = await db();
  const rows = await d
    .select()
    .from(technicians)
    .where(eq(technicians.userId, userId))
    .limit(1);
  return rows[0];
}

export async function getTechnicianByName(airtableName: string) {
  const d = await db();
  const rows = await d
    .select()
    .from(technicians)
    .where(eq(technicians.airtableName, airtableName))
    .limit(1);
  return rows[0];
}

export async function linkTechnicianToUser(
  airtableName: string,
  userId: number,
) {
  const d = await db();
  await d
    .update(technicians)
    .set({ userId })
    .where(eq(technicians.airtableName, airtableName));
}

export async function updateTechnician(
  id: number,
  patch: Partial<InsertTechnician>,
) {
  const d = await db();
  await d.update(technicians).set(patch).where(eq(technicians.id, id));
}

/* --------------------------- Hazard Assessments --------------------------- */

export async function createHazardAssessment(data: InsertHazardAssessment) {
  const d = await db();
  const res = await d.insert(hazardAssessments).values(data);
  return res;
}

export async function getHazardAssessment(
  airtableJobId: string,
  technicianName: string,
  phase: string,
) {
  const d = await db();
  const rows = await d
    .select()
    .from(hazardAssessments)
    .where(
      and(
        eq(hazardAssessments.airtableJobId, airtableJobId),
        eq(hazardAssessments.technicianName, technicianName),
        eq(hazardAssessments.phase, phase),
      ),
    )
    .orderBy(desc(hazardAssessments.submittedAt))
    .limit(1);
  return rows[0];
}

export async function listHazardAssessmentsForJob(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(hazardAssessments)
    .where(eq(hazardAssessments.airtableJobId, airtableJobId))
    .orderBy(desc(hazardAssessments.submittedAt));
}

/* ------------------------------- Time Logs ------------------------------- */

export async function getOpenTimeLog(
  airtableJobId: string,
  technicianName: string,
) {
  const d = await db();
  const rows = await d
    .select()
    .from(timeLogs)
    .where(
      and(
        eq(timeLogs.airtableJobId, airtableJobId),
        eq(timeLogs.technicianName, technicianName),
        isNull(timeLogs.checkOutAt),
      ),
    )
    .orderBy(desc(timeLogs.checkInAt))
    .limit(1);
  return rows[0];
}

export async function createTimeLog(data: InsertTimeLog) {
  const d = await db();
  const res = await d.insert(timeLogs).values(data);
  // @ts-ignore drizzle mysql returns insertId
  return res[0]?.insertId ?? null;
}

export async function closeTimeLog(id: number, checkOutAt: Date, hours: number) {
  const d = await db();
  await d
    .update(timeLogs)
    .set({ checkOutAt, hours })
    .where(eq(timeLogs.id, id));
}

export async function listTimeLogsForTechnician(technicianName: string) {
  const d = await db();
  return d
    .select()
    .from(timeLogs)
    .where(eq(timeLogs.technicianName, technicianName))
    .orderBy(desc(timeLogs.checkInAt));
}

// Sum hours per technician within a date window (pay period).
export async function sumHoursInPeriod(start: Date, end: Date) {
  const d = await db();
  const rows = await d
    .select({
      technicianName: timeLogs.technicianName,
      total: sql<number>`COALESCE(SUM(${timeLogs.hours}), 0)`,
    })
    .from(timeLogs)
    .where(and(gte(timeLogs.checkInAt, start), lt(timeLogs.checkInAt, end)))
    .groupBy(timeLogs.technicianName);
  return rows;
}

// Live in-progress hours (checked-in but not yet out).
export async function listOpenTimeLogs() {
  const d = await db();
  return d
    .select()
    .from(timeLogs)
    .where(isNull(timeLogs.checkOutAt));
}

/* ----------------------------- Change History ----------------------------- */

export async function appendChangeHistory(entry: InsertChangeHistory) {
  const d = await db();
  await d.insert(changeHistory).values(entry);
}

export async function listChangeHistory(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(changeHistory)
    .where(eq(changeHistory.airtableJobId, airtableJobId))
    .orderBy(desc(changeHistory.createdAt));
}

export async function listAllChangeHistory(limit = 200) {
  const d = await db();
  return d
    .select()
    .from(changeHistory)
    .orderBy(desc(changeHistory.createdAt))
    .limit(limit);
}

/* ----------------------------- Notifications ----------------------------- */

export async function createNotification(data: InsertNotification) {
  const d = await db();
  await d.insert(notifications).values(data);
}

export async function listNotificationsForTechnician(
  technicianName: string,
  limit = 50,
) {
  const d = await db();
  return d
    .select()
    .from(notifications)
    .where(eq(notifications.technicianName, technicianName))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnreadNotifications(technicianName: string) {
  const d = await db();
  const rows = await d
    .select({ c: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.technicianName, technicianName),
        isNull(notifications.readAt),
      ),
    );
  return Number(rows[0]?.c ?? 0);
}

export async function markNotificationRead(id: number) {
  const d = await db();
  await d
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.id, id));
}

export async function markAllNotificationsRead(technicianName: string) {
  const d = await db();
  await d
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.technicianName, technicianName),
        isNull(notifications.readAt),
      ),
    );
}

/* ------------------------------ App Settings ------------------------------ */

export async function getSetting(key: string): Promise<string | null> {
  const d = await db();
  const rows = await d
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const d = await db();
  await d
    .insert(appSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

export async function getOvertimeThreshold(): Promise<number> {
  const v = await getSetting("overtime_threshold");
  if (v === null) return ALBERTA_OT_THRESHOLD_DEFAULT;
  const n = Number(v);
  return isNaN(n) ? ALBERTA_OT_THRESHOLD_DEFAULT : n;
}
