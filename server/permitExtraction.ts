// Server-side Street Use Permit (SU) PDF extraction.
//
// Given a job's plan-file attachments, find the SU permit PDF(s), extract the
// schedule fields (Permit Valid From/To date+time+day, permit number, number of
// days) via the LLM, and cache the result by (jobId + filename) so we never
// re-analyze the same PDF.

import { invokeLLM } from "./_core/llm";
import {
  getPermitExtractionsMap,
  upsertPermitExtraction,
  type PermitExtractionRow,
} from "./opsDb";
import {
  selectStreetUsePermits,
  pickMostCurrentPermit,
  type AttachmentLike,
  type PermitSchedule,
} from "../shared/permitSchedule";

function rowToSchedule(r: PermitExtractionRow): PermitSchedule {
  return {
    permitNumber: r.permitNumber,
    validFromDate: r.validFromDate,
    validFromTime: r.validFromTime,
    validFromDay: r.validFromDay,
    validToDate: r.validToDate,
    validToTime: r.validToTime,
    validToDay: r.validToDay,
    numberOfDays: r.numberOfDays,
  };
}

const PERMIT_SCHEMA = {
  type: "object",
  properties: {
    permitNumber: { type: ["string", "null"] },
    validFromDate: {
      type: ["string", "null"],
      description: "Permit Valid From date as YYYY-MM-DD",
    },
    validFromTime: {
      type: ["string", "null"],
      description: "Permit Valid From time as HH:MM 24-hour",
    },
    validFromDay: { type: ["string", "null"] },
    validToDate: {
      type: ["string", "null"],
      description: "Permit Valid To date as YYYY-MM-DD",
    },
    validToTime: {
      type: ["string", "null"],
      description: "Permit Valid To time as HH:MM 24-hour",
    },
    validToDay: { type: ["string", "null"] },
    numberOfDays: { type: ["integer", "null"] },
  },
  required: [
    "permitNumber",
    "validFromDate",
    "validFromTime",
    "validFromDay",
    "validToDate",
    "validToTime",
    "validToDay",
    "numberOfDays",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT =
  "You read STREET USE PERMIT PDFs from Alberta municipalities and extract the " +
  "work schedule. Permits come in two layouts: \n" +
  "1) City of Calgary: rows labeled 'Permit Valid From' and 'Permit Valid To', " +
  "each with a Date, a Time (24 hrs) and a Day Of Week. Permit Number looks like " +
  "SU-26-672264.\n" +
  "2) Town of Cochrane / other towns (Schedule D): boxes labeled 'PERMIT FROM:' " +
  "and 'PERMIT TO:', each with a Date (often long form like 'June 12, 2026') and " +
  "a Time (often 12-hour like '7:00 AM'). Permit Number may look like '2026-15'. " +
  "A 'SETUP INFORMATION' block on the plan page may also show START/END times.\n\n" +
  "Always NORMALIZE the output: dates as YYYY-MM-DD, times as HH:MM 24-hour " +
  "(e.g. '7:00 AM' -> 07:00, '6:00 PM' -> 18:00, '9:00 PM' -> 21:00). " +
  "validFrom = work START; validTo = work END / pickup. Extract the Permit " +
  "Number and Number Of Days when present. If a value is missing, return null " +
  "for it. Return JSON only.";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function normDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  const iso = s.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Long form e.g. "June 12, 2026" / "Jul 27 2026"
  const m = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
  }
  return null;
}
function normTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  const ampm = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const ap = ampm[3].toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${ampm[2]}`;
  }
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Extract one SU permit PDF by READING ITS TEXT — free, no AI/API key.
 *  1. Calgary layout: the "Permit Valid From / Permit Valid To" table.
 *  2. Other municipalities: generic date+time patterns near "valid/from/
 *     start/effective" keywords.
 * Scanned (image-only) PDFs return null gracefully.
 */
async function extractOnePermit(fileUrl: string): Promise<PermitSchedule | null> {
  const { PDFParse } = await import("pdf-parse");
  const buf = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const text = (await parser.getText()).text ?? "";
  if (text.trim().length < 50) return null; // image-only scan — nothing to read

  const permitNumber =
    text.match(/\b([A-Z]{2,3}-\d{2}-\d{4,})\b/)?.[1] ?? null;

  const DAY_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g;
  const DATE_RE = /\d{4}[-\/]\d{2}[-\/]\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/g;
  const TIME_RE = /\b\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\b/gi;

  // 1) Calgary table layout: the "Permit Valid From/To" block, cut at "CHARGE"
  //    so rush-hour restriction ranges further down don't pollute the times.
  const i = text.search(/Permit\s*Valid\s*From/i);
  let win = "";
  if (i >= 0) {
    const end = text.indexOf("CHARGE", i);
    win = text.slice(i, end > i ? Math.min(end, i + 800) : i + 500);
  }

  // 2) Fallback for other municipalities: window around valid/start keywords.
  if (!win) {
    const k = text.search(/\b(valid|effective|start(?:s|ing)?|from)\b/i);
    win = k >= 0 ? text.slice(Math.max(0, k - 100), k + 700) : text.slice(0, 900);
  }

  const dates = (win.match(DATE_RE) ?? []).map((d) => normDate(d)).filter(Boolean) as string[];
  const times = (win.match(TIME_RE) ?? []).map((t) => normTime(t)).filter(Boolean) as string[];
  const days = win.match(DAY_RE) ?? [];

  if (dates.length === 0 && times.length === 0) return null;

  // Calgary quirk: when the table shows only ONE time it is the *Valid To*
  // time; the daily START hour lives in the "Traffic Control Setup" section
  // as a standalone time (ranges like "15:00 - 18:00 …" are restrictions).
  let fromTime: string | null = null;
  let toTime: string | null = null;
  if (times.length >= 2) {
    fromTime = times[0];
    toTime = times[1];
  } else if (times.length === 1) {
    toTime = times[0];
  }
  if (!fromTime) {
    const s = text.search(/Traffic\s*Control\s*Setup/i);
    if (s >= 0) {
      const setupWin = text
        .slice(s, s + 400)
        // strip "HH:MM - HH:MM …" restriction ranges before matching
        .replace(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g, " ");
      const t = setupWin.match(/\b\d{1,2}:\d{2}\b/);
      if (t) fromTime = normTime(t[0]);
    }
  }

  return {
    permitNumber,
    validFromDate: dates[0] ?? null,
    validFromTime: fromTime,
    validFromDay: days[0] ?? null,
    validToDate: dates[1] ?? dates[0] ?? null,
    validToTime: toTime,
    validToDay: days[1] ?? days[0] ?? null,
    numberOfDays: (() => {
      const m = win.match(/Number\s*Of\s*Days[\s\S]{0,60}?(\d{1,3})/i);
      return m ? Number(m[1]) : null;
    })(),
  };
}

/**
 * For one job: select SU permits, extract any that are not yet cached, and
 * return the schedule of the most-current permit (or null if none).
 */
export async function getJobPermitSchedule(
  jobId: string,
  attachments: AttachmentLike[] | null | undefined,
): Promise<PermitSchedule | null> {
  const permits = selectStreetUsePermits(attachments);
  if (permits.length === 0) return null;

  const cacheMap = await getPermitExtractionsMap([jobId]);
  const cached = cacheMap.get(jobId) ?? [];
  const cachedByName = new Map(cached.map((r) => [r.filename, r]));

  const schedules: Record<string, PermitSchedule | undefined> = {};
  for (const p of permits) {
    const name = p.filename ?? p.url;
    const hit = cachedByName.get(name);
    if (hit) {
      schedules[name] = rowToSchedule(hit);
      continue;
    }
    try {
      const sched = await extractOnePermit(p.url);
      if (sched) {
        await upsertPermitExtraction({
          airtableJobId: jobId,
          filename: name,
          fileUrl: p.url,
          permitNumber: sched.permitNumber ?? null,
          validFromDate: sched.validFromDate ?? null,
          validFromTime: sched.validFromTime ?? null,
          validFromDay: sched.validFromDay ?? null,
          validToDate: sched.validToDate ?? null,
          validToTime: sched.validToTime ?? null,
          validToDay: sched.validToDay ?? null,
          numberOfDays: sched.numberOfDays ?? null,
          parseStatus: "ok",
          rawJson: JSON.stringify(sched),
        });
        schedules[name] = sched;
      }
    } catch {
      // Cache the failure so we don't hammer the LLM on every refresh.
      await upsertPermitExtraction({
        airtableJobId: jobId,
        filename: name,
        fileUrl: p.url,
        parseStatus: "error",
      });
      schedules[name] = undefined;
    }
  }

  const best = pickMostCurrentPermit(permits, schedules);
  if (!best) return null;
  const bestName = best.filename ?? best.url;
  return schedules[bestName] ?? null;
}

/**
 * Batch variant for many jobs. Reads cache once; only calls the LLM for
 * uncached SU permits. Returns a map jobId -> best PermitSchedule.
 */
export async function getPermitSchedulesForJobs(
  jobs: { id: string; planFile: AttachmentLike[] | null | undefined }[],
): Promise<Map<string, PermitSchedule>> {
  const result = new Map<string, PermitSchedule>();
  const withPermits = jobs
    .map((j) => ({ id: j.id, permits: selectStreetUsePermits(j.planFile) }))
    .filter((j) => j.permits.length > 0);
  if (withPermits.length === 0) return result;

  const ids = withPermits.map((j) => j.id);
  const cacheMap = await getPermitExtractionsMap(ids);

  for (const { id, permits } of withPermits) {
    const cached = cacheMap.get(id) ?? [];
    const cachedByName = new Map(cached.map((r) => [r.filename, r]));
    const schedules: Record<string, PermitSchedule | undefined> = {};

    for (const p of permits) {
      const name = p.filename ?? p.url;
      const hit = cachedByName.get(name);
      if (hit) {
        schedules[name] = hit.parseStatus === "ok" ? rowToSchedule(hit) : undefined;
        continue;
      }
      try {
        const sched = await extractOnePermit(p.url);
        if (sched) {
          await upsertPermitExtraction({
            airtableJobId: id,
            filename: name,
            fileUrl: p.url,
            permitNumber: sched.permitNumber ?? null,
            validFromDate: sched.validFromDate ?? null,
            validFromTime: sched.validFromTime ?? null,
            validFromDay: sched.validFromDay ?? null,
            validToDate: sched.validToDate ?? null,
            validToTime: sched.validToTime ?? null,
            validToDay: sched.validToDay ?? null,
            numberOfDays: sched.numberOfDays ?? null,
            parseStatus: "ok",
            rawJson: JSON.stringify(sched),
          });
          schedules[name] = sched;
        }
      } catch {
        await upsertPermitExtraction({
          airtableJobId: id,
          filename: name,
          fileUrl: p.url,
          parseStatus: "error",
        });
        schedules[name] = undefined;
      }
    }

    const best = pickMostCurrentPermit(permits, schedules);
    if (best) {
      const bestName = best.filename ?? best.url;
      const sched = schedules[bestName];
      if (sched) result.set(id, sched);
    }
  }

  return result;
}
