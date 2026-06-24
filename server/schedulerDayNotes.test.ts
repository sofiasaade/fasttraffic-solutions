import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "./db";
import { jobAssignments, schedulerDayNotes } from "../drizzle/schema";
import {
  setSchedulerDayNote,
  getSchedulerDayNote,
  listSchedulerDayNotesInRange,
  setScheduledAssignment,
  updateScheduledAssignment,
  getAssignmentById,
  getDayPinnedAssignmentsMap,
} from "./opsDb";

// Namespaced ids so the test never collides with real Airtable jobs and can be
// fully cleaned up afterwards.
const JOB = `test-daynote-${Date.now()}`;
const TECH = `__TestTechDN_${Date.now()}`;
const DAY = "2026-08-12";
const DAY2 = "2026-08-13";
const actor = { userId: undefined, name: "Test Coordinator" };

let dbAvailable = true;

async function cleanup() {
  const d = await getDb();
  if (!d) return;
  await d.delete(jobAssignments).where(eq(jobAssignments.airtableJobId, JOB));
  await d.delete(jobAssignments).where(like(jobAssignments.technicianName, "__TestTechDN%"));
  await d.delete(schedulerDayNotes).where(eq(schedulerDayNotes.airtableJobId, JOB));
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

describe("scheduler day notes (opsDb)", () => {
  it("creates a note for a (job, day)", async () => {
    if (!dbAvailable) return;
    const id = await setSchedulerDayNote({
      airtableJobId: JOB,
      noteDate: DAY,
      note: "Job cancelled by client — rain.",
      actor,
    });
    expect(id).toBeTruthy();

    const row = await getSchedulerDayNote(JOB, DAY);
    expect(row).toBeTruthy();
    expect(row!.note).toBe("Job cancelled by client — rain.");
  });

  it("updates an existing note in place (no duplicate row)", async () => {
    if (!dbAvailable) return;
    await setSchedulerDayNote({
      airtableJobId: JOB,
      noteDate: DAY,
      note: "Rescheduled to next week.",
      actor,
    });
    const row = await getSchedulerDayNote(JOB, DAY);
    expect(row!.note).toBe("Rescheduled to next week.");

    const inRange = await listSchedulerDayNotesInRange(DAY, DAY);
    const forJob = inRange.filter((r) => r.airtableJobId === JOB);
    expect(forJob.length).toBe(1);
  });

  it("returns notes within a date range", async () => {
    if (!dbAvailable) return;
    await setSchedulerDayNote({
      airtableJobId: JOB,
      noteDate: DAY2,
      note: "Second day note.",
      actor,
    });
    const inRange = await listSchedulerDayNotesInRange(DAY, DAY2);
    const dates = inRange
      .filter((r) => r.airtableJobId === JOB)
      .map((r) => r.noteDate)
      .sort();
    expect(dates).toEqual([DAY, DAY2]);
  });

  it("clears a note when set to empty/whitespace", async () => {
    if (!dbAvailable) return;
    const res = await setSchedulerDayNote({
      airtableJobId: JOB,
      noteDate: DAY2,
      note: "   ",
      actor,
    });
    expect(res).toBeNull();
    const row = await getSchedulerDayNote(JOB, DAY2);
    expect(row).toBeNull();
  });
});

describe("edit a day-pinned assignment (opsDb)", () => {
  it("updates the phase and time of an existing assignment", async () => {
    if (!dbAvailable) return;
    const id = await setScheduledAssignment({
      airtableJobId: JOB,
      phase: "Setup",
      technicianName: TECH,
      scheduledDate: DAY,
      startTime: "08:00",
      endTime: "12:00",
      actor,
    });

    const updated = await updateScheduledAssignment({
      id,
      phase: "Pickup",
      startTime: "13:30",
      endTime: "16:00",
    });
    expect(updated!.phase).toBe("Pickup");
    expect(updated!.startTime).toBe("13:30");
    expect(updated!.endTime).toBe("16:00");

    const fetched = await getAssignmentById(id);
    expect(fetched!.phase).toBe("Pickup");
  });
});

describe("strict day-pinned crew map (opsDb)", () => {
  it("only returns crew pinned to the requested day", async () => {
    if (!dbAvailable) return;
    // One row pinned to DAY (created/edited above to Pickup phase).
    const map = await getDayPinnedAssignmentsMap([JOB], DAY);
    const entry = map.get(JOB);
    expect(entry).toBeTruthy();
    expect(entry!.Pickup).toContain(TECH);

    // A different day should not include this assignment.
    const other = await getDayPinnedAssignmentsMap([JOB], "2026-09-01");
    expect(other.get(JOB)).toBeUndefined();
  });
});
