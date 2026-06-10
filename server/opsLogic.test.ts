import { describe, expect, it } from "vitest";
import {
  computeOvertimeStatus,
  detectConflicts,
  getPayPeriodFor,
  intervalsOverlap,
  jobToInterval,
  PAY_PERIOD_LENGTH_DAYS,
} from "../shared/opsLogic";
import { JobRecord } from "../shared/airtableFields";

describe("pay periods", () => {
  it("produces 14-day periods", () => {
    const p = getPayPeriodFor(new Date(Date.UTC(2024, 0, 5)));
    const days = (p.end.getTime() - p.start.getTime()) / (24 * 3600 * 1000);
    expect(days).toBe(PAY_PERIOD_LENGTH_DAYS);
  });

  it("groups dates within the same period", () => {
    const a = getPayPeriodFor(new Date(Date.UTC(2024, 0, 2)));
    const b = getPayPeriodFor(new Date(Date.UTC(2024, 0, 10)));
    expect(a.index).toBe(b.index);
  });

  it("separates dates in different periods", () => {
    const a = getPayPeriodFor(new Date(Date.UTC(2024, 0, 2)));
    const b = getPayPeriodFor(new Date(Date.UTC(2024, 0, 20)));
    expect(a.index).not.toBe(b.index);
  });
});

describe("overtime status", () => {
  it("flags ok below 85%", () => {
    expect(computeOvertimeStatus("T", 30, 44).level).toBe("ok");
  });
  it("flags approaching at >= 85%", () => {
    expect(computeOvertimeStatus("T", 38, 44).level).toBe("approaching");
  });
  it("flags over at threshold", () => {
    expect(computeOvertimeStatus("T", 44, 44).level).toBe("over");
    expect(computeOvertimeStatus("T", 50, 44).level).toBe("over");
  });
  it("computes remaining hours", () => {
    expect(computeOvertimeStatus("T", 40, 44).remaining).toBe(4);
  });
});

describe("interval overlap", () => {
  it("detects overlap", () => {
    expect(
      intervalsOverlap(
        { jobId: "a", start: 0, end: 10 },
        { jobId: "b", start: 5, end: 15 },
      ),
    ).toBe(true);
  });
  it("touching boundaries are not a conflict", () => {
    expect(
      intervalsOverlap(
        { jobId: "a", start: 0, end: 10 },
        { jobId: "b", start: 10, end: 20 },
      ),
    ).toBe(false);
  });
});

describe("conflict detection", () => {
  it("finds double-booking", () => {
    const target = { jobId: "t", start: 100, end: 200 };
    const existing = [
      { jobId: "x", start: 150, end: 250 },
      { jobId: "y", start: 300, end: 400 },
    ];
    const r = detectConflicts(target, existing);
    expect(r.hasConflict).toBe(true);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].otherJobId).toBe("x");
  });

  it("ignores the same job", () => {
    const target = { jobId: "t", start: 100, end: 200 };
    const existing = [{ jobId: "t", start: 100, end: 200 }];
    expect(detectConflicts(target, existing).hasConflict).toBe(false);
  });
});

describe("jobToInterval", () => {
  it("defaults to 1 day when end missing", () => {
    const job = {
      id: "j1",
      startDate: "2024-06-01T09:00:00.000Z",
      endDate: null,
    } as JobRecord;
    const iv = jobToInterval(job);
    expect(iv).not.toBeNull();
    const days = (iv!.end - iv!.start) / (24 * 3600 * 1000);
    expect(days).toBeCloseTo(1, 5);
  });
});
