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
import { pickPlans } from "../shared/planDocs";

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
/**
 * Positional extraction (preferred): read the PDF's text WITH x/y coordinates
 * and reconstruct the Calgary "Permit Valid From / To" table row by row. The
 * flat text stream scrambles column order; positions never lie.
 */
async function extractByPosition(
  buf: Uint8Array,
): Promise<PermitSchedule | null> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = (tc.items as any[])
        .map((i) => ({
          s: String(i.str ?? "").trim(),
          x: Math.round(i.transform[4]),
          y: Math.round(i.transform[5]),
        }))
        .filter((i) => i.s);
      const anchorFrom = items.find((i) => /Permit\s*Valid\s*From/i.test(i.s));
      if (!anchorFrom) continue;
      const anchorTo = items.find((i) => /Permit\s*Valid\s*To/i.test(i.s));

      // The VALUES live in the row just below each anchor/header row (~16pt).
      const rowBelow = (y: number) =>
        items.filter((i) => i.y < y - 4 && i.y >= y - 26);
      const pick = (row: typeof items) => ({
        date:
          row.find((i) => /^\d{4}[-\/]\d{2}[-\/]\d{2}$/.test(i.s))?.s ?? null,
        time: row.find((i) => /^\d{1,2}:\d{2}$/.test(i.s))?.s ?? null,
        day:
          row.find((i) =>
            /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(
              i.s,
            ),
          )?.s ?? null,
      });
      const from = pick(rowBelow(anchorFrom.y));
      const to = anchorTo ? pick(rowBelow(anchorTo.y)) : { date: null, time: null, day: null };
      if (!from.date && !to.date) continue;

      const all = items.map((i) => i.s).join(" ");
      const permitNumber =
        all.match(/\b([A-Z]{2,3}-\d{2}-\d{4,})\b/)?.[1] ?? null;
      const nd = all.match(/Number\s*Of\s*Days[\s\S]{0,60}?(\d{1,3})\b/i);

      return {
        permitNumber,
        validFromDate: from.date ? normDate(from.date) : null,
        validFromTime: from.time ? normTime(from.time) : null,
        validFromDay: from.day,
        validToDate: to.date ? normDate(to.date) : null,
        validToTime: to.time ? normTime(to.time) : null,
        validToDay: to.day,
        numberOfDays: nd ? Number(nd[1]) : null,
      };
    }
    return null;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

async function extractOnePermit(fileUrl: string): Promise<PermitSchedule | null> {
  const { PDFParse } = await import("pdf-parse");
  const buf = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());

  // Positional table read first — exact for the Calgary Street Use form.
  try {
    const positional = await extractByPosition(new Uint8Array(buf));
    if (positional && (positional.validFromDate || positional.validToDate)) {
      return positional;
    }
  } catch {
    // fall through to the flat-text heuristic
  }

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
 * "JUL 29" (no year) -> ISO date. The TMP setup block omits the year, so pick
 * the year that puts the date within ±6 months of today.
 */
function monthDayToIso(mon: string, day: string | number): string | null {
  const m = MONTHS[mon.slice(0, 3).toLowerCase()];
  const d = Number(day);
  if (!m || !d || d > 31) return null;
  const now = new Date();
  let year = now.getFullYear();
  const mk = (y: number) => new Date(y, Number(m) - 1, d);
  const HALF_YEAR = 183 * 24 * 3600 * 1000;
  if (mk(year).getTime() - now.getTime() > HALF_YEAR) year -= 1;
  else if (now.getTime() - mk(year).getTime() > HALF_YEAR) year += 1;
  return `${year}-${m}-${String(d).padStart(2, "0")}`;
}

const WEEKDAY_RE =
  /(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)/i;

/** Parse one "SETUP: WEDNESDAY 12:00 JUL 29" style line from the TMP. */
function parsePlanLine(line: string): {
  day: string | null;
  time: string | null;
  date: string | null;
} | null {
  const time = line.match(/\b(\d{1,2}:\d{2})\b/);
  if (!time) return null;
  // Unfilled template blocks read "00:00 JAN 00" — not a real schedule.
  if (time[1] === "00:00") return null;
  const day = line.match(WEEKDAY_RE);
  const md = line.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b(?!:)/g) ?? [];
  // Last "MON DD" token that is a real month (skips the weekday word).
  let date: string | null = null;
  for (const tok of md) {
    const m = tok.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})/);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
      date = monthDayToIso(m[1], m[2]);
    }
  }
  return { day: day ? day[1] : null, time: normTime(time[1]), date };
}

/**
 * Traffic Management Plan fallback: FTS plans carry a "SETUP INFORMATION"
 * block (SETUP: <weekday> <HH:MM> <MON DD> / PICKUP: …). Used when the job has
 * no readable Street Use permit. Reads text positionally (same-row items) with
 * a flat-text fallback.
 */
async function extractPlanSetup(fileUrl: string): Promise<PermitSchedule | null> {
  const buf = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());

  // Positional pass: join items sharing a row (y) so columns read left→right.
  let setupLine: string | null = null;
  let pickupLine: string | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    for (let p = 1; p <= doc.numPages && !setupLine; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = (tc.items as any[])
        .filter((i) => typeof i.str === "string" && i.str.trim())
        .map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
      const rowOf = (y: number) =>
        items
          .filter((i) => Math.abs(i.y - y) < 4)
          .sort((a, b) => a.x - b.x)
          .map((i) => i.s)
          .join(" ");
      const sa = items.find((i) => /^SET\s*-?\s*UP\s*:|^SETUP\s*:/i.test(i.s));
      if (sa) setupLine = rowOf(sa.y);
      const pa = items.find((i) => /^PICK\s*-?\s*UP\s*:|^PICKUP\s*:/i.test(i.s));
      if (pa) pickupLine = rowOf(pa.y);
    }
  } catch {
    // fall through to flat text
  }

  if (!setupLine) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const text = (await parser.getText()).text ?? "";
    const i = text.search(/SETUP\s*INFORMATION/i);
    const win = i >= 0 ? text.slice(i, i + 500) : text;
    const s = win.match(/SET\s*-?\s*UP\s*:?[^\n]{0,80}/i);
    const p = win.match(/PICK\s*-?\s*UP\s*:?[^\n]{0,80}/i);
    setupLine = s ? s[0] : null;
    pickupLine = p ? p[0] : null;
  }

  const setup = setupLine ? parsePlanLine(setupLine) : null;
  const pickup = pickupLine ? parsePlanLine(pickupLine) : null;
  if (!setup && !pickup) return null;

  return {
    permitNumber: null,
    validFromDate: setup?.date ?? null,
    validFromTime: setup?.time ?? null,
    validFromDay: setup?.day ?? null,
    validToDate: pickup?.date ?? null,
    validToTime: pickup?.time ?? null,
    validToDay: pickup?.day ?? null,
    numberOfDays: null,
  };
}

/**
 * Cached plan-fallback schedule for a job. Rows share the permit_extractions
 * cache, keyed by a "plan:"-prefixed filename so they never collide with real
 * permit rows.
 */
async function planFallbackSchedule(
  jobId: string,
  attachments: AttachmentLike[] | null | undefined,
  cachedByName: Map<string, PermitExtractionRow>,
): Promise<PermitSchedule | null> {
  // Only PDF plans carry the SETUP INFORMATION block — skip images etc.
  const plan = (
    pickPlans((attachments ?? []) as { filename?: string | null }[]) as AttachmentLike[]
  ).find((p) => /\.pdf$/i.test(p.filename ?? ""));
  if (!plan?.url) return null;
  const name = `plan:${plan.filename ?? plan.url}`;
  const hit = cachedByName.get(name);
  if (hit) return hit.parseStatus === "ok" ? rowToSchedule(hit) : null;
  try {
    const sched = await extractPlanSetup(plan.url);
    if (sched && (sched.validFromTime || sched.validFromDate)) {
      await upsertPermitExtraction({
        airtableJobId: jobId,
        filename: name,
        fileUrl: plan.url,
        permitNumber: null,
        validFromDate: sched.validFromDate ?? null,
        validFromTime: sched.validFromTime ?? null,
        validFromDay: sched.validFromDay ?? null,
        validToDate: sched.validToDate ?? null,
        validToTime: sched.validToTime ?? null,
        validToDay: sched.validToDay ?? null,
        numberOfDays: null,
        parseStatus: "ok",
        rawJson: JSON.stringify(sched),
      });
      return sched;
    }
    await upsertPermitExtraction({
      airtableJobId: jobId,
      filename: name,
      fileUrl: plan.url,
      parseStatus: "error",
    });
    return null;
  } catch {
    await upsertPermitExtraction({
      airtableJobId: jobId,
      filename: name,
      fileUrl: plan.url,
      parseStatus: "error",
    });
    return null;
  }
}

/** Fill schedule holes (time/date/day) from the plan-derived schedule. */
function mergeWithPlan(
  sched: PermitSchedule | null | undefined,
  plan: PermitSchedule | null,
): PermitSchedule | null {
  if (!plan) return sched ?? null;
  if (!sched) return plan;
  return {
    ...sched,
    validFromDate: sched.validFromDate ?? plan.validFromDate,
    validFromTime: sched.validFromTime ?? plan.validFromTime,
    validFromDay: sched.validFromDay ?? plan.validFromDay,
    validToDate: sched.validToDate ?? plan.validToDate,
    validToTime: sched.validToTime ?? plan.validToTime,
    validToDay: sched.validToDay ?? plan.validToDay,
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

  const cacheMap = await getPermitExtractionsMap([jobId]);
  const cached = cacheMap.get(jobId) ?? [];
  const cachedByName = new Map(cached.map((r) => [r.filename, r]));

  if (permits.length === 0) {
    // No SU permit at all: the TMP setup block is the only schedule source.
    return planFallbackSchedule(jobId, attachments, cachedByName);
  }

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
  const bestName = best ? (best.filename ?? best.url) : null;
  const sched = bestName ? (schedules[bestName] ?? null) : null;
  if (sched?.validFromTime) return sched;
  // Permit unreadable or missing its start time: fill from the TMP setup block.
  return mergeWithPlan(
    sched,
    await planFallbackSchedule(jobId, attachments, cachedByName),
  );
}

/**
 * Batch variant for many jobs. Reads cache once; only calls the LLM for
 * uncached SU permits. Returns a map jobId -> best PermitSchedule.
 */
export async function getPermitSchedulesForJobs(
  jobs: { id: string; planFile: AttachmentLike[] | null | undefined }[],
): Promise<Map<string, PermitSchedule>> {
  const result = new Map<string, PermitSchedule>();
  const withDocs = jobs
    .map((j) => ({
      id: j.id,
      planFile: j.planFile,
      permits: selectStreetUsePermits(j.planFile),
    }))
    .filter((j) => j.permits.length > 0 || (j.planFile?.length ?? 0) > 0);
  if (withDocs.length === 0) return result;

  const ids = withDocs.map((j) => j.id);
  const cacheMap = await getPermitExtractionsMap(ids);

  for (const { id, permits, planFile } of withDocs) {
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
    const bestName = best ? (best.filename ?? best.url) : null;
    let sched = bestName ? (schedules[bestName] ?? null) : null;
    if (!sched?.validFromTime) {
      // Permit unreadable or missing a start time: TMP setup block fallback.
      sched = mergeWithPlan(
        sched,
        await planFallbackSchedule(id, planFile, cachedByName),
      );
    }
    if (sched) result.set(id, sched);
  }

  return result;
}
