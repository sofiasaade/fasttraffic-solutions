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
  // Ongoing only for recurring every-day setups, strictly between start/end.
  if (
    start < day &&
    day < end &&
    isRecurringDailySetup(setupDuration)
  ) {
    result.ongoing = true;
  }
  return result;
}
