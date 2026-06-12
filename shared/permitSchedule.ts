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
 * Rule (from operations): the filename starts with "SU" (e.g. SU-26-672264-...).
 */
export function isStreetUsePermitFile(att: AttachmentLike): boolean {
  const name = (att.filename ?? "").trim();
  if (!name) return false;
  // Must be a PDF and start with "SU" (case-insensitive), optionally followed
  // by a separator like "-" or "_" or a digit. Avoid matching e.g. "Summary".
  const isPdf =
    /\.pdf$/i.test(name) || (att.type ?? "").toLowerCase().includes("pdf");
  if (!isPdf) return false;
  return /^su[\s_-]?\d/i.test(name) || /^su[\s_-]/i.test(name);
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
