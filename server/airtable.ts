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
