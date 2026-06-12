/**
 * Pure helpers for the Dashboard "Day view" grouping.
 *
 * A job is classified relative to a target day (YYYY-MM-DD):
 *  - startingToday: Start Date == day
 *  - pickup:        End Date == day (End Date represents the pickup day)
 *  - ongoing:       multi-day job whose window strictly covers the day
 *                   (start < day < end), so it is not double-counted with
 *                   starting/pickup.
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

export function classifyJobForDay(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  day: string,
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
  if (start < day && day < end) result.ongoing = true;
  return result;
}
