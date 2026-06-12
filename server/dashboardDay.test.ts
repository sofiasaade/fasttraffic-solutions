import { describe, it, expect } from "vitest";
import {
  classifyJobForDay,
  dayKey,
  isRecurringDailySetup,
} from "../shared/dashboardDay";

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

  it("flags a recurring multi-day (Several Days) job covering the day as ongoing only", () => {
    const b = classifyJobForDay(
      "2026-06-09",
      "2026-06-14",
      DAY,
      "Daily Set Up (9:00 AM - 3:00) (Several Days)",
    );
    expect(b.ongoing).toBe(true);
    expect(b.startingToday).toBe(false);
    expect(b.pickup).toBe(false);
  });

  it("does NOT mark a 24-hour job as ongoing on in-between days", () => {
    const b = classifyJobForDay(
      "2026-06-09",
      "2026-06-14",
      DAY,
      "24 Hours Set Up",
    );
    expect(b.ongoing).toBe(false);
    expect(b.startingToday).toBe(false);
    expect(b.pickup).toBe(false);
  });

  it("still shows a 24-hour job on the day it starts", () => {
    const b = classifyJobForDay(
      "2026-06-11",
      "2026-06-14",
      DAY,
      "24 Hours Set Up",
    );
    expect(b.startingToday).toBe(true);
    expect(b.ongoing).toBe(false);
  });

  it("does NOT mark a single-day Daytime job as ongoing (no setup duration recurring)", () => {
    const b = classifyJobForDay(
      "2026-06-09",
      "2026-06-14",
      DAY,
      "Daytime Work (9:00 AM - 3:00 PM)",
    );
    expect(b.ongoing).toBe(false);
  });

  it("treats a nightly recurring (Several Nights) job as ongoing", () => {
    const b = classifyJobForDay(
      "2026-06-09",
      "2026-06-14",
      DAY,
      "Nightly Set Up (9:00 PM - 5:00 AM) (Several Nights)",
    );
    expect(b.ongoing).toBe(true);
  });

  it("defaults to not-ongoing when setup duration is unknown/missing", () => {
    const b = classifyJobForDay("2026-06-09", "2026-06-14", DAY);
    expect(b.ongoing).toBe(false);
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

describe("isRecurringDailySetup", () => {
  it("returns true for Several Days / Several Nights setups", () => {
    expect(
      isRecurringDailySetup("Daily Set Up (9:00 AM - 3:00) (Several Days)"),
    ).toBe(true);
    expect(
      isRecurringDailySetup(
        "Nightly Set Up (9:00 PM - 5:00 AM) (Several Nights)",
      ),
    ).toBe(true);
  });

  it("returns false for 24-hour setups", () => {
    expect(isRecurringDailySetup("24 Hours Set Up")).toBe(false);
  });

  it("returns false for single-day daytime/night work", () => {
    expect(isRecurringDailySetup("Daytime Work (9:00 AM - 3:00 PM)")).toBe(
      false,
    );
    expect(isRecurringDailySetup("Nightime Work (9:00 PM - 5:00 AM)")).toBe(
      false,
    );
  });

  it("returns false for missing values", () => {
    expect(isRecurringDailySetup(null)).toBe(false);
    expect(isRecurringDailySetup(undefined)).toBe(false);
  });
});
