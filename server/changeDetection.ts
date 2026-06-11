import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "./db";
import {
  jobChanges,
  jobSnapshots,
  type InsertJobChange,
  type InsertJobSnapshot,
  type JobChange,
  type JobSnapshot,
} from "../drizzle/schema";
import { fetchAllJobsForDetection } from "./airtable";
import type { JobRecord } from "../shared/airtableFields";

/**
 * Change detection over the rolling N-day planning window.
 *
 * Each run takes a daily "snapshot" of every job whose Start Date falls within
 * the window, then diffs that snapshot against the most recent prior snapshot
 * (per job) to surface New / Cancelled / Postponed / Modified changes. Airtable
 * remains read-only; all snapshots/changes live in the local DB.
 */

export const CHANGE_WINDOW_DAYS = 5;

// Statuses that mean the job is effectively cancelled/dead.
const DEAD_STATUSES = new Set(["Cancelled", "Permit Declined"]);

// Fields we track for "modified" changes (snapshot column -> human label).
const TRACKED_FIELDS: { key: keyof TrackedShape; label: string }[] = [
  { key: "startDate", label: "Start Date" },
  { key: "jobAddress", label: "Job Address" },
  { key: "closureType", label: "Closure Type" },
  { key: "impact", label: "Impact" },
  { key: "setupDuration", label: "Setup Duration" },
  { key: "subStatus", label: "Sub-Status" },
  { key: "technicians", label: "Technicians" },
];

type TrackedShape = {
  startDate: string | null;
  jobAddress: string | null;
  closureType: string | null;
  impact: string | null;
  setupDuration: string | null;
  subStatus: string | null;
  technicians: string | null;
};

/** UTC YYYY-MM-DD for a given Date (defaults to now). */
export function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a job's Start Date into a UTC date key, or null when missing/invalid. */
export function jobStartDateKey(job: JobRecord): string | null {
  if (!job.startDate) return null;
  const d = new Date(job.startDate);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** True when the job's Start Date falls within [today, today + windowDays). */
export function isInWindow(
  job: JobRecord,
  today: string = utcDateKey(),
  windowDays: number = CHANGE_WINDOW_DAYS,
): boolean {
  const key = jobStartDateKey(job);
  if (!key) return false;
  const start = new Date(`${today}T00:00:00Z`).getTime();
  const end = start + windowDays * 24 * 60 * 60 * 1000;
  const jobTime = new Date(`${key}T00:00:00Z`).getTime();
  return jobTime >= start && jobTime < end;
}

/** Build the comparable snapshot shape from an Airtable job record. */
export function toSnapshotShape(job: JobRecord): TrackedShape {
  const techs = [...job.techPrep, ...job.techSetup, ...job.techPickup]
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  return {
    startDate: job.startDate ?? null,
    jobAddress: job.jobAddress ?? null,
    closureType: job.closureType ?? null,
    impact: job.impact ?? null,
    setupDuration: job.setupDuration ?? null,
    subStatus: job.subStatus ?? null,
    technicians: techs.length ? techs.join(", ") : null,
  };
}

export type DetectionResult = {
  snapshotDate: string;
  jobsInWindow: number;
  changes: {
    new: number;
    cancelled: number;
    postponed: number;
    modified: number;
  };
  total: number;
};

/**
 * Diff a job's current snapshot against its previous snapshot. Returns the list
 * of change rows to insert (without ids). Pure function — easy to unit test.
 */
export function diffJob(params: {
  detectedDate: string;
  job: JobRecord;
  current: TrackedShape;
  previous: JobSnapshot | null;
}): InsertJobChange[] {
  const { detectedDate, job, current, previous } = params;
  const base = {
    detectedDate,
    airtableJobId: job.id,
    requestId: job.requestId ?? null,
    company: job.company ?? null,
    startDate: current.startDate ?? null,
  };

  // No prior snapshot in the window => brand new appearance.
  if (!previous) {
    return [{ ...base, changeType: "new" as const }];
  }

  const rows: InsertJobChange[] = [];
  const wasDead = DEAD_STATUSES.has((previous.status ?? "").trim());
  const isDeadNow = DEAD_STATUSES.has((job.status ?? "").trim());

  // Became cancelled/declined since last snapshot.
  if (!wasDead && isDeadNow) {
    rows.push({
      ...base,
      changeType: "cancelled",
      fieldName: "Status",
      oldValue: previous.status ?? null,
      newValue: job.status ?? null,
    });
    return rows; // cancellation supersedes field-level diffs
  }

  // Start date moved => postponed/rescheduled.
  if ((previous.startDate ?? null) !== (current.startDate ?? null)) {
    rows.push({
      ...base,
      changeType: "postponed",
      fieldName: "Start Date",
      oldValue: previous.startDate ?? null,
      newValue: current.startDate ?? null,
    });
  }

  // Other tracked field changes => modified.
  for (const f of TRACKED_FIELDS) {
    if (f.key === "startDate") continue; // handled as postponed above
    const oldVal = (previous as unknown as TrackedShape)[f.key] ?? null;
    const newVal = current[f.key] ?? null;
    if ((oldVal ?? null) !== (newVal ?? null)) {
      rows.push({
        ...base,
        changeType: "modified",
        fieldName: f.label,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }

  return rows;
}

/**
 * Run a full detection pass: fetch jobs, snapshot the window, diff against the
 * most recent prior snapshot per job, persist changes. Idempotent per day: if a
 * snapshot already exists for `snapshotDate`, that job is skipped for snapshot
 * insertion (re-running the same day won't duplicate snapshots or changes).
 */
export async function runChangeDetection(
  now: Date = new Date(),
): Promise<DetectionResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available for change detection");
  }

  const snapshotDate = utcDateKey(now);
  const today = snapshotDate;

  const allJobs = await fetchAllJobsForDetection();
  const windowJobs = allJobs.filter((j: JobRecord) => isInWindow(j, today));

  // Idempotency: which jobs already have a snapshot for today?
  const existingToday = await db
    .select({ airtableJobId: jobSnapshots.airtableJobId })
    .from(jobSnapshots)
    .where(eq(jobSnapshots.snapshotDate, snapshotDate));
  const alreadySnapshotted = new Set(
    existingToday.map((r) => r.airtableJobId),
  );

  const result: DetectionResult = {
    snapshotDate,
    jobsInWindow: windowJobs.length,
    changes: { new: 0, cancelled: 0, postponed: 0, modified: 0 },
    total: 0,
  };

  for (const job of windowJobs) {
    if (alreadySnapshotted.has(job.id)) continue;

    const current = toSnapshotShape(job);

    // Most recent prior snapshot for this job (before today).
    const prior = (
      await db
        .select()
        .from(jobSnapshots)
        .where(
          and(
            eq(jobSnapshots.airtableJobId, job.id),
            lt(jobSnapshots.snapshotDate, snapshotDate),
          ),
        )
        .orderBy(desc(jobSnapshots.snapshotDate))
        .limit(1)
    )[0] ?? null;

    const changeRows = diffJob({
      detectedDate: snapshotDate,
      job,
      current,
      previous: prior,
    });

    if (changeRows.length) {
      await db.insert(jobChanges).values(changeRows);
      for (const c of changeRows) {
        result.changes[c.changeType] += 1;
        result.total += 1;
      }
    }

    const snapshotRow: InsertJobSnapshot = {
      snapshotDate,
      airtableJobId: job.id,
      requestId: job.requestId ?? null,
      company: job.company ?? null,
      jobAddress: job.jobAddress ?? null,
      startDate: current.startDate,
      endDate: job.endDate ?? null,
      status: job.status ?? null,
      subStatus: current.subStatus,
      setupDuration: current.setupDuration,
      closureType: current.closureType,
      impact: current.impact,
      technicians: current.technicians,
    };
    await db.insert(jobSnapshots).values(snapshotRow);
  }

  // Detect jobs that DISAPPEARED from the window since yesterday (e.g. removed
  // from the table entirely, or Start Date pushed out of range). These won't be
  // in windowJobs today but had a snapshot in the most recent prior date.
  await detectDisappeared({
    db,
    snapshotDate,
    presentJobIds: new Set(windowJobs.map((j: JobRecord) => j.id)),
    allJobIds: new Set(allJobs.map((j: JobRecord) => j.id)),
    result,
  });

  return result;
}

async function detectDisappeared(params: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  snapshotDate: string;
  presentJobIds: Set<string>;
  allJobIds: Set<string>;
  result: DetectionResult;
}): Promise<void> {
  const { db, snapshotDate, presentJobIds, allJobIds, result } = params;

  // Find the most recent prior snapshot date.
  const priorDates = await db
    .select({ snapshotDate: jobSnapshots.snapshotDate })
    .from(jobSnapshots)
    .where(lt(jobSnapshots.snapshotDate, snapshotDate))
    .orderBy(desc(jobSnapshots.snapshotDate))
    .limit(1);
  const priorDate = priorDates[0]?.snapshotDate;
  if (!priorDate) return;

  const priorSnaps = await db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.snapshotDate, priorDate));

  for (const snap of priorSnaps) {
    if (presentJobIds.has(snap.airtableJobId)) continue;
    // It was in the window yesterday but not today. If it's gone from Airtable
    // entirely OR no longer in the window, flag as cancelled/disappeared — but
    // only once (idempotency): skip if we already logged a change today.
    const alreadyLogged = (
      await db
        .select({ id: jobChanges.id })
        .from(jobChanges)
        .where(
          and(
            eq(jobChanges.detectedDate, snapshotDate),
            eq(jobChanges.airtableJobId, snap.airtableJobId),
          ),
        )
        .limit(1)
    )[0];
    if (alreadyLogged) continue;

    const goneFromAirtable = !allJobIds.has(snap.airtableJobId);
    await db.insert(jobChanges).values({
      detectedDate: snapshotDate,
      airtableJobId: snap.airtableJobId,
      requestId: snap.requestId ?? null,
      company: snap.company ?? null,
      changeType: "cancelled",
      fieldName: goneFromAirtable ? "Removed" : "Out of window",
      oldValue: snap.startDate ?? null,
      newValue: null,
      startDate: snap.startDate ?? null,
    });
    result.changes.cancelled += 1;
    result.total += 1;
  }
}

/** Fetch changes detected within the last `days` days (for the alerts tray). */
export async function getRecentChanges(days = CHANGE_WINDOW_DAYS): Promise<
  JobChange[]
> {
  const db = await getDb();
  if (!db) return [];
  const since = utcDateKey(
    new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  );
  return db
    .select()
    .from(jobChanges)
    .where(gte(jobChanges.detectedDate, since))
    .orderBy(desc(jobChanges.createdAt));
}

/** Map of airtableJobId -> latest unacknowledged change type, for row badges. */
export async function getActiveChangeBadges(): Promise<
  Record<string, JobChange[]>
> {
  const db = await getDb();
  if (!db) return {};
  const since = utcDateKey(
    new Date(Date.now() - CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  );
  const rows = await db
    .select()
    .from(jobChanges)
    .orderBy(desc(jobChanges.createdAt));
  const map: Record<string, JobChange[]> = {};
  for (const r of rows) {
    if (r.detectedDate < since) continue;
    if (r.acknowledgedAt) continue;
    (map[r.airtableJobId] ??= []).push(r);
  }
  return map;
}

/** Acknowledge (dismiss) changes by id. */
export async function acknowledgeChanges(ids: number[]): Promise<number> {
  const db = await getDb();
  if (!db || ids.length === 0) return 0;
  await db
    .update(jobChanges)
    .set({ acknowledgedAt: new Date() })
    .where(inArray(jobChanges.id, ids));
  return ids.length;
}
