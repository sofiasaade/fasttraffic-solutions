// Pure helpers for Street Use Permit (SU) handling. No I/O — safe to unit test
// and to share between server and (potentially) client.

export interface AttachmentLike {
  url: string;
  filename?: string;
  type?: string;
}

/**
 * A parsed Street Use Permit schedule (as extracted from the PDF). All dates
 * are YYYY-MM-DD, all times are HH:MM in 24h.
 */
export interface PermitSchedule {
  permitNumber?: string | null;
  validFromDate?: string | null;
  validFromTime?: string | null;
  validFromDay?: string | null;
  validToDate?: string | null;
  validToTime?: string | null;
  validToDay?: string | null;
  numberOfDays?: number | null;
}

/**
 * Returns true when the attachment looks like a Street Use Permit PDF.
 * Rule (from operations):
 *   - Calgary permits start with "SU"  (e.g. SU-26-672264-...).
 *   - Town of Cochrane / other municipalities start with "SUP" (e.g. SUP2026-...).
 * We treat any PDF whose filename starts with SU / SUP (optionally followed by a
 * digit or a separator) as a permit candidate. Avoid matching e.g. "Summary".
 */
export function isStreetUsePermitFile(att: AttachmentLike): boolean {
  const name = (att.filename ?? "").trim();
  if (!name) return false;
  // Must be a PDF and start with "SU"/"SUP" (case-insensitive).
  const isPdf =
    /\.pdf$/i.test(name) || (att.type ?? "").toLowerCase().includes("pdf");
  if (!isPdf) return false;
  // SUP followed by a digit/sep (Cochrane), or SU followed by a digit/sep (Calgary).
  return /^sup[\s_-]?\d/i.test(name) || /^su[\s_-]?\d/i.test(name) || /^su[\s_-]/i.test(name);
}

/** All SU permit attachments from a plan-file list. */
export function selectStreetUsePermits(
  attachments: AttachmentLike[] | null | undefined,
): AttachmentLike[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.filter(isStreetUsePermitFile);
}

/**
 * Among several SU permits for the same job, pick the most current one.
 * Preference order:
 *   1. The one with the latest validFromDate (when schedules are known).
 *   2. Fall back to the highest trailing permit sequence number in the filename.
 * `schedules` maps filename -> parsed schedule (may be partial / missing).
 */
export function pickMostCurrentPermit(
  permits: AttachmentLike[],
  schedules?: Record<string, PermitSchedule | undefined>,
): AttachmentLike | null {
  if (!permits || permits.length === 0) return null;
  if (permits.length === 1) return permits[0];

  const byDate = [...permits].sort((a, b) => {
    const sa = schedules?.[a.filename ?? ""]?.validFromDate ?? "";
    const sb = schedules?.[b.filename ?? ""]?.validFromDate ?? "";
    if (sa && sb && sa !== sb) return sa < sb ? 1 : -1; // later date first
    if (sa && !sb) return -1;
    if (!sa && sb) return 1;
    // Tie-break on a numeric token in the filename (often a version/permit no).
    const na = lastNumber(a.filename ?? "");
    const nb = lastNumber(b.filename ?? "");
    return nb - na;
  });
  return byDate[0];
}

function lastNumber(name: string): number {
  const matches = name.match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  return Number(matches[matches.length - 1]) || 0;
}

export type NineAmBucket = "before9" | "at9" | "after9" | "unknown";

/**
 * Classify a permit start time against the 9:00 AM reference used by the
 * Day Timeline summary boxes.
 */
export function classifyNineAm(time: string | null | undefined): NineAmBucket {
  const mins = parseMinutes(time);
  if (mins == null) return "unknown";
  const nine = 9 * 60;
  if (mins < nine) return "before9";
  if (mins === nine) return "at9";
  return "after9";
}

/** Parse "HH:MM" (24h) into minutes since midnight; null if unparseable. */
export function parseMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = String(time)
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Given a parsed permit schedule and the day being viewed (YYYY-MM-DD),
 * returns whether the job is "picked up" (finished) on that day. Pickup day is
 * the Permit Valid To date (which mirrors the End Date pickup rule).
 */
export function isPickupOnDate(
  schedule: PermitSchedule | null | undefined,
  date: string,
): boolean {
  if (!schedule?.validToDate) return false;
  return schedule.validToDate === date;
}

/**
 * Whether the permit's working window starts on the given day. Used to decide
 * which jobs contribute to the before/at/after-9AM counts for that day.
 */
export function startsOnDate(
  schedule: PermitSchedule | null | undefined,
  date: string,
): boolean {
  if (!schedule?.validFromDate) return false;
  return schedule.validFromDate === date;
}

// ---------------------------------------------------------------------------
// Fallback: when a job has no readable SU permit, use the project's own
// Start Date / End Date (Airtable). Those ISO values carry a time component
// (e.g. "2026-04-28T09:00:00.000Z"), and the Setup Duration label also encodes
// a window like "Daytime Work (9:00 AM - 3:00 PM)".
// ---------------------------------------------------------------------------

/** Extract "HH:MM" (24h, UTC) from an ISO timestamp. Null if absent/midnight-only. */
export function timeFromIso(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== "string") return null;
  // Match the time portion of an ISO 8601 string in UTC (Airtable stores Z).
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

/** Extract the "YYYY-MM-DD" date portion from an ISO timestamp. */
export function dateFromIso(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Parse the leading start time out of a Setup Duration label such as
 * "Daytime Work (9:00 AM - 3:00 PM)" or "Nightime Work (9:00 PM - 5:00 AM)".
 * Returns "HH:MM" 24h, or null when the label has no explicit window.
 */
export function timeFromDurationLabel(label: string | null | undefined): string | null {
  if (!label || typeof label !== "string") return null;
  const m = label.match(/\(\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2];
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mm}`;
}

export interface ProjectScheduleInput {
  startDateIso?: string | null;
  endDateIso?: string | null;
  setupDuration?: string | null;
}

/**
 * Resolve the effective START TIME for 9 AM bucketing.
 *
 * IMPORTANT (per operations, updated rule): the time MUST come from a permit
 * (Calgary SU or non-Calgary SUP). We deliberately do NOT fall back to the
 * project's Start Date / Setup Duration time — when no permit schedule is
 * available the caller should treat the time as "not available" so coordinators
 * can verify, rather than showing an inferred (possibly wrong) time.
 *
 * Returns "HH:MM" 24h from the permit, or null when no permit time is known.
 */
export function resolveStartTime(
  schedule: PermitSchedule | null | undefined,
): string | null {
  return schedule?.validFromTime ?? null;
}
