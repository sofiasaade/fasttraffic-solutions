import { describe, it, expect } from "vitest";
import { classifyJobForDay, dayKey } from "../shared/dashboardDay";

describe("dayKey", () => {
  it("trims ISO timestamps to YYYY-MM-DD", () => {
    expect(dayKey("2026-06-11T08:30:00.000Z")).toBe("2026-06-11");
    expect(dayKey("2026-06-11")).toBe("2026-06-11");
  });
  it("returns empty string for missing values", () => {
    expect(dayKey(null)).toBe("");
    expect(dayKey(undefined)).toBe("");
  });
});

describe("classifyJobForDay", () => {
  const DAY = "2026-06-11";

  it("flags a job starting on the day", () => {
    const b = classifyJobForDay("2026-06-11", "2026-06-14", DAY);
    expect(b.startingToday).toBe(true);
    expect(b.pickup).toBe(false);
    expect(b.ongoing).toBe(false);
  });

  it("flags a job ending (pickup) on the day", () => {
    const b = classifyJobForDay("2026-06-09", "2026-06-11", DAY);
    expect(b.pickup).toBe(true);
    expect(b.startingToday).toBe(false);
    expect(b.ongoing).toBe(false);
  });

  it("flags a multi-day job that strictly covers the day as ongoing only", () => {
    const b = classifyJobForDay("2026-06-09", "2026-06-14", DAY);
    expect(b.ongoing).toBe(true);
    expect(b.startingToday).toBe(false);
    expect(b.pickup).toBe(false);
  });

  it("treats a one-day job (start == end == day) as both starting and pickup, not ongoing", () => {
    const b = classifyJobForDay("2026-06-11", "2026-06-11", DAY);
    expect(b.startingToday).toBe(true);
    expect(b.pickup).toBe(true);
    expect(b.ongoing).toBe(false);
  });

  it("uses start date as end when end is missing", () => {
    const b = classifyJobForDay("2026-06-11", null, DAY);
    expect(b.startingToday).toBe(true);
    expect(b.pickup).toBe(true);
    expect(b.ongoing).toBe(false);
  });

  it("does not match a job outside the day", () => {
    const b = classifyJobForDay("2026-06-01", "2026-06-05", DAY);
    expect(b.startingToday).toBe(false);
    expect(b.pickup).toBe(false);
    expect(b.ongoing).toBe(false);
  });

  it("handles ISO timestamps with time components", () => {
    const b = classifyJobForDay(
      "2026-06-11T06:00:00Z",
      "2026-06-13T18:00:00Z",
      DAY,
    );
    expect(b.startingToday).toBe(true);
    expect(b.ongoing).toBe(false);
  });

  it("returns all-false when start date is missing (a job needs a start date)", () => {
    const b = classifyJobForDay(null, "2026-06-11", DAY);
    expect(b.startingToday).toBe(false);
    expect(b.ongoing).toBe(false);
    expect(b.pickup).toBe(false);
  });
});
