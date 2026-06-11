import { describe, it, expect } from "vitest";
import {
  diffJob,
  isInWindow,
  jobStartDateKey,
  toSnapshotShape,
  utcDateKey,
} from "./changeDetection";
import type { JobRecord } from "../shared/airtableFields";
import type { JobSnapshot } from "../drizzle/schema";

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "rec1",
    company: "Marmot Construction",
    jobAddress: "525 River Heights Dr, Cochrane",
    projectTitle: null,
    startDate: "2026-06-12",
    endDate: "2026-06-12",
    setupDuration: "24 Hours Set Up",
    status: "Permit Approved",
    subStatus: null,
    requestId: "REQ-1",
    municipality: "Cochrane",
    lat: null,
    lon: null,
    siteContactPhone: null,
    requestorName: null,
    techPrep: [],
    techSetup: [],
    techPickup: [],
    planFile: [],
    fieldPhotos: [],
    fieldComments: null,
    closureType: "Single left lane closure",
    impact: "2️⃣ Low",
    calendarInfo: "📌",
    emoji: "📌",
    ...overrides,
  } as JobRecord;
}

function makeSnapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 1,
    snapshotDate: "2026-06-09",
    airtableJobId: "rec1",
    requestId: "REQ-1",
    company: "Marmot Construction",
    jobAddress: "525 River Heights Dr, Cochrane",
    startDate: "2026-06-12",
    endDate: "2026-06-12",
    status: "Permit Approved",
    subStatus: null,
    setupDuration: "24 Hours Set Up",
    closureType: "Single left lane closure",
    impact: "2️⃣ Low",
    technicians: null,
    createdAt: new Date(),
    ...overrides,
  } as JobSnapshot;
}

describe("change detection window", () => {
  it("includes a job whose start date is within 5 days", () => {
    const job = makeJob({ startDate: "2026-06-12" });
    expect(isInWindow(job, "2026-06-10", 5)).toBe(true);
  });
  it("excludes a job outside the window", () => {
    const job = makeJob({ startDate: "2026-06-20" });
    expect(isInWindow(job, "2026-06-10", 5)).toBe(false);
  });
  it("excludes a job with no start date", () => {
    const job = makeJob({ startDate: null });
    expect(isInWindow(job, "2026-06-10", 5)).toBe(false);
  });
  it("derives a UTC date key", () => {
    expect(jobStartDateKey(makeJob({ startDate: "2026-06-12T08:00:00.000Z" }))).toBe(
      "2026-06-12",
    );
  });
  it("utcDateKey formats today", () => {
    expect(utcDateKey(new Date("2026-06-10T23:59:00Z"))).toBe("2026-06-10");
  });
});

describe("diffJob", () => {
  it("flags a brand new job when there is no previous snapshot", () => {
    const job = makeJob();
    const changes = diffJob({
      detectedDate: "2026-06-10",
      job,
      current: toSnapshotShape(job),
      previous: null,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe("new");
  });

  it("flags cancellation when status becomes Cancelled", () => {
    const job = makeJob({ status: "Cancelled" });
    const changes = diffJob({
      detectedDate: "2026-06-10",
      job,
      current: toSnapshotShape(job),
      previous: makeSnapshot({ status: "Permit Approved" }),
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe("cancelled");
    expect(changes[0].newValue).toBe("Cancelled");
  });

  it("flags postponed when start date changes", () => {
    const job = makeJob({ startDate: "2026-06-14" });
    const changes = diffJob({
      detectedDate: "2026-06-10",
      job,
      current: toSnapshotShape(job),
      previous: makeSnapshot({ startDate: "2026-06-12" }),
    });
    const postponed = changes.find((c) => c.changeType === "postponed");
    expect(postponed).toBeTruthy();
    expect(postponed?.oldValue).toBe("2026-06-12");
    expect(postponed?.newValue).toBe("2026-06-14");
  });

  it("flags modified for address/closure/impact/setup changes", () => {
    const job = makeJob({
      jobAddress: "999 New St",
      closureType: "Road closure",
      impact: "3️⃣ Medium",
      setupDuration: "Daytime Work (7:00 AM - 5:00 PM)",
    });
    const changes = diffJob({
      detectedDate: "2026-06-10",
      job,
      current: toSnapshotShape(job),
      previous: makeSnapshot(),
    });
    const fields = changes
      .filter((c) => c.changeType === "modified")
      .map((c) => c.fieldName);
    expect(fields).toContain("Job Address");
    expect(fields).toContain("Closure Type");
    expect(fields).toContain("Impact");
    expect(fields).toContain("Setup Duration");
  });

  it("flags technician changes as modified", () => {
    const job = makeJob({ techSetup: ["Adrian", "Hugo Lopez"] });
    const changes = diffJob({
      detectedDate: "2026-06-10",
      job,
      current: toSnapshotShape(job),
      previous: makeSnapshot({ technicians: null }),
    });
    const tech = changes.find((c) => c.fieldName === "Technicians");
    expect(tech).toBeTruthy();
    expect(tech?.newValue).toBe("Adrian, Hugo Lopez");
  });

  it("returns no changes when nothing changed", () => {
    const job = makeJob();
    const changes = diffJob({
      detectedDate: "2026-06-10",
      job,
      current: toSnapshotShape(job),
      previous: makeSnapshot(),
    });
    expect(changes).toHaveLength(0);
  });
});
