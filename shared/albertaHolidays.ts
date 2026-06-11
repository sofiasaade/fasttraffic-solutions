/**
 * Alberta statutory holidays, computed per year. Returns a map of
 * "YYYY-MM-DD" -> holiday name. Dates are treated as plain calendar dates
 * (no timezone) to match the scheduler's local day keys.
 *
 * Note: these are highlighted in the scheduler as "costlier days" — they are
 * NOT automatically marked as non-working, since some clients work holidays.
 */

/** Date key (YYYY-MM-DD) for a given year/month(1-12)/day. */
function key(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Nth weekday of a month. weekday: 0=Sun..6=Sat. n is 1-based. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  // month is 1-12
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  let day = 1 + ((weekday - firstDow + 7) % 7);
  day += (n - 1) * 7;
  return day;
}

/** Last given weekday of a month (e.g. used relative helpers). */
function weekdayOnOrBefore(year: number, month: number, day: number, weekday: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  const diff = (d.getUTCDay() - weekday + 7) % 7;
  return day - diff;
}

/** Compute Easter Sunday (Gregorian, Meeus/Jones/Butcher algorithm). */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Good Friday = Easter Sunday minus 2 days. */
function goodFriday(year: number): string {
  const easter = easterSunday(year);
  const d = new Date(Date.UTC(year, easter.month - 1, easter.day));
  d.setUTCDate(d.getUTCDate() - 2);
  return key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function albertaHolidaysForYear(year: number): Record<string, string> {
  const h: Record<string, string> = {};

  // New Year's Day — Jan 1
  h[key(year, 1, 1)] = "New Year's Day";
  // Family Day — 3rd Monday of February
  h[key(year, 2, nthWeekday(year, 2, 1, 3))] = "Family Day";
  // Good Friday — Friday before Easter Sunday
  h[goodFriday(year)] = "Good Friday";
  // Victoria Day — Monday on or before May 24
  h[key(year, 5, weekdayOnOrBefore(year, 5, 24, 1))] = "Victoria Day";
  // Canada Day — Jul 1
  h[key(year, 7, 1)] = "Canada Day";
  // Heritage Day (optional/general holiday) — 1st Monday of August
  h[key(year, 8, nthWeekday(year, 8, 1, 1))] = "Heritage Day";
  // Labour Day — 1st Monday of September
  h[key(year, 9, nthWeekday(year, 9, 1, 1))] = "Labour Day";
  // Thanksgiving — 2nd Monday of October
  h[key(year, 10, nthWeekday(year, 10, 1, 2))] = "Thanksgiving";
  // Remembrance Day — Nov 11
  h[key(year, 11, 11)] = "Remembrance Day";
  // Christmas Day — Dec 25
  h[key(year, 12, 25)] = "Christmas Day";
  // Boxing Day — Dec 26
  h[key(year, 12, 26)] = "Boxing Day";

  return h;
}

/**
 * Holidays spanning a set of years (handy when a visible week crosses Dec/Jan).
 */
export function albertaHolidaysForYears(years: number[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const y of years) Object.assign(out, albertaHolidaysForYear(y));
  return out;
}

/** Holiday name for a given date key, or null. */
export function holidayName(
  dateKey: string,
  holidays: Record<string, string>,
): string | null {
  return holidays[dateKey] ?? null;
}
