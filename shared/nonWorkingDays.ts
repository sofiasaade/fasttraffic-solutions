/**
 * Parse non-working days out of a free-text "Client message".
 *
 * Strategy (deterministic, no network):
 *  1. Look for an explicit directive line that begins with "NO WORK:" (case
 *     insensitive; "NO LABOR"/"NO LABORAR" also accepted). Everything after the
 *     colon is parsed as a comma/semicolon-separated list of tokens.
 *  2. Each token may be:
 *       - a weekday name/abbrev (Mon, Monday, Sat, weekends, weekdays)
 *       - an ISO date (YYYY-MM-DD)
 *       - an ISO date range (YYYY-MM-DD..YYYY-MM-DD or YYYY-MM-DD to YYYY-MM-DD)
 *  3. If no directive line exists, returns an empty result so callers can fall
 *     back to an LLM interpretation.
 *
 * The result describes which days are non-working, expressed both as recurring
 * weekday indices (0=Sun..6=Sat) and as explicit date keys (YYYY-MM-DD), plus a
 * human-readable reason for tooltips.
 */

export interface NonWorkingRule {
  /** Recurring weekday indices, 0=Sun..6=Sat. */
  weekdays: number[];
  /** Explicit blocked date keys (YYYY-MM-DD). */
  dates: string[];
  /** Human-readable reason (the raw directive), for tooltips. */
  reason: string | null;
  /** True when an explicit NO WORK directive was found. */
  hasDirective: boolean;
}

const EMPTY: NonWorkingRule = {
  weekdays: [],
  dates: [],
  reason: null,
  hasDirective: false,
};

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0, dom: 0, domingo: 0,
  mon: 1, monday: 1, lun: 1, lunes: 1,
  tue: 2, tues: 2, tuesday: 2, mar: 2, martes: 2,
  wed: 3, weds: 3, wednesday: 3, mie: 3, miercoles: 3, "miércoles": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, jue: 4, jueves: 4,
  fri: 5, friday: 5, vie: 5, viernes: 5,
  sat: 6, saturday: 6, sab: 6, "sábado": 6, sabado: 6,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function eachDateInRange(startKey: string, endKey: string): string[] {
  const start = new Date(`${startKey}T00:00:00Z`);
  const end = new Date(`${endKey}T00:00:00Z`);
  const out: string[] = [];
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return out;
  const cur = new Date(start);
  // Cap at 366 iterations to avoid pathological ranges.
  for (let i = 0; i <= 366 && cur <= end; i++) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Extract the directive line text (after the keyword), or null. */
function extractDirective(message: string): string | null {
  const lines = message.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*no\s*(?:work|laborar|labor)\s*:?\s*(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

export function parseNonWorkingDays(message: string | null | undefined): NonWorkingRule {
  if (!message || typeof message !== "string") return EMPTY;
  const directive = extractDirective(message);
  if (!directive) return EMPTY;

  const weekdays = new Set<number>();
  const dates = new Set<string>();

  const tokens = directive
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const lower = token.toLowerCase();

    // Aggregate shortcuts
    if (lower === "weekends" || lower === "weekend" || lower === "fines de semana") {
      weekdays.add(0);
      weekdays.add(6);
      continue;
    }
    if (lower === "weekdays" || lower === "dias de semana" || lower === "días de semana") {
      [1, 2, 3, 4, 5].forEach((d) => weekdays.add(d));
      continue;
    }

    // Date range: "YYYY-MM-DD..YYYY-MM-DD" or "... to ..."
    const rangeMatch = token.match(
      /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|–|—|-|to|hasta)\s*(\d{4}-\d{2}-\d{2})$/i,
    );
    if (rangeMatch) {
      for (const dk of eachDateInRange(rangeMatch[1], rangeMatch[2])) dates.add(dk);
      // eslint-disable-next-line no-continue
      continue;
    }

    // Single ISO date
    if (ISO_DATE.test(token)) {
      dates.add(token);
      continue;
    }

    // Weekday name/abbrev
    if (lower in WEEKDAY_MAP) {
      weekdays.add(WEEKDAY_MAP[lower]);
      continue;
    }
    // Unknown token — ignored (LLM fallback can handle complex phrasing).
  }

  const hasResult = weekdays.size > 0 || dates.size > 0;
  return {
    weekdays: Array.from(weekdays).sort((a, b) => a - b),
    dates: Array.from(dates).sort(),
    reason: directive,
    hasDirective: hasResult,
  };
}

/**
 * Given a parsed rule and a date key, return the reason it is non-working, or
 * null. `weekday` is the JS getDay() value (0=Sun..6=Sat) for that date key.
 */
export function nonWorkingReason(
  rule: NonWorkingRule,
  dateKey: string,
  weekday: number,
): string | null {
  if (!rule.hasDirective) return null;
  if (rule.dates.includes(dateKey)) return rule.reason ?? "Client: no work";
  if (rule.weekdays.includes(weekday)) return rule.reason ?? "Client: no work";
  return null;
}
