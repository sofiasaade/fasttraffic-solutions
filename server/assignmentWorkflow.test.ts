import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { getDb } from "./db";
import { jobAssignments } from "../drizzle/schema";
import {
  setPhaseAssignments,
  setScheduledAssignment,
  setAssignmentStatus,
  setJobAssignmentsStatus,
  getAssignmentStatusMap,
  getAssignmentById,
  listJobIdsForTechnician,
} from "./opsDb";

// Unique, namespaced ids so this test never collides with real Airtable jobs
// and can be fully cleaned up afterwards.
const JOB = `test-confirm-${Date.now()}`;
const TECH_A = `__TestTechA_${Date.now()}`;
const TECH_B = `__TestTechB_${Date.now()}`;
const actor = { userId: undefined, name: "Test Coordinator" };

let dbAvailable = true;

async function cleanup() {
  const d = await getDb();
  if (!d) return;
  await d.delete(jobAssignments).where(eq(jobAssignments.airtableJobId, JOB));
  // Defensive: scrub any rows from our synthetic technicians.
  await d
    .delete(jobAssignments)
    .where(like(jobAssignments.technicianName, "__TestTech%"));
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

describe("assignment confirmation workflow (opsDb)", () => {
  it("assigns technicians as TENTATIVE by default (no auto-confirm)", async () => {
    if (!dbAvailable) return;
    await setPhaseAssignments(JOB, "setup", [TECH_A, TECH_B], actor);

    const map = await getAssignmentStatusMap([JOB]);
    const entry = map.get(JOB);
    expect(entry).toBeTruthy();
    expect(entry!.total).toBe(2);
    expect(entry!.confirmed).toBe(0);
    expect(entry!.tentative).toBe(2);
    expect(entry!.byTech[TECH_A]).toBe("tentative");
  });

  it("hides tentative assignments from the technician's job list", async () => {
    if (!dbAvailable) return;
    const jobsForA = await listJobIdsForTechnician(TECH_A);
    expect(jobsForA.has(JOB)).toBe(false);
  });

  it("confirming a job makes it visible to the technician", async () => {
    if (!dbAvailable) return;
    const before = await setJobAssignmentsStatus(JOB, "confirmed", actor.name);
    // Returns the rows BEFORE the change so the router can pick newly-confirmed.
    expect(before.every((r) => r.status !== "confirmed")).toBe(true);

    const map = await getAssignmentStatusMap([JOB]);
    expect(map.get(JOB)!.confirmed).toBe(2);

    const jobsForA = await listJobIdsForTechnician(TECH_A);
    expect(jobsForA.has(JOB)).toBe(true);
    expect(jobsForA.get(JOB)).toContain("setup");
  });

  it("reverting a job to tentative hides it again (no notification path)", async () => {
    if (!dbAvailable) return;
    await setJobAssignmentsStatus(JOB, "tentative", actor.name);
    const map = await getAssignmentStatusMap([JOB]);
    expect(map.get(JOB)!.confirmed).toBe(0);
    const jobsForA = await listJobIdsForTechnician(TECH_A);
    expect(jobsForA.has(JOB)).toBe(false);
  });

  it("confirming a single row only affects that technician", async () => {
    if (!dbAvailable) return;
    const d = await getDb();
    const rows = await d!
      .select()
      .from(jobAssignments)
      .where(
        and(
          eq(jobAssignments.airtableJobId, JOB),
          eq(jobAssignments.technicianName, TECH_A),
        ),
      );
    const rowA = rows[0];
    expect(rowA).toBeTruthy();

    await setAssignmentStatus(rowA.id, "confirmed", actor.name);
    const fetched = await getAssignmentById(rowA.id);
    expect(fetched!.status).toBe("confirmed");
    expect(fetched!.confirmedByName).toBe(actor.name);

    const map = await getAssignmentStatusMap([JOB]);
    expect(map.get(JOB)!.confirmed).toBe(1);
    expect(map.get(JOB)!.tentative).toBe(1);
    expect(map.get(JOB)!.byTech[TECH_A]).toBe("confirmed");
    expect(map.get(JOB)!.byTech[TECH_B]).toBe("tentative");
  });

  it("re-touching a phase preserves an already-confirmed technician", async () => {
    if (!dbAvailable) return;
    // TECH_A is confirmed from the previous test. Reassign the phase keeping
    // both technicians; TECH_A must stay confirmed, not silently revert.
    await setPhaseAssignments(JOB, "setup", [TECH_A, TECH_B], actor);
    const map = await getAssignmentStatusMap([JOB]);
    expect(map.get(JOB)!.byTech[TECH_A]).toBe("confirmed");
    expect(map.get(JOB)!.byTech[TECH_B]).toBe("tentative");
  });

  it("day-pinned (scheduled) assignments are also created tentative", async () => {
    if (!dbAvailable) return;
    const id = await setScheduledAssignment({
      airtableJobId: JOB,
      phase: "removal",
      technicianName: TECH_B,
      scheduledDate: "2026-07-01",
      actor,
    });
    const row = await getAssignmentById(id);
    expect(row!.status).toBe("tentative");
  });
});
