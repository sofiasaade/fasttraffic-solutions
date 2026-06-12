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
  technicianProfiles,
  InsertTechnicianProfile,
  technicianCertificates,
  InsertTechnicianCertificate,
  technicianAvailability,
  InsertTechnicianAvailability,
  flaggingHours,
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

/** Set a technician's experience level (apprentice | junior | senior). */
export async function setTechnicianLevel(
  airtableName: string,
  level: "apprentice" | "junior" | "senior",
) {
  const d = await db();
  await d
    .update(technicians)
    .set({ experienceLevel: level })
    .where(eq(technicians.airtableName, airtableName));
}

/* --------------------- Technician profiles / certs / availability ------- */

export async function getTechnicianProfile(airtableName: string) {
  const d = await db();
  const rows = await d
    .select()
    .from(technicianProfiles)
    .where(eq(technicianProfiles.airtableName, airtableName))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertTechnicianProfile(
  data: InsertTechnicianProfile,
) {
  const d = await db();
  await d
    .insert(technicianProfiles)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        headline: data.headline ?? null,
        experienceSummary: data.experienceSummary ?? null,
        yearsExperience: data.yearsExperience ?? null,
        updatedByUserId: data.updatedByUserId ?? null,
        updatedByName: data.updatedByName ?? null,
      },
    });
  return getTechnicianProfile(data.airtableName);
}

export async function listTechnicianCertificates(airtableName: string) {
  const d = await db();
  return d
    .select()
    .from(technicianCertificates)
    .where(eq(technicianCertificates.airtableName, airtableName))
    .orderBy(desc(technicianCertificates.createdAt));
}

export async function createTechnicianCertificate(
  data: InsertTechnicianCertificate,
) {
  const d = await db();
  const res = await d.insert(technicianCertificates).values(data);
  return Number((res as any)[0]?.insertId ?? 0);
}

export async function deleteTechnicianCertificate(id: number) {
  const d = await db();
  await d
    .delete(technicianCertificates)
    .where(eq(technicianCertificates.id, id));
}

/** Count certificates per technician (for list badges). */
export async function getCertificateCounts(airtableNames: string[]) {
  if (airtableNames.length === 0) return new Map<string, number>();
  const d = await db();
  const rows = await d
    .select({
      airtableName: technicianCertificates.airtableName,
      total: sql<number>`count(*)`,
    })
    .from(technicianCertificates)
    .where(inArray(technicianCertificates.airtableName, airtableNames))
    .groupBy(technicianCertificates.airtableName);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.airtableName, Number(r.total));
  return out;
}

export async function listTechnicianAvailability(airtableName: string) {
  const d = await db();
  return d
    .select()
    .from(technicianAvailability)
    .where(eq(technicianAvailability.airtableName, airtableName));
}

/** Availability rows for many technicians (for the worker-week grid). */
export async function listAvailabilityForNames(airtableNames: string[]) {
  if (airtableNames.length === 0)
    return [] as (typeof technicianAvailability.$inferSelect)[];
  const d = await db();
  return d
    .select()
    .from(technicianAvailability)
    .where(inArray(technicianAvailability.airtableName, airtableNames));
}

/** Set a recurring weekday availability rule (upsert by name+weekday). */
export async function setWeekdayAvailability(input: {
  airtableName: string;
  weekday: number; // 0..6
  available: boolean;
  reason?: string | null;
  updatedByName?: string | null;
}) {
  const d = await db();
  const existing = await d
    .select()
    .from(technicianAvailability)
    .where(
      and(
        eq(technicianAvailability.airtableName, input.airtableName),
        eq(technicianAvailability.kind, "weekday"),
        eq(technicianAvailability.weekday, input.weekday),
      ),
    );
  if (existing.length > 0) {
    await d
      .update(technicianAvailability)
      .set({
        available: input.available,
        reason: input.reason ?? null,
        updatedByName: input.updatedByName ?? null,
      })
      .where(eq(technicianAvailability.id, existing[0].id));
    return existing[0].id;
  }
  const res = await d.insert(technicianAvailability).values({
    airtableName: input.airtableName,
    kind: "weekday",
    weekday: input.weekday,
    available: input.available,
    reason: input.reason ?? null,
    updatedByName: input.updatedByName ?? null,
  });
  return Number((res as any)[0]?.insertId ?? 0);
}

/** Set a specific-date availability override (upsert by name+date). */
export async function setDateAvailability(input: {
  airtableName: string;
  date: string; // YYYY-MM-DD
  available: boolean;
  reason?: string | null;
  updatedByName?: string | null;
}) {
  const d = await db();
  const existing = await d
    .select()
    .from(technicianAvailability)
    .where(
      and(
        eq(technicianAvailability.airtableName, input.airtableName),
        eq(technicianAvailability.kind, "date"),
        eq(technicianAvailability.date, input.date),
      ),
    );
  if (existing.length > 0) {
    await d
      .update(technicianAvailability)
      .set({
        available: input.available,
        reason: input.reason ?? null,
        updatedByName: input.updatedByName ?? null,
      })
      .where(eq(technicianAvailability.id, existing[0].id));
    return existing[0].id;
  }
  const res = await d.insert(technicianAvailability).values({
    airtableName: input.airtableName,
    kind: "date",
    date: input.date,
    available: input.available,
    reason: input.reason ?? null,
    updatedByName: input.updatedByName ?? null,
  });
  return Number((res as any)[0]?.insertId ?? 0);
}

export async function removeAvailabilityRule(id: number) {
  const d = await db();
  await d
    .delete(technicianAvailability)
    .where(eq(technicianAvailability.id, id));
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
  jobBillingNotes,
  InsertJobBillingNote,
  jobOverrides,
  equipmentCatalog,
  InsertEquipmentCatalogItem,
  equipmentAssignments,
  truckCatalog,
  InsertTruckCatalogItem,
  truckAssignments,
  permitExtractions,
  InsertPermitExtraction,
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

export type AssignmentStatus = "tentative" | "confirmed";

/**
 * Per-job assignment summary used to derive the Pending / Tentative / Confirmed
 * job state and to color individual technician chips. Counts BOTH phase-level
 * and day-pinned rows. A job with zero assignments is "pending".
 */
export async function getAssignmentStatusMap(jobIds: string[]) {
  const map = new Map<
    string,
    {
      total: number;
      confirmed: number;
      tentative: number;
      byTech: Record<string, AssignmentStatus>;
    }
  >();
  if (jobIds.length === 0) return map;
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(inArray(jobAssignments.airtableJobId, jobIds));
  for (const r of rows) {
    if (!map.has(r.airtableJobId)) {
      map.set(r.airtableJobId, {
        total: 0,
        confirmed: 0,
        tentative: 0,
        byTech: {},
      });
    }
    const entry = map.get(r.airtableJobId)!;
    entry.total += 1;
    const status: AssignmentStatus =
      r.status === "confirmed" ? "confirmed" : "tentative";
    if (status === "confirmed") entry.confirmed += 1;
    else entry.tentative += 1;
    // A technician shown as confirmed once stays confirmed in the summary.
    if (status === "confirmed" || !entry.byTech[r.technicianName]) {
      entry.byTech[r.technicianName] = status;
    }
  }
  return map;
}

/** Set the confirmation status of a single assignment row. */
export async function setAssignmentStatus(
  id: number,
  status: AssignmentStatus,
  actorName?: string,
) {
  const d = await db();
  await d
    .update(jobAssignments)
    .set({
      status,
      confirmedAt: status === "confirmed" ? new Date() : null,
      confirmedByName: status === "confirmed" ? actorName ?? null : null,
    })
    .where(eq(jobAssignments.id, id));
}

/**
 * Confirm (or unconfirm) EVERY assignment row of a job. Returns the list of
 * affected rows BEFORE the change so callers can decide which technicians need
 * a notification (only newly-confirmed ones).
 */
export async function setJobAssignmentsStatus(
  airtableJobId: string,
  status: AssignmentStatus,
  actorName?: string,
) {
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.airtableJobId, airtableJobId));
  await d
    .update(jobAssignments)
    .set({
      status,
      confirmedAt: status === "confirmed" ? new Date() : null,
      confirmedByName: status === "confirmed" ? actorName ?? null : null,
    })
    .where(eq(jobAssignments.airtableJobId, airtableJobId));
  return rows;
}

/** Look up a single assignment row by id (with its current status). */
export async function getAssignmentById(id: number) {
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.id, id));
  return rows[0] ?? null;
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
  // Preserve confirmation state for technicians who remain on the phase, so
  // re-touching the phase list does not silently revert a confirmed worker
  // back to tentative.
  const prevByName = new Map(
    existing.map((r) => [
      r.technicianName,
      {
        status: r.status,
        confirmedAt: r.confirmedAt as Date | null,
        confirmedByName: r.confirmedByName as string | null,
      },
    ]),
  );

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
    const values: InsertJobAssignment[] = technicianNames.map((t) => {
      const prev = prevByName.get(t);
      return {
        airtableJobId,
        phase,
        technicianName: t,
        status: prev?.status ?? "tentative",
        confirmedAt: prev?.confirmedAt ?? null,
        confirmedByName: prev?.confirmedByName ?? null,
        createdByUserId: actor.userId ?? null,
        createdByName: actor.name ?? null,
      };
    });
    await d.insert(jobAssignments).values(values);
  }
  return old;
}

/**
 * Jobs (ids) a technician is assigned to, with the set of phases. Combines both
 * phase-level rows and day-pinned scheduler rows so the technician sees every
 * job they are on. Phases are de-duplicated.
 *
 * IMPORTANT: only CONFIRMED assignments are returned. Tentative assignments are
 * the coordinator's working draft (moving people around) and must stay
 * invisible to the technician until explicitly confirmed.
 */
export async function listJobIdsForTechnician(technicianName: string) {
  const d = await db();
  const rows = await d
    .select()
    .from(jobAssignments)
    .where(
      and(
        eq(jobAssignments.technicianName, technicianName),
        eq(jobAssignments.status, "confirmed"),
      ),
    );
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

/**
 * Move an existing day-pinned worker assignment to a different calendar day.
 * If the target day already has the same (job, phase, technician), the moved
 * row is merged (deleted) into the existing one to avoid duplicates.
 * Returns the id of the surviving row, or null if the source id was not found.
 */
export async function moveScheduledAssignment(input: {
  id: number;
  scheduledDate: string; // YYYY-MM-DD
}): Promise<number | null> {
  const d = await db();
  const found = await d
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.id, input.id));
  const row = found[0];
  if (!row) return null;
  if (row.scheduledDate === input.scheduledDate) return row.id;

  // Merge if the same worker is already on the target day for this job+phase.
  const dup = await d
    .select()
    .from(jobAssignments)
    .where(
      and(
        eq(jobAssignments.airtableJobId, row.airtableJobId),
        eq(jobAssignments.phase, row.phase),
        eq(jobAssignments.technicianName, row.technicianName),
        eq(jobAssignments.scheduledDate, input.scheduledDate),
      ),
    );
  if (dup.length > 0) {
    await d.delete(jobAssignments).where(eq(jobAssignments.id, input.id));
    return dup[0].id;
  }

  await d
    .update(jobAssignments)
    .set({ scheduledDate: input.scheduledDate })
    .where(eq(jobAssignments.id, input.id));
  return input.id;
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

/* -------------------------- Billing Notes ----------------------------- */
// Coordinator "Novedades" for invoicing. Local-only.

export async function createBillingNote(data: InsertJobBillingNote) {
  const d = await db();
  const [res] = await d.insert(jobBillingNotes).values(data).$returningId();
  return res?.id;
}

export async function listBillingNotes(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(jobBillingNotes)
    .where(eq(jobBillingNotes.airtableJobId, airtableJobId))
    .orderBy(desc(jobBillingNotes.createdAt));
}

/** Counts of billing notes grouped by job id (for row badges). */
export async function getBillingNoteCounts(airtableJobIds: string[]) {
  const map: Record<string, number> = {};
  if (airtableJobIds.length === 0) return map;
  const d = await db();
  const rows = await d
    .select()
    .from(jobBillingNotes)
    .where(inArray(jobBillingNotes.airtableJobId, airtableJobIds));
  for (const r of rows) {
    map[r.airtableJobId] = (map[r.airtableJobId] ?? 0) + 1;
  }
  return map;
}

export async function deleteBillingNote(id: number, authorUserId?: number) {
  const d = await db();
  if (authorUserId != null) {
    await d
      .delete(jobBillingNotes)
      .where(
        and(
          eq(jobBillingNotes.id, id),
          eq(jobBillingNotes.authorUserId, authorUserId),
        ),
      );
  } else {
    await d.delete(jobBillingNotes).where(eq(jobBillingNotes.id, id));
  }
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

/**
 * Move an existing equipment placement to a different day. Merges into an
 * existing same (job, equipment) row on the target day if present.
 */
export async function moveEquipmentAssignment(input: {
  id: number;
  scheduledDate: string;
}): Promise<number | null> {
  const d = await db();
  const found = await d
    .select()
    .from(equipmentAssignments)
    .where(eq(equipmentAssignments.id, input.id));
  const row = found[0];
  if (!row) return null;
  if (row.scheduledDate === input.scheduledDate) return row.id;
  const dup = await d
    .select()
    .from(equipmentAssignments)
    .where(
      and(
        eq(equipmentAssignments.airtableJobId, row.airtableJobId),
        eq(equipmentAssignments.equipmentName, row.equipmentName),
        eq(equipmentAssignments.scheduledDate, input.scheduledDate),
      ),
    );
  if (dup.length > 0) {
    await d
      .delete(equipmentAssignments)
      .where(eq(equipmentAssignments.id, input.id));
    return dup[0].id;
  }
  await d
    .update(equipmentAssignments)
    .set({ scheduledDate: input.scheduledDate })
    .where(eq(equipmentAssignments.id, input.id));
  return input.id;
}


/* ------------------------------ Truck Catalog ------------------------------ */

const DEFAULT_TRUCKS: {
  name: string;
  code: string;
  ref: string;
  description: string;
  vin: string;
  plate?: string;
  color: string;
}[] = [
  {
    name: "F 14",
    code: "FTS-01-0004",
    ref: "F 14",
    description: "Ford TRUCK/VAN F350 White - Gas 2015",
    plate: "CJR9273",
    vin: "1FDRF3G66FEC93606",
    color: "#2563eb",
  },
  {
    name: "F 15",
    code: "FTS-01-0005",
    ref: "F 15",
    description: "Ford F350XL White - Gas 2015",
    plate: "CNR6768",
    vin: "1FDRF3G67FEC93615",
    color: "#0ea5e9",
  },
  {
    name: "F 18",
    code: "FTS-01-0006",
    ref: "F 18",
    description: "2018 Ford F-350 Super Duty DRW S/A Deck",
    plate: "CVH2671",
    vin: "1FDRF3G60JEC01768",
    color: "#7c3aed",
  },
  {
    name: "F 21",
    code: "FTS-01-0007",
    ref: "F 21",
    description: "Ford TRUCK/VAN SUPER FF3H White - DIESEL 2021",
    plate: "CJW0176",
    vin: "1FDRF3HTOMEC94333",
    color: "#16a34a",
  },
  {
    name: "F 22",
    code: "FTS-01-0008",
    ref: "F 22",
    description: "Ford F350 White - Gas",
    plate: "CSC6259",
    vin: "1FDRF3H69MEC63432",
    color: "#ea580c",
  },
  {
    name: "F 23",
    code: "FTS-01-0009",
    ref: "F 23",
    description: "2023 Ford F450 SD XLT REG CAB 4WD GAS",
    plate: "CTK6057",
    vin: "1FD0X4HN6PED78934",
    color: "#db2777",
  },
  {
    name: "F 24",
    code: "FTS-01-0010",
    ref: "F 24",
    description: "Ford F350 White - Gas 2024",
    plate: "CS24833",
    vin: "1FDRF3ENXREE08593",
    color: "#0891b2",
  },
  {
    name: "FC",
    code: "FTS-01-0011",
    ref: "FC",
    description: "2023 FORD F150 LARIAT SUPERCREW 4WD",
    plate: "CSV3273",
    vin: "1FTEW1EP5PKF51474",
    color: "#65a30d",
  },
  {
    name: "F 25",
    code: "FTS-01-0012",
    ref: "F 25",
    description: "Ford F350 White - Gas 2025",
    plate: "CVV0501",
    vin: "1FDRF3HN0SEC59080",
    color: "#9333ea",
  },
  {
    name: "F 26",
    code: "FTS-01-0013",
    ref: "F 26",
    description: "Ford F350 White - Gas 2025",
    plate: "CVV0300",
    vin: "1FDRF3HN4SEC57865",
    color: "#c2410c",
  },
  {
    name: "F 27",
    code: "FTS-01-0014",
    ref: "F27",
    description: "Ford F350 White - Gas 2026",
    vin: "1FDRF3HN5TEE60037",
    color: "#0d9488",
  },
  {
    name: "F 28",
    code: "FTS-01-0015",
    ref: "F28",
    description: "Ford F350 White - Gas 2026",
    vin: "1FDRF3HN9TEE57660",
    color: "#4f46e5",
  },
];

export async function seedTruckCatalog() {
  const d = await db();
  let order = 0;
  for (const item of DEFAULT_TRUCKS) {
    await d
      .insert(truckCatalog)
      .values({
        name: item.name,
        code: item.code,
        ref: item.ref,
        description: item.description,
        vin: item.vin,
        plate: item.plate ?? null,
        color: item.color,
        sortOrder: order++,
      })
      .onDuplicateKeyUpdate({
        set: {
          code: item.code,
          ref: item.ref,
          description: item.description,
          vin: item.vin,
          plate: item.plate ?? null,
          color: item.color,
          sortOrder: order,
        },
      });
  }
}

export async function listTruckCatalog() {
  const d = await db();
  return d
    .select()
    .from(truckCatalog)
    .where(eq(truckCatalog.active, true))
    .orderBy(truckCatalog.sortOrder, truckCatalog.name);
}

export async function createTruckItem(data: InsertTruckCatalogItem) {
  const d = await db();
  await d
    .insert(truckCatalog)
    .values(data)
    .onDuplicateKeyUpdate({ set: { active: true } });
}

/* ---------------------------- Truck Assignments ---------------------------- */

export async function setTruckAssignment(input: {
  airtableJobId: string;
  truckName: string;
  scheduledDate: string; // YYYY-MM-DD
  driverName?: string | null;
  notes?: string | null;
  actor?: { userId?: number; name?: string };
}): Promise<number> {
  const d = await db();
  const res = await d.insert(truckAssignments).values({
    airtableJobId: input.airtableJobId,
    truckName: input.truckName,
    scheduledDate: input.scheduledDate,
    driverName: input.driverName ?? null,
    notes: input.notes ?? null,
    createdByUserId: input.actor?.userId ?? null,
    createdByName: input.actor?.name ?? null,
  });
  return Number((res as any)[0]?.insertId ?? 0);
}

export async function listTruckAssignmentsForWeek(
  startDate: string,
  endDate: string,
) {
  const d = await db();
  return d
    .select()
    .from(truckAssignments)
    .where(
      and(
        gte(truckAssignments.scheduledDate, startDate),
        lte(truckAssignments.scheduledDate, endDate),
      ),
    )
    .orderBy(truckAssignments.scheduledDate);
}

export async function removeTruckAssignment(id: number) {
  const d = await db();
  await d.delete(truckAssignments).where(eq(truckAssignments.id, id));
}

/**
 * Move an existing truck placement to a different day (driver preserved).
 * Merges into an existing same (job, truck) row on the target day if present.
 */
export async function moveTruckAssignment(input: {
  id: number;
  scheduledDate: string;
}): Promise<number | null> {
  const d = await db();
  const found = await d
    .select()
    .from(truckAssignments)
    .where(eq(truckAssignments.id, input.id));
  const row = found[0];
  if (!row) return null;
  if (row.scheduledDate === input.scheduledDate) return row.id;
  const dup = await d
    .select()
    .from(truckAssignments)
    .where(
      and(
        eq(truckAssignments.airtableJobId, row.airtableJobId),
        eq(truckAssignments.truckName, row.truckName),
        eq(truckAssignments.scheduledDate, input.scheduledDate),
      ),
    );
  if (dup.length > 0) {
    await d.delete(truckAssignments).where(eq(truckAssignments.id, input.id));
    return dup[0].id;
  }
  await d
    .update(truckAssignments)
    .set({ scheduledDate: input.scheduledDate })
    .where(eq(truckAssignments.id, input.id));
  return input.id;
}


/* ----------------------------- Flagging Hours ----------------------------- */

/**
 * Upsert billable flagging hours for one person on one day of one job.
 * Flagging is billed per person-hour, so the unique key is
 * (job, technician, date). Re-logging the same person/day overwrites hours.
 */
export async function setFlaggingHours(input: {
  airtableJobId: string;
  technicianName: string;
  workDate: string; // YYYY-MM-DD
  hours: number;
  hourlyRateCents?: number | null;
  note?: string | null;
  createdByUserId?: number | null;
  createdByName?: string | null;
}): Promise<number> {
  const d = await db();
  const existing = await d
    .select()
    .from(flaggingHours)
    .where(
      and(
        eq(flaggingHours.airtableJobId, input.airtableJobId),
        eq(flaggingHours.technicianName, input.technicianName),
        eq(flaggingHours.workDate, input.workDate),
      ),
    );
  if (existing.length > 0) {
    await d
      .update(flaggingHours)
      .set({
        hours: input.hours,
        hourlyRateCents: input.hourlyRateCents ?? null,
        note: input.note ?? null,
        createdByUserId: input.createdByUserId ?? null,
        createdByName: input.createdByName ?? null,
      })
      .where(eq(flaggingHours.id, existing[0].id));
    return existing[0].id;
  }
  const res = await d.insert(flaggingHours).values({
    airtableJobId: input.airtableJobId,
    technicianName: input.technicianName,
    workDate: input.workDate,
    hours: input.hours,
    hourlyRateCents: input.hourlyRateCents ?? null,
    note: input.note ?? null,
    createdByUserId: input.createdByUserId ?? null,
    createdByName: input.createdByName ?? null,
  });
  return Number((res as any)[0]?.insertId ?? 0);
}

export async function removeFlaggingHours(id: number) {
  const d = await db();
  await d.delete(flaggingHours).where(eq(flaggingHours.id, id));
}

/** All flagging-hour rows for one job, newest day first. */
export async function listFlaggingHoursForJob(airtableJobId: string) {
  const d = await db();
  return d
    .select()
    .from(flaggingHours)
    .where(eq(flaggingHours.airtableJobId, airtableJobId))
    .orderBy(desc(flaggingHours.workDate));
}

/** Flagging-hour rows across a date window (for the weekly billing summary). */
export async function listFlaggingHoursInWindow(
  startDate: string,
  endDate: string,
) {
  const d = await db();
  return d
    .select()
    .from(flaggingHours)
    .where(
      and(
        gte(flaggingHours.workDate, startDate),
        lte(flaggingHours.workDate, endDate),
      ),
    )
    .orderBy(flaggingHours.workDate);
}


/* ----------------------------- Day Timeline ----------------------------- */
//
// The Day Timeline lets the coordinator place a worker / equipment / truck on a
// specific HOUR of a specific project on a given day. Unlike the week grid
// (which dedupes by job+phase+tech+date), the timeline allows the SAME person to
// have multiple blocks on the same day/project at different hours (e.g. 9AM
// Setup + 3PM Pickup). Each block is identified by its row id, so moving /
// resizing simply updates that row.

export type TimelineKind = "worker" | "equipment" | "truck";

/** All worker/equipment/truck assignments pinned to a single calendar day. */
export async function listDayAssignments(date: string) {
  const d = await db();
  const [workers, equipment, trucks] = await Promise.all([
    d
      .select()
      .from(jobAssignments)
      .where(eq(jobAssignments.scheduledDate, date)),
    d
      .select()
      .from(equipmentAssignments)
      .where(eq(equipmentAssignments.scheduledDate, date)),
    d
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.scheduledDate, date)),
  ]);
  return { workers, equipment, trucks };
}

/**
 * Create a brand-new timeline block (always inserts, never merges) so a person
 * or resource can have several blocks on the same job/day at different hours.
 * Returns the new row id.
 */
export async function createTimelineBlock(input: {
  kind: TimelineKind;
  airtableJobId: string;
  scheduledDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  /** worker: technician name + phase; equipment: equipment name; truck: truck name */
  name: string;
  phase?: string | null; // worker only
  driverName?: string | null; // truck only
  technicianName?: string | null; // equipment installer (optional)
  actor?: { userId?: number; name?: string };
}): Promise<number> {
  const d = await db();
  if (input.kind === "worker") {
    const res = await d.insert(jobAssignments).values({
      airtableJobId: input.airtableJobId,
      phase: input.phase ?? "Setup",
      technicianName: input.name,
      scheduledDate: input.scheduledDate,
      startTime: input.startTime,
      endTime: input.endTime,
      createdByUserId: input.actor?.userId ?? null,
      createdByName: input.actor?.name ?? null,
    });
    return Number((res as any)[0]?.insertId ?? 0);
  }
  if (input.kind === "equipment") {
    const res = await d.insert(equipmentAssignments).values({
      airtableJobId: input.airtableJobId,
      equipmentName: input.name,
      scheduledDate: input.scheduledDate,
      startTime: input.startTime,
      endTime: input.endTime,
      technicianName: input.technicianName ?? null,
      quantity: 1,
      createdByUserId: input.actor?.userId ?? null,
      createdByName: input.actor?.name ?? null,
    });
    return Number((res as any)[0]?.insertId ?? 0);
  }
  // truck
  const res = await d.insert(truckAssignments).values({
    airtableJobId: input.airtableJobId,
    truckName: input.name,
    scheduledDate: input.scheduledDate,
    startTime: input.startTime,
    endTime: input.endTime,
    driverName: input.driverName ?? null,
    createdByUserId: input.actor?.userId ?? null,
    createdByName: input.actor?.name ?? null,
  });
  return Number((res as any)[0]?.insertId ?? 0);
}

/** Update only the start/end clock time of an existing timeline block (resize). */
export async function setTimelineBlockTime(input: {
  kind: TimelineKind;
  id: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}): Promise<boolean> {
  const d = await db();
  const patch = { startTime: input.startTime, endTime: input.endTime };
  if (input.kind === "worker") {
    await d
      .update(jobAssignments)
      .set(patch)
      .where(eq(jobAssignments.id, input.id));
  } else if (input.kind === "equipment") {
    await d
      .update(equipmentAssignments)
      .set(patch)
      .where(eq(equipmentAssignments.id, input.id));
  } else {
    await d
      .update(truckAssignments)
      .set(patch)
      .where(eq(truckAssignments.id, input.id));
  }
  return true;
}

/**
 * Move an existing timeline block to a (possibly different) project, day and
 * hour. Unlike the week-grid move, this NEVER merges — the block keeps its
 * identity so multiple same-person blocks can coexist.
 */
export async function moveTimelineBlock(input: {
  kind: TimelineKind;
  id: number;
  airtableJobId: string;
  scheduledDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}): Promise<boolean> {
  const d = await db();
  const patch = {
    airtableJobId: input.airtableJobId,
    scheduledDate: input.scheduledDate,
    startTime: input.startTime,
    endTime: input.endTime,
  };
  if (input.kind === "worker") {
    await d
      .update(jobAssignments)
      .set(patch)
      .where(eq(jobAssignments.id, input.id));
  } else if (input.kind === "equipment") {
    await d
      .update(equipmentAssignments)
      .set(patch)
      .where(eq(equipmentAssignments.id, input.id));
  } else {
    await d
      .update(truckAssignments)
      .set(patch)
      .where(eq(truckAssignments.id, input.id));
  }
  return true;
}

/** Remove a timeline block by kind + id. */
export async function removeTimelineBlock(input: {
  kind: TimelineKind;
  id: number;
}): Promise<boolean> {
  const d = await db();
  if (input.kind === "worker") {
    await d.delete(jobAssignments).where(eq(jobAssignments.id, input.id));
  } else if (input.kind === "equipment") {
    await d
      .delete(equipmentAssignments)
      .where(eq(equipmentAssignments.id, input.id));
  } else {
    await d.delete(truckAssignments).where(eq(truckAssignments.id, input.id));
  }
  return true;
}


// ---------------------------------------------------------------------------
// Street Use Permit (SU) PDF extraction cache
// ---------------------------------------------------------------------------

/** Look up a cached permit extraction by (jobId + filename). */
export async function getPermitExtraction(
  airtableJobId: string,
  filename: string,
) {
  const d = await db();
  const rows = await d
    .select()
    .from(permitExtractions)
    .where(
      and(
        eq(permitExtractions.airtableJobId, airtableJobId),
        eq(permitExtractions.filename, filename),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** All cached permit extractions for a set of jobs, keyed by jobId. */
export async function getPermitExtractionsMap(jobIds: string[]) {
  const map = new Map<string, PermitExtractionRow[]>();
  if (jobIds.length === 0) return map;
  const d = await db();
  const rows = await d
    .select()
    .from(permitExtractions)
    .where(inArray(permitExtractions.airtableJobId, jobIds));
  for (const r of rows) {
    const list = map.get(r.airtableJobId) ?? [];
    list.push(r);
    map.set(r.airtableJobId, list);
  }
  return map;
}

export type PermitExtractionRow = typeof permitExtractions.$inferSelect;

/** Insert or update a permit extraction row keyed by (jobId + filename). */
export async function upsertPermitExtraction(input: InsertPermitExtraction) {
  const d = await db();
  const existing = await d
    .select()
    .from(permitExtractions)
    .where(
      and(
        eq(permitExtractions.airtableJobId, input.airtableJobId),
        eq(permitExtractions.filename, input.filename),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    await d
      .update(permitExtractions)
      .set({
        fileUrl: input.fileUrl,
        permitNumber: input.permitNumber,
        validFromDate: input.validFromDate,
        validFromTime: input.validFromTime,
        validFromDay: input.validFromDay,
        validToDate: input.validToDate,
        validToTime: input.validToTime,
        validToDay: input.validToDay,
        numberOfDays: input.numberOfDays,
        parseStatus: input.parseStatus,
        rawJson: input.rawJson,
      })
      .where(eq(permitExtractions.id, existing[0].id));
    return existing[0].id;
  }
  const res = await d.insert(permitExtractions).values(input);
  return Number((res as any).insertId ?? 0);
}
