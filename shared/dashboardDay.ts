/**
 * Pure helpers for the Dashboard "Day view" grouping.
 *
 * A job is classified relative to a target day (YYYY-MM-DD):
 *  - startingToday: Start Date == day
 *  - pickup:        End Date == day (End Date represents the pickup day)
 *  - ongoing:       a RECURRING (every-day) job whose window strictly covers
 *                   the day (start < day < end).
 *
 * "Ongoing (daily)" must only include jobs where signs are installed AND
 * picked up every day — i.e. the Setup Duration is a multi-day recurring
 * setup ("Daily Set Up ... (Several Days)" or "Nightly Set Up ... (Several
 * Nights)"). A 24-hour job only has a single install day and a final pickup
 * day, with nothing happening on the in-between days, so it must NOT appear in
 * the ongoing list (it still shows the day it starts and the day it is picked
 * up). Single-day daytime/night jobs are likewise excluded from ongoing.
 *
 * Dates are compared as YYYY-MM-DD strings, which sort lexicographically the
 * same as chronologically.
 */

export type DayBucket = {
  startingToday: boolean;
  ongoing: boolean;
  pickup: boolean;
};

/** Normalize an ISO-ish date string to YYYY-MM-DD (empty string if missing). */
export function dayKey(s: string | null | undefined): string {
  return (s ?? "").slice(0, 10);
}

/**
 * Whether a Setup Duration represents a recurring, install-and-pickup-every-day
 * job (the only kind that belongs in the "Ongoing (daily)" bucket).
 *
 * Matches Airtable values like:
 *   "Daily Set Up (9:00 AM - 3:00) (Several Days)"
 *   "Nightly Set Up (9:00 PM - 5:00 AM) (Several Nights)"
 *
 * Explicitly excludes "24 Hours Set Up" and single-day "Daytime Work" / single
 * "Nightime Work" options.
 */
export function isRecurringDailySetup(
  setupDuration: string | null | undefined,
): boolean {
  const v = (setupDuration ?? "").toLowerCase();
  if (/24\s*hour/.test(v)) return false;
  // "Several Days" / "Several Nights" is the explicit recurring marker.
  if (/several\s+(days|nights)/.test(v)) return true;
  // Fallback: "Daily Set Up" / "Nightly Set Up" wording also implies recurring.
  if (/daily\s+set\s*up|nightly\s+set\s*up/.test(v)) return true;
  return false;
}

export function classifyJobForDay(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  day: string,
  setupDuration?: string | null,
  subStatus?: string | null,
): DayBucket {
  const start = dayKey(startDate);
  const end = dayKey(endDate) || start;
  const result: DayBucket = {
    startingToday: false,
    ongoing: false,
    pickup: false,
  };
  if (!start) return result;
  if (start === day) result.startingToday = true;
  if (end === day) result.pickup = true;
  // Ongoing, strictly between start/end, when EITHER:
  //  - it's a recurring every-day setup (Setup Duration says Daily/Several, or
  //    sub-status is "Daily Setup (Field)"), OR
  //  - it's a 24-HOUR setup (duration or sub-status) — signs stay installed,
  //    so coordinators want it visible every day of its window (it lands in
  //    the "24 Hours" time group on the boards).
  if (
    start < day &&
    day < end &&
    (isRecurringDailySetup(setupDuration) ||
      isDailySetupSubStatus(subStatus) ||
      is24HourSetup(setupDuration, subStatus))
  ) {
    result.ongoing = true;
  }
  return result;
}

/** Whether the job is a 24-hour setup — by Setup Duration OR sub-status
 * (e.g. "24 Hours Set Up" / "24 Hours Setup (Field)"). */
export function is24HourSetup(
  setupDuration?: string | null,
  subStatus?: string | null,
): boolean {
  return /24\s*hour/i.test(setupDuration ?? "") || /24\s*hour/i.test(subStatus ?? "");
}

/**
 * Whether the Airtable "Sub-Status Field Operations" marks the job as a daily
 * setup (e.g. "Daily Setup (Field)").
 */
export function isDailySetupSubStatus(
  subStatus: string | null | undefined,
): boolean {
  return /daily\s+set\s*up/i.test(subStatus ?? "");
}

/**
 * Extract the start hour (0-23) from an Airtable "Setup Duration" string like
 * "Daytime Work (7:00 AM - 5:00 PM)" or "Daily Set Up (9:00 AM - 3:00) …".
 * Returns null when no time is present (e.g. "24 Hours Set Up").
 */
export function startHourFromSetupDuration(
  setupDuration: string | null | undefined,
): number | null {
  const s = setupDuration ?? "";
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ampm = (m[3] || "").toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h;
}

/** Time bucket for the technician-first board: before 9 / at 9 / after 9. */
export type TimeBucket = "before9" | "at9" | "after9" | "notime";
export function timeBucketFromSetupDuration(
  setupDuration: string | null | undefined,
): TimeBucket {
  const h = startHourFromSetupDuration(setupDuration);
  if (h === null) return "notime";
  if (h < 9) return "before9";
  if (h === 9) return "at9";
  return "after9";
}
