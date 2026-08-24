import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "./db";
import {
  formSubmissions,
  safetyDefects,
  startWorkAuthorizations,
} from "../drizzle/schema";
import {
  insertFormSubmission,
  insertDefect,
  listOpenDefectsForUnit,
  releaseDefect,
  latestSubmission,
  getStartWorkAuth,
  insertStartWorkAuth,
} from "./safetyDb";
import { activeForm } from "../shared/safetyForms";

const TECH = `__SafetyTech_${Date.now()}`;
const UNIT = `__SafetyTruck_${Date.now()}`;
const DATE = "2026-08-24";

let dbAvailable = true;

async function cleanup() {
  const d = await getDb();
  if (!d) return;
  await d
    .delete(formSubmissions)
    .where(like(formSubmissions.technicianName, "__SafetyTech%"));
  await d
    .delete(safetyDefects)
    .where(like(safetyDefects.technicianName, "__SafetyTech%"));
  await d
    .delete(startWorkAuthorizations)
    .where(like(startWorkAuthorizations.technicianName, "__SafetyTech%"));
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) {
    dbAvailable = false;
    return;
  }
  await cleanup();
});

afterAll(async () => {
  if (dbAvailable) await cleanup();
});

describe("controlled forms registry", () => {
  it("knows the FTS controlled documents with version and effective date", () => {
    const f = activeForm("FTS-HZ-001B");
    expect(f?.version).toBe("V2");
    expect(f?.effectiveDate).toBe("2026-08-21");
    expect(activeForm("FTS-APP-VEH")?.version).toBe("V1");
  });
});

describe("immutable form submissions", () => {
  it("stores a full stamped copy and is idempotent on clientUuid", async () => {
    if (!dbAvailable) return;
    const uuid = `test-${Date.now()}-a`;
    const first = await insertFormSubmission({
      formNumber: "FTS-APP-SOD",
      formVersion: "V1",
      effectiveDate: "2026-08-24",
      technicianName: TECH,
      shiftDate: DATE,
      answersJson: JSON.stringify({ fitness: "fit" }),
      clientUuid: uuid,
    });
    expect(first.duplicate).toBe(false);

    // Same offline draft synced twice → SAME row, no duplicate record.
    const second = await insertFormSubmission({
      formNumber: "FTS-APP-SOD",
      formVersion: "V1",
      effectiveDate: "2026-08-24",
      technicianName: TECH,
      shiftDate: DATE,
      answersJson: JSON.stringify({ fitness: "fit" }),
      clientUuid: uuid,
    });
    expect(second.duplicate).toBe(true);
    expect(second.row.id).toBe(first.row.id);

    const latest = await latestSubmission(TECH, DATE, "FTS-APP-SOD");
    expect(latest?.formVersion).toBe("V1");
    expect(JSON.parse(latest!.answersJson).fitness).toBe("fit");
  });

  it("corrections create a NEW revision row; the original survives", async () => {
    if (!dbAvailable) return;
    const orig = await latestSubmission(TECH, DATE, "FTS-APP-SOD");
    const rev = await insertFormSubmission({
      formNumber: "FTS-APP-SOD",
      formVersion: "V1",
      effectiveDate: "2026-08-24",
      technicianName: TECH,
      shiftDate: DATE,
      answersJson: JSON.stringify({ fitness: "restriction_reported" }),
      clientUuid: `test-${Date.now()}-rev`,
      revisionOf: orig!.id,
      revisionReason: "Selected the wrong readiness option",
    });
    expect(rev.row.revisionOf).toBe(orig!.id);
    const d = await getDb();
    const rows = await d!
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.id, orig!.id));
    // Original row untouched.
    expect(JSON.parse(rows[0].answersJson).fitness).toBe("fit");
  });
});

describe("defects and DO NOT OPERATE", () => {
  it("critical defect stays open on the unit until an authorized release", async () => {
    if (!dbAvailable) return;
    const ref = await insertDefect({
      technicianName: TECH,
      date: DATE,
      unitType: "vehicle",
      unitName: UNIT,
      category: "operation",
      itemKey: "brakes",
      severity: "critical",
      description: "Brake pedal goes to the floor",
      taggedOut: true,
      supervisorNotified: true,
      status: "open",
    });
    expect(ref).toMatch(/^CA-\d{4}$/);

    const open = await listOpenDefectsForUnit(UNIT);
    expect(open.some((o) => o.severity === "critical")).toBe(true);

    // Authorized release clears the block.
    const row = open.find((o) => o.severity === "critical")!;
    await releaseDefect(row.id, "Coordinator", "Brake line replaced, road-tested");
    const after = await listOpenDefectsForUnit(UNIT);
    expect(after.length).toBe(0);
  });
});

describe("start-work authorization", () => {
  it("records one immutable authorization per tech/job/date", async () => {
    if (!dbAvailable) return;
    const JOB = "test-safety-job";
    expect(await getStartWorkAuth(TECH, DATE, JOB)).toBeNull();
    await insertStartWorkAuth({
      airtableJobId: JOB,
      technicianName: TECH,
      date: DATE,
      snapshotJson: JSON.stringify({ ok: true }),
    });
    const auth = await getStartWorkAuth(TECH, DATE, JOB);
    expect(auth).not.toBeNull();
    const d = await getDb();
    await d!
      .delete(startWorkAuthorizations)
      .where(eq(startWorkAuthorizations.airtableJobId, JOB));
  });
});
