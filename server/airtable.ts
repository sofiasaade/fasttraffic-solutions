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

export async function updateJobFields(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<JobRecord> {
  const data = await airtableFetch(`${baseUrl()}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  });
  return mapRecordToJob(data);
}

// Append a string to a multiline text field, preserving existing content.
export async function appendToTextField(
  recordId: string,
  fieldName: string,
  textToAppend: string,
): Promise<JobRecord> {
  const current = await airtableFetch(`${baseUrl()}/${recordId}`);
  const existing = asString(current.fields?.[fieldName]) ?? "";
  const combined = existing ? `${existing}\n${textToAppend}` : textToAppend;
  return updateJobFields(recordId, { [fieldName]: combined });
}

// Append attachments to a multipleAttachments field (e.g. Field Photos), keeping existing ones.
export async function appendAttachments(
  recordId: string,
  fieldName: string,
  newAttachments: { url: string; filename?: string }[],
): Promise<JobRecord> {
  const current = await airtableFetch(`${baseUrl()}/${recordId}`);
  const existing = Array.isArray(current.fields?.[fieldName])
    ? current.fields[fieldName].map((a: any) => ({
        url: a.url,
        filename: a.filename,
      }))
    : [];
  const combined = [...existing, ...newAttachments];
  return updateJobFields(recordId, { [fieldName]: combined });
}

export async function pingAirtable(): Promise<{ ok: boolean; count: number }> {
  const params = new URLSearchParams();
  params.set("pageSize", "1");
  const data = await airtableFetch(`${baseUrl()}?${params.toString()}`);
  return { ok: true, count: (data.records ?? []).length };
}
