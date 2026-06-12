import { ENV } from "./_core/env";
import {
  AF,
  AirtableAttachment,
  DISPATCH_STATUSES,
  MAP_STATUSES,
  JobRecord,
} from "../shared/airtableFields";

const API_BASE = "https://api.airtable.com/v0";

function authHeaders() {
  return {
    Authorization: `Bearer ${ENV.airtableApiKey}`,
    "Content-Type": "application/json",
  };
}

function baseUrl() {
  return `${API_BASE}/${ENV.airtableBaseId}/${ENV.airtableJobsTableId}`;
}

export class AirtableError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AirtableError";
  }
}

async function airtableFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AirtableError(res.status, `Airtable ${res.status}: ${text}`);
  }
  return res.json();
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)))
    return Number(v);
  return null;
}

function asMultiSelect(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : null))
      .filter((x): x is string => x !== null && x !== "None");
  }
  return [];
}

// Single emoji matcher (one pictographic grapheme incl. surrogate pairs,
// variation selectors and ZWJ sequences) without relying on the `u` flag's
// Unicode property escapes (which require a newer TS target).
const EMOJI_TOKEN =
  /(?:[\u2600-\u27BF\u2B00-\u2BFF\u2190-\u21FF]|[\uD83C-\uDBFF][\uDC00-\uDFFF])(?:\uFE0F|\u20E3|\u200D(?:[\u2600-\u27BF]|[\uD83C-\uDBFF][\uDC00-\uDFFF]))*/;

// Extract the leading run of emojis from a string such as the "Calendar info"
// field (values often start with one or more emojis, e.g. "📌 🚨 Company...").
// Returns the joined emoji prefix, or null when none are present.
function extractEmoji(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const run = new RegExp(`^\\s*(?:${EMOJI_TOKEN.source}\\s*)+`);
  const m = v.match(run);
  if (!m) return null;
  const emojis = m[0].match(new RegExp(EMOJI_TOKEN.source, "g"));
  return emojis ? emojis.join(" ") : null;
}

// Join a multi-select Airtable value into a single display string.
function asJoined(v: unknown, sep = " · "): string | null {
  if (Array.isArray(v)) {
    const parts = v.filter((x): x is string => typeof x === "string" && x !== "None");
    return parts.length ? parts.join(sep) : null;
  }
  if (typeof v === "string") return v || null;
  return null;
}

function asAttachments(v: unknown): AirtableAttachment[] {
  if (Array.isArray(v)) {
    return v.map((a: any) => ({
      id: a.id,
      url: a.url,
      filename: a.filename,
      type: a.type,
      thumbnails: a.thumbnails,
    }));
  }
  return [];
}

export function mapRecordToJob(record: any): JobRecord {
  const f = record.fields ?? {};
  return {
    id: record.id,
    company: asString(f[AF.company]),
    jobAddress: asString(f[AF.jobAddress]),
    projectTitle: asString(f[AF.projectTitle]),
    startDate: asString(f[AF.startDate]),
    endDate: asString(f[AF.endDate]),
    setupDuration: asString(f[AF.setupDuration]),
    status: asString(f[AF.status]),
    subStatus: asString(f[AF.subStatus]),
    requestId: asString(f[AF.requestId]),
    municipality: asString(f[AF.municipality]),
    lat: asNumber(f[AF.lat]),
    lon: asNumber(f[AF.lon]),
    siteContactPhone: asString(f[AF.siteContactPhone]),
    requestorName: asString(f[AF.requestorName]),
    techPrep: asMultiSelect(f[AF.techPrep]),
    techSetup: asMultiSelect(f[AF.techSetup]),
    techPickup: asMultiSelect(f[AF.techPickup]),
    planFile: asAttachments(f[AF.planFile]),
    fieldPhotos: asAttachments(f[AF.fieldPhotos]),
    fieldComments: asString(f[AF.fieldComments]),
    closureType: asJoined(f[AF.closureType]),
    impact: asString(f[AF.impact]),
    calendarInfo: asString(f[AF.calendarInfo]),
    emoji: extractEmoji(f[AF.calendarInfo]),
    clientMessage: asString(f[AF.clientMessage]),
    signsCount: asString(f[AF.signsCount]),
  };
}

// Escape a value for an Airtable formula string literal.
function escapeFormulaValue(v: string): string {
  return v.replace(/'/g, "\\'");
}

// Fetch all dispatch-relevant jobs (Status = Field OR Permit Approved).
export async function fetchDispatchJobs(): Promise<JobRecord[]> {
  const statusClauses = DISPATCH_STATUSES.map(
    (s) => `{${AF.status}}='${escapeFormulaValue(s)}'`,
  ).join(",");
  const formula = `OR(${statusClauses})`;

  const records: any[] = [];
  let offset: string | undefined = undefined;

  do {
    const params = new URLSearchParams();
    params.set("filterByFormula", formula);
    params.set("pageSize", "100");
    if (offset) params.set("offset", offset);

    const data: any = await airtableFetch(`${baseUrl()}?${params.toString()}`);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records.map(mapRecordToJob);
}

// Fetch jobs for the Permit Map (Status = Field, Permit Approved, or Permit Request Submitted).
export async function fetchMapJobs(): Promise<JobRecord[]> {
  const statusClauses = MAP_STATUSES.map(
    (s) => `{${AF.status}}='${escapeFormulaValue(s)}'`,
  ).join(",");
  const formula = `OR(${statusClauses})`;

  const records: any[] = [];
  let offset: string | undefined = undefined;

  do {
    const params = new URLSearchParams();
    params.set("filterByFormula", formula);
    params.set("pageSize", "100");
    if (offset) params.set("offset", offset);

    const data: any = await airtableFetch(`${baseUrl()}?${params.toString()}`);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records.map(mapRecordToJob);
}

export async function fetchJobById(recordId: string): Promise<JobRecord> {
  const data = await airtableFetch(`${baseUrl()}/${recordId}`);
  return mapRecordToJob(data);
}

// Fetch only jobs that contain a given technician in any phase field.
export async function fetchJobsForTechnician(
  technician: string,
): Promise<JobRecord[]> {
  const t = escapeFormulaValue(technician);
  // FIND on the comma-joined multi-select string (ARRAYJOIN).
  const formula = `OR(FIND('${t}', ARRAYJOIN({${AF.techPrep}})), FIND('${t}', ARRAYJOIN({${AF.techSetup}})), FIND('${t}', ARRAYJOIN({${AF.techPickup}})))`;

  const records: any[] = [];
  let offset: string | undefined = undefined;
  do {
    const params = new URLSearchParams();
    params.set("filterByFormula", formula);
    params.set("pageSize", "100");
    if (offset) params.set("offset", offset);
    const data: any = await airtableFetch(`${baseUrl()}?${params.toString()}`);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records.map(mapRecordToJob);
}

/**
 * READ-ONLY MODE.
 *
 * Per the operator's explicit instruction, this application must NOT write
 * anything back to Airtable until told otherwise. Airtable is the read-only
 * source of base job data; all operations data (assignments, time logs,
 * hazard assessments, notes, photos, change history) lives in the local DB.
 *
 * These write helpers are intentionally disabled. If any code path calls
 * them, it throws loudly so the read-only guarantee can never be violated
 * silently. To re-enable writes later, restore the PATCH implementations.
 */
export const AIRTABLE_READ_ONLY = true;

export async function updateJobFields(
  _recordId: string,
  _fields: Record<string, unknown>,
): Promise<JobRecord> {
  throw new AirtableError(
    403,
    "Airtable is in READ-ONLY mode: writes are disabled. Operations data is stored locally.",
  );
}

export async function appendToTextField(
  _recordId: string,
  _fieldName: string,
  _textToAppend: string,
): Promise<JobRecord> {
  throw new AirtableError(
    403,
    "Airtable is in READ-ONLY mode: writes are disabled. Operations data is stored locally.",
  );
}

export async function appendAttachments(
  _recordId: string,
  _fieldName: string,
  _newAttachments: { url: string; filename?: string }[],
): Promise<JobRecord> {
  throw new AirtableError(
    403,
    "Airtable is in READ-ONLY mode: writes are disabled. Operations data is stored locally.",
  );
}

export async function pingAirtable(): Promise<{ ok: boolean; count: number }> {
  const params = new URLSearchParams();
  params.set("pageSize", "1");
  const data = await airtableFetch(`${baseUrl()}?${params.toString()}`);
  return { ok: true, count: (data.records ?? []).length };
}

// Fetch ALL jobs (any status) for change detection. Includes cancelled/declined
// so the diff engine can detect cancellations. No status filter applied.
export async function fetchAllJobsForDetection(): Promise<JobRecord[]> {
  const records: any[] = [];
  let offset: string | undefined = undefined;

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    if (offset) params.set("offset", offset);

    const data: any = await airtableFetch(`${baseUrl()}?${params.toString()}`);
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records.map(mapRecordToJob);
}
