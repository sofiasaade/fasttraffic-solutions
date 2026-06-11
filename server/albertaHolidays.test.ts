import { describe, it, expect } from "vitest";
import {
  albertaHolidaysForYear,
  albertaHolidaysForYears,
  holidayName,
} from "../shared/albertaHolidays";

describe("albertaHolidaysForYear", () => {
  const h2026 = albertaHolidaysForYear(2026);

  it("fixed-date holidays", () => {
    expect(h2026["2026-01-01"]).toBe("New Year's Day");
    expect(h2026["2026-07-01"]).toBe("Canada Day");
    expect(h2026["2026-11-11"]).toBe("Remembrance Day");
    expect(h2026["2026-12-25"]).toBe("Christmas Day");
    expect(h2026["2026-12-26"]).toBe("Boxing Day");
  });

  it("Family Day = 3rd Monday of February 2026 (Feb 16)", () => {
    expect(h2026["2026-02-16"]).toBe("Family Day");
  });

  it("Victoria Day = Monday on/before May 24 2026 (May 18)", () => {
    expect(h2026["2026-05-18"]).toBe("Victoria Day");
  });

  it("Heritage Day = 1st Monday of August 2026 (Aug 3)", () => {
    expect(h2026["2026-08-03"]).toBe("Heritage Day");
  });

  it("Labour Day = 1st Monday of September 2026 (Sep 7)", () => {
    expect(h2026["2026-09-07"]).toBe("Labour Day");
  });

  it("Thanksgiving = 2nd Monday of October 2026 (Oct 12)", () => {
    expect(h2026["2026-10-12"]).toBe("Thanksgiving");
  });

  it("Good Friday 2026 = April 3", () => {
    expect(h2026["2026-04-03"]).toBe("Good Friday");
  });

  it("Good Friday 2025 = April 18", () => {
    const h2025 = albertaHolidaysForYear(2025);
    expect(h2025["2025-04-18"]).toBe("Good Friday");
  });

  it("spans multiple years", () => {
    const span = albertaHolidaysForYears([2025, 2026]);
    expect(span["2025-12-25"]).toBe("Christmas Day");
    expect(span["2026-01-01"]).toBe("New Year's Day");
  });

  it("holidayName helper", () => {
    expect(holidayName("2026-07-01", h2026)).toBe("Canada Day");
    expect(holidayName("2026-07-02", h2026)).toBeNull();
  });
});
