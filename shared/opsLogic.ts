// Pure, testable business logic shared between server and client.

import { JobRecord, JobPhase } from "./airtableFields";

/**
 * Bi-weekly pay period anchored to a known Monday start.
 * Default anchor: Monday 2024-01-01 (UTC). Pay periods are 14 days long.
 */
export const PAY_PERIOD_ANCHOR_UTC = Date.UTC(2024, 0, 1, 0, 0, 0);
export const PAY_PERIOD_LENGTH_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PayPeriod {
  start: Date;
  end: Date; // exclusive
  index: number;
}

export function getPayPeriodFor(date: Date): PayPeriod {
  const t = date.getTime();
  const elapsed = t - PAY_PERIOD_ANCHOR_UTC;
  const periodMs = PAY_PERIOD_LENGTH_DAYS * DAY_MS;
  const index = Math.floor(elapsed / periodMs);
  const start = new Date(PAY_PERIOD_ANCHOR_UTC + index * periodMs);
  const end = new Date(start.getTime() + periodMs);
  return { start, end, index };
}

export interface OvertimeStatus {
  technicianName: string;
  hours: number;
  threshold: number;
  remaining: number;
  // Visual severity tiers for the dashboard.
  level: "ok" | "approaching" | "over";
}

/**
 * Compute overtime status given accumulated hours and a threshold.
 * "approaching" triggers at >= 85% of threshold, "over" at >= threshold.
 */
export function computeOvertimeStatus(
  technicianName: string,
  hours: number,
  threshold: number,
): OvertimeStatus {
  const remaining = threshold - hours;
  let level: OvertimeStatus["level"] = "ok";
  if (hours >= threshold) level = "over";
  else if (hours >= threshold * 0.85) level = "approaching";
  return {
    technicianName,
    hours: Math.round(hours * 100) / 100,
    threshold,
    remaining: Math.round(remaining * 100) / 100,
    level,
  };
}

export interface JobInterval {
  jobId: string;
  start: number; // epoch ms
  end: number; // epoch ms
}

/**
 * Two intervals overlap when one starts before the other ends (strict).
 * Touching boundaries (a.end === b.start) are NOT considered a conflict.
 */
export function intervalsOverlap(a: JobInterval, b: JobInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface ConflictResult {
  hasConflict: boolean;
  conflicts: { jobId: string; otherJobId: string }[];
}

/**
 * Given a target job interval and the set of jobs a technician is already on,
 * detect scheduling conflicts (double-booking).
 */
export function detectConflicts(
  target: JobInterval,
  existing: JobInterval[],
): ConflictResult {
  const conflicts: { jobId: string; otherJobId: string }[] = [];
  for (const e of existing) {
    if (e.jobId === target.jobId) continue;
    if (intervalsOverlap(target, e)) {
      conflicts.push({ jobId: target.jobId, otherJobId: e.jobId });
    }
  }
  return { hasConflict: conflicts.length > 0, conflicts };
}

/**
 * Derive a JobInterval from a JobRecord using its start/end dates.
 * Falls back to a single-day interval if end date is missing.
 */
export function jobToInterval(job: JobRecord): JobInterval | null {
  if (!job.startDate) return null;
  const start = new Date(job.startDate).getTime();
  const end = job.endDate
    ? new Date(job.endDate).getTime()
    : start + DAY_MS; // default 1 day
  if (isNaN(start) || isNaN(end)) return null;
  return { jobId: job.id, start, end: Math.max(end, start + 1) };
}

/**
 * Derive a coarse "zone" for filtering from a job's municipality or address.
 */
export function deriveZone(job: JobRecord): string {
  if (job.municipality && job.municipality.trim()) return job.municipality.trim();
  const addr = job.jobAddress ?? "";
  // Try common Alberta city names from the address.
  const cities = [
    "Calgary",
    "Edmonton",
    "Red Deer",
    "Lethbridge",
    "Chestermere",
    "Airdrie",
    "Cochrane",
    "Okotoks",
    "Strathmore",
    "Canmore",
    "High River",
  ];
  for (const c of cities) {
    if (addr.toLowerCase().includes(c.toLowerCase())) return c;
  }
  return "Unspecified";
}

export const PHASES: JobPhase[] = ["Preparation", "Setup", "Pickup"];

export function getTechniciansForPhase(
  job: JobRecord,
  phase: JobPhase,
): string[] {
  switch (phase) {
    case "Preparation":
      return job.techPrep;
    case "Setup":
      return job.techSetup;
    case "Pickup":
      return job.techPickup;
  }
}

export function jobIsAssigned(job: JobRecord): boolean {
  return (
    job.techPrep.length > 0 ||
    job.techSetup.length > 0 ||
    job.techPickup.length > 0
  );
}
