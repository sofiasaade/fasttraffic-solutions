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

/** Extract one SU permit PDF via the LLM. Returns parsed schedule. */
async function extractOnePermit(fileUrl: string): Promise<PermitSchedule | null> {
  const resp = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the permit schedule from this Street Use Permit PDF.",
          },
          {
            type: "file_url",
            file_url: { url: fileUrl, mime_type: "application/pdf" },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "permit_schedule", strict: true, schema: PERMIT_SCHEMA },
    },
  });
  const raw = resp.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(typeof raw === "string" ? raw : "{}");
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const normDate = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Long form fallback e.g. "June 12, 2026" (in case the LLM didn't normalize).
    const m = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
      const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
    }
    return null;
  };
  const normTime = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    // 12-hour fallback e.g. "7:00 AM", "6:00 PM" (in case the LLM didn't normalize).
    const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (ampm) {
      let h = Number(ampm[1]);
      const ap = ampm[3].toUpperCase();
      if (ap === "PM" && h !== 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
      return `${String(h).padStart(2, "0")}:${ampm[2]}`;
    }
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  };
  return {
    permitNumber: typeof parsed.permitNumber === "string" ? parsed.permitNumber : null,
    validFromDate: normDate(parsed.validFromDate),
    validFromTime: normTime(parsed.validFromTime),
    validFromDay: typeof parsed.validFromDay === "string" ? parsed.validFromDay : null,
    validToDate: normDate(parsed.validToDate),
    validToTime: normTime(parsed.validToTime),
    validToDay: typeof parsed.validToDay === "string" ? parsed.validToDay : null,
    numberOfDays: Number.isInteger(parsed.numberOfDays) ? parsed.numberOfDays : null,
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
