import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
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
  schedulerAssignments,
  InsertSchedulerAssignment,
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

/* -------------------------- Scheduler Assignments -------------------------- */

export async function createSchedulerAssignment(
  data: InsertSchedulerAssignment,
) {
  const d = await db();
  await d.insert(schedulerAssignments).values(data);
}

export async function listSchedulerAssignmentsInRange(
  startDate: string,
  endDate: string,
) {
  const d = await db();
  return d
    .select()
    .from(schedulerAssignments)
    .where(
      and(
        gte(schedulerAssignments.scheduledDate, startDate),
        lte(schedulerAssignments.scheduledDate, endDate),
      ),
    )
    .orderBy(schedulerAssignments.scheduledDate);
}

export async function listSchedulerAssignmentsForJob(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(schedulerAssignments)
    .where(eq(schedulerAssignments.airtableJobId, airtableJobId));
}

export async function deleteSchedulerAssignment(id: number) {
  const d = await db();
  await d
    .delete(schedulerAssignments)
    .where(eq(schedulerAssignments.id, id));
}

/** Existing scheduler assignments for a technician on a given date (for availability). */
export async function listTechAssignmentsOnDate(
  technicianName: string,
  scheduledDate: string,
) {
  const d = await db();
  return d
    .select()
    .from(schedulerAssignments)
    .where(
      and(
        eq(schedulerAssignments.technicianName, technicianName),
        eq(schedulerAssignments.scheduledDate, scheduledDate),
      ),
    );
}


/* ----------------------- Local Job Assignments ----------------------- */
// Authoritative "who is on the job" record (Airtable is read-only).

import {
  jobAssignments,
  InsertJobAssignment,
  jobPhotos,
  InsertJobPhoto,
  jobNotes,
  InsertJobNote,
  jobOverrides,
  equipmentCatalog,
  InsertEquipmentCatalogItem,
  equipmentAssignments,
} from "../drizzle/schema";

const PHASES = ["Preparation", "Setup", "Pickup"] as const;
type Phase = (typeof PHASES)[number];

/** Phase-level assignment rows for a job (excludes day-pinned scheduler rows). */
export async function listAssignmentsForJob(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(jobAssignments)
    .where(
      and(
        eq(jobAssignments.airtableJobId, airtableJobId),
        isNull(jobAssignments.scheduledDate),
      ),
    );
}

/** Assignment rows for many jobs at once, grouped into a Map keyed by jobId. */
export async function getAssignmentsMap(jobIds: string[]) {
  const map = new Map<string, { Preparation: string[]; Setup: string[]; Pickup: string[] }>();
  if (jobIds.length === 0) return map;
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(
      and(
        inArray(jobAssignments.airtableJobId, jobIds),
        isNull(jobAssignments.scheduledDate),
      ),
    );
  for (const r of rows) {
    if (!map.has(r.airtableJobId)) {
      map.set(r.airtableJobId, { Preparation: [], Setup: [], Pickup: [] });
    }
    const entry = map.get(r.airtableJobId)!;
    if ((PHASES as readonly string[]).includes(r.phase)) {
      entry[r.phase as Phase].push(r.technicianName);
    }
  }
  return map;
}

/** Replace the full technician set for a (job, phase). Returns old technicians. */
export async function setPhaseAssignments(
  airtableJobId: string,
  phase: string,
  technicianNames: string[],
  actor: { userId?: number; name?: string },
): Promise<string[]> {
  const d = await db();
  const existing = await d
    .select()
    .from(jobAssignments)
    .where(
      and(
        eq(jobAssignments.airtableJobId, airtableJobId),
        eq(jobAssignments.phase, phase),
        isNull(jobAssignments.scheduledDate),
      ),
    );
  const old = existing.map((r) => r.technicianName);

  await d
    .delete(jobAssignments)
    .where(
      and(
        eq(jobAssignments.airtableJobId, airtableJobId),
        eq(jobAssignments.phase, phase),
        isNull(jobAssignments.scheduledDate),
      ),
    );

  if (technicianNames.length > 0) {
    const values: InsertJobAssignment[] = technicianNames.map((t) => ({
      airtableJobId,
      phase,
      technicianName: t,
      createdByUserId: actor.userId ?? null,
      createdByName: actor.name ?? null,
    }));
    await d.insert(jobAssignments).values(values);
  }
  return old;
}

/**
 * Jobs (ids) a technician is assigned to, with the set of phases. Combines both
 * phase-level rows and day-pinned scheduler rows so the technician sees every
 * job they are on. Phases are de-duplicated.
 */
export async function listJobIdsForTechnician(technicianName: string) {
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.technicianName, technicianName));
  const byJob = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byJob.has(r.airtableJobId)) byJob.set(r.airtableJobId, new Set());
    byJob.get(r.airtableJobId)!.add(r.phase);
  }
  const out = new Map<string, string[]>();
  byJob.forEach((phases, jobId) => out.set(jobId, Array.from(phases)));
  return out;
}

/** All assignment rows where a technician appears (for conflict detection). */
export async function listAllAssignmentsForTechnician(technicianName: string) {
  const d = await db();
  return d
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.technicianName, technicianName));
}

/* -------------------- Day & time-specific scheduling -------------------- */
// These reuse the same job_assignments table (single source of truth) but set
// scheduledDate/startTime/endTime so an assignment is pinned to a calendar day.

/**
 * Create a day/time-pinned assignment for (job, phase, technician, date).
 * Idempotent per (job, phase, technician, date): updates the time window if a
 * row already exists for that exact combination. Returns the row id.
 */
export async function setScheduledAssignment(input: {
  airtableJobId: string;
  phase: string;
  technicianName: string;
  scheduledDate: string; // YYYY-MM-DD
  startTime?: string | null; // HH:MM
  endTime?: string | null; // HH:MM
  actor?: { userId?: number; name?: string };
}): Promise<number> {
  const d = await db();
  const existing = await d
    .select()
    .from(jobAssignments)
    .where(
      and(
        eq(jobAssignments.airtableJobId, input.airtableJobId),
        eq(jobAssignments.phase, input.phase),
        eq(jobAssignments.technicianName, input.technicianName),
        eq(jobAssignments.scheduledDate, input.scheduledDate),
      ),
    );
  if (existing.length > 0) {
    await d
      .update(jobAssignments)
      .set({
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
      })
      .where(eq(jobAssignments.id, existing[0].id));
    return existing[0].id;
  }
  const res = await d.insert(jobAssignments).values({
    airtableJobId: input.airtableJobId,
    phase: input.phase,
    technicianName: input.technicianName,
    scheduledDate: input.scheduledDate,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    createdByUserId: input.actor?.userId ?? null,
    createdByName: input.actor?.name ?? null,
  });
  // drizzle-mysql returns insertId on the first result element
  return Number((res as any)[0]?.insertId ?? 0);
}

/** All day/time-pinned assignments overlapping a date range (inclusive). */
export async function listScheduledAssignmentsForWeek(
  startDate: string,
  endDate: string,
) {
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(
      and(
        isNotNull(jobAssignments.scheduledDate),
        gte(jobAssignments.scheduledDate, startDate),
        lte(jobAssignments.scheduledDate, endDate),
      ),
    );
  return rows;
}

/** Remove a single assignment row by id. */
export async function removeAssignment(id: number) {
  const d = await db();
  await d.delete(jobAssignments).where(eq(jobAssignments.id, id));
}

/** Technician names already booked (day-pinned) on a given calendar date. */
export async function listBookedTechniciansOnDate(scheduledDate: string) {
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.scheduledDate, scheduledDate));
  return Array.from(new Set(rows.map((r) => r.technicianName)));
}

/* ----------------------------- Job Photos ----------------------------- */

export async function createJobPhoto(data: InsertJobPhoto) {
  const d = await db();
  await d.insert(jobPhotos).values(data);
}

export async function listJobPhotos(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(jobPhotos)
    .where(eq(jobPhotos.airtableJobId, airtableJobId))
    .orderBy(desc(jobPhotos.createdAt));
}

/* ----------------------------- Job Notes ------------------------------ */

export async function createJobNote(data: InsertJobNote) {
  const d = await db();
  await d.insert(jobNotes).values(data);
}

export async function listJobNotes(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(jobNotes)
    .where(eq(jobNotes.airtableJobId, airtableJobId))
    .orderBy(desc(jobNotes.createdAt));
}

/* ---------------------------- Job Overrides --------------------------- */

export async function upsertJobOverride(
  airtableJobId: string,
  patch: { endDate?: string | null; subStatus?: string | null },
  actor: { userId?: number; name?: string },
) {
  const d = await db();
  const set: Record<string, unknown> = {
    updatedByUserId: actor.userId ?? null,
    updatedByName: actor.name ?? null,
  };
  if (patch.endDate !== undefined) set.endDate = patch.endDate;
  if (patch.subStatus !== undefined) set.subStatus = patch.subStatus;

  await d
    .insert(jobOverrides)
    .values({
      airtableJobId,
      endDate: patch.endDate ?? null,
      subStatus: patch.subStatus ?? null,
      updatedByUserId: actor.userId ?? null,
      updatedByName: actor.name ?? null,
    })
    .onDuplicateKeyUpdate({ set });
}

export async function getJobOverride(airtableJobId: string) {
  const d = await db();
  const rows = await d
    .select()
    .from(jobOverrides)
    .where(eq(jobOverrides.airtableJobId, airtableJobId))
    .limit(1);
  return rows[0];
}

export async function getJobOverridesMap(jobIds: string[]) {
  const map = new Map<string, { endDate: string | null; subStatus: string | null }>();
  if (jobIds.length === 0) return map;
  const d = await db();
  const rows = await d
    .select()
    .from(jobOverrides)
    .where(inArray(jobOverrides.airtableJobId, jobIds));
  for (const r of rows) {
    map.set(r.airtableJobId, { endDate: r.endDate, subStatus: r.subStatus });
  }
  return map;
}


/* --------------------------- Equipment Catalog --------------------------- */
// Draggable equipment items for the Scheduler "Equipment" tab. Local-only.

const DEFAULT_EQUIPMENT: {
  name: string;
  category: string;
  color: string;
}[] = [
  { name: "No Parking Signs", category: "Signage", color: "#dc2626" },
  { name: "Barricades", category: "Barriers", color: "#ea580c" },
  { name: "Arrow Board / Robot", category: "Electronic", color: "#2563eb" },
  { name: "VMS Board", category: "Electronic", color: "#0ea5e9" },
  { name: "Tables", category: "Equipment", color: "#7c3aed" },
  { name: "Cones", category: "Signage", color: "#f59e0b" },
  { name: "Crash Truck / TMA", category: "Vehicles", color: "#16a34a" },
  { name: "Delineators", category: "Signage", color: "#db2777" },
];

export async function seedEquipmentCatalog() {
  const d = await db();
  let order = 0;
  for (const item of DEFAULT_EQUIPMENT) {
    await d
      .insert(equipmentCatalog)
      .values({
        name: item.name,
        category: item.category,
        color: item.color,
        sortOrder: order++,
      })
      .onDuplicateKeyUpdate({
        set: { category: item.category, color: item.color },
      });
  }
}

export async function listEquipmentCatalog() {
  const d = await db();
  return d
    .select()
    .from(equipmentCatalog)
    .where(eq(equipmentCatalog.active, true))
    .orderBy(equipmentCatalog.sortOrder, equipmentCatalog.name);
}

export async function createEquipmentItem(data: InsertEquipmentCatalogItem) {
  const d = await db();
  await d
    .insert(equipmentCatalog)
    .values(data)
    .onDuplicateKeyUpdate({ set: { active: true } });
}

/* ------------------------- Equipment Assignments ------------------------- */

export async function setEquipmentAssignment(input: {
  airtableJobId: string;
  equipmentName: string;
  scheduledDate: string; // YYYY-MM-DD
  technicianName?: string | null;
  quantity?: number;
  notes?: string | null;
  actor?: { userId?: number; name?: string };
}): Promise<number> {
  const d = await db();
  const res = await d.insert(equipmentAssignments).values({
    airtableJobId: input.airtableJobId,
    equipmentName: input.equipmentName,
    scheduledDate: input.scheduledDate,
    technicianName: input.technicianName ?? null,
    quantity: input.quantity ?? 1,
    notes: input.notes ?? null,
    createdByUserId: input.actor?.userId ?? null,
    createdByName: input.actor?.name ?? null,
  });
  return Number((res as any)[0]?.insertId ?? 0);
}

export async function listEquipmentAssignmentsForWeek(
  startDate: string,
  endDate: string,
) {
  const d = await db();
  return d
    .select()
    .from(equipmentAssignments)
    .where(
      and(
        gte(equipmentAssignments.scheduledDate, startDate),
        lte(equipmentAssignments.scheduledDate, endDate),
      ),
    )
    .orderBy(equipmentAssignments.scheduledDate);
}

export async function removeEquipmentAssignment(id: number) {
  const d = await db();
  await d
    .delete(equipmentAssignments)
    .where(eq(equipmentAssignments.id, id));
}
