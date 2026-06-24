import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "./db";
import {
  jobAssignments,
  equipmentAssignments,
  truckAssignments,
  schedulerDayNotes,
} from "../drizzle/schema";
import {
  setSchedulerDayNote,
  getSchedulerDayNote,
  setScheduledAssignment,
  moveScheduledAssignment,
  getAssignmentById,
  setEquipmentAssignment,
  updateEquipmentAssignment,
  listEquipmentAssignmentsForWeek,
  setTruckAssignment,
  updateTruckAssignment,
  listTruckAssignmentsForWeek,
} from "./opsDb";

// Namespaced ids so the test never collides with real Airtable jobs.
const STAMP = Date.now();
const JOB_A = `test-b2-a-${STAMP}`;
const JOB_B = `test-b2-b-${STAMP}`;
const TECH = `__TestTechB2_${STAMP}`;
const DAY = "2026-08-20";
const DAY2 = "2026-08-21";
const actor = { userId: undefined, name: "Test Coordinator" };

let dbAvailable = true;

async function cleanup() {
  const d = await getDb();
  if (!d) return;
  for (const job of [JOB_A, JOB_B]) {
    await d.delete(jobAssignments).where(eq(jobAssignments.airtableJobId, job));
    await d
      .delete(equipmentAssignments)
      .where(eq(equipmentAssignments.airtableJobId, job));
    await d
      .delete(truckAssignments)
      .where(eq(truckAssignments.airtableJobId, job));
    await d
      .delete(schedulerDayNotes)
      .where(eq(schedulerDayNotes.airtableJobId, job));
  }
  await d
    .delete(jobAssignments)
    .where(like(jobAssignments.technicianName, "__TestTechB2%"));
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

describe("day-note quick flags (opsDb)", () => {
  it("stores cancelled/postponed/missingSigns flags", async () => {
    if (!dbAvailable) return;
    const id = await setSchedulerDayNote({
      airtableJobId: JOB_A,
      noteDate: DAY,
      note: "Client called it off",
      cancelled: true,
      missingSigns: true,
      actor,
    });
    expect(id).toBeTruthy();

    const row = await getSchedulerDayNote(JOB_A, DAY);
    expect(row).toBeTruthy();
    expect(!!row!.cancelled).toBe(true);
    expect(!!row!.missingSigns).toBe(true);
    expect(!!row!.postponed).toBe(false);
  });

  it("keeps a flag-only row even when the note text is empty", async () => {
    if (!dbAvailable) return;
    const id = await setSchedulerDayNote({
      airtableJobId: JOB_A,
      noteDate: DAY2,
      note: "   ",
      postponed: true,
      actor,
    });
    // A flag-only row must persist (not be cleared like an empty plain note).
    expect(id).toBeTruthy();
    const row = await getSchedulerDayNote(JOB_A, DAY2);
    expect(row).toBeTruthy();
    expect(!!row!.postponed).toBe(true);
    expect(row!.note ?? "").toBe("");
  });

  it("clears the row when note is empty and all flags are false", async () => {
    if (!dbAvailable) return;
    const res = await setSchedulerDayNote({
      airtableJobId: JOB_A,
      noteDate: DAY2,
      note: "",
      cancelled: false,
      postponed: false,
      missingSigns: false,
      actor,
    });
    expect(res).toBeNull();
    const row = await getSchedulerDayNote(JOB_A, DAY2);
    expect(row).toBeNull();
  });
});

describe("cross-job move of a worker assignment (opsDb)", () => {
  it("moves an assignment to another job and day", async () => {
    if (!dbAvailable) return;
    const id = await setScheduledAssignment({
      airtableJobId: JOB_A,
      phase: "Setup",
      technicianName: TECH,
      scheduledDate: DAY,
      startTime: "08:00",
      endTime: "16:00",
      actor,
    });

    const moved = await moveScheduledAssignment({
      id,
      scheduledDate: DAY2,
      airtableJobId: JOB_B,
    });
    expect(moved).not.toBeNull();

    const fetched = await getAssignmentById(id);
    expect(fetched!.airtableJobId).toBe(JOB_B);
    expect(fetched!.scheduledDate).toBe(DAY2);
  });
});

describe("equipment edit in place (opsDb)", () => {
  it("updates quantity, installer and notes without creating a new row", async () => {
    if (!dbAvailable) return;
    const id = await setEquipmentAssignment({
      airtableJobId: JOB_A,
      equipmentName: "No Parking Signs",
      scheduledDate: DAY,
      quantity: 2,
      actor,
    });
    expect(id).toBeTruthy();

    const ok = await updateEquipmentAssignment({
      id,
      quantity: 8,
      technicianName: TECH,
      notes: "North side",
    });
    expect(ok).toBe(true);

    const rows = await listEquipmentAssignmentsForWeek(DAY, DAY);
    const mine = rows.filter((r) => r.airtableJobId === JOB_A);
    expect(mine.length).toBe(1);
    expect(mine[0].quantity).toBe(8);
    expect(mine[0].technicianName).toBe(TECH);
    expect(mine[0].notes).toBe("North side");
  });
});

describe("truck edit in place (opsDb)", () => {
  it("updates driver and notes without creating a new row", async () => {
    if (!dbAvailable) return;
    const id = await setTruckAssignment({
      airtableJobId: JOB_A,
      truckName: "Box Truck 1",
      scheduledDate: DAY,
      actor,
    });
    expect(id).toBeTruthy();

    const ok = await updateTruckAssignment({
      id,
      driverName: TECH,
      notes: "Lift gate",
    });
    expect(ok).toBe(true);

    const rows = await listTruckAssignmentsForWeek(DAY, DAY);
    const mine = rows.filter((r) => r.airtableJobId === JOB_A);
    expect(mine.length).toBe(1);
    expect(mine[0].driverName).toBe(TECH);
    expect(mine[0].notes).toBe("Lift gate");
  });
});
