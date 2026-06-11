import { describe, it, expect } from "vitest";
import { parseNonWorkingDays, nonWorkingReason } from "../shared/nonWorkingDays";

describe("parseNonWorkingDays", () => {
  it("returns empty when no message", () => {
    expect(parseNonWorkingDays(null).hasDirective).toBe(false);
    expect(parseNonWorkingDays("").hasDirective).toBe(false);
    expect(parseNonWorkingDays(undefined).hasDirective).toBe(false);
  });

  it("returns empty when no directive line present (LLM fallback)", () => {
    const r = parseNonWorkingDays("Please coordinate with site super before arrival.");
    expect(r.hasDirective).toBe(false);
    expect(r.weekdays).toEqual([]);
    expect(r.dates).toEqual([]);
  });

  it("parses weekday names", () => {
    const r = parseNonWorkingDays("Notes...\nNO WORK: Sat, Sun");
    expect(r.hasDirective).toBe(true);
    expect(r.weekdays).toEqual([0, 6]);
  });

  it("parses 'weekends' shortcut", () => {
    const r = parseNonWorkingDays("NO WORK: weekends");
    expect(r.weekdays).toEqual([0, 6]);
  });

  it("parses 'weekdays' shortcut", () => {
    const r = parseNonWorkingDays("NO WORK: weekdays");
    expect(r.weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses ISO dates", () => {
    const r = parseNonWorkingDays("NO WORK: 2026-07-04, 2026-07-05");
    expect(r.dates).toEqual(["2026-07-04", "2026-07-05"]);
  });

  it("parses an ISO date range with ..", () => {
    const r = parseNonWorkingDays("NO WORK: 2026-07-04..2026-07-06");
    expect(r.dates).toEqual(["2026-07-04", "2026-07-05", "2026-07-06"]);
  });

  it("parses an ISO date range with 'to'", () => {
    const r = parseNonWorkingDays("NO WORK: 2026-12-24 to 2026-12-26");
    expect(r.dates).toEqual(["2026-12-24", "2026-12-25", "2026-12-26"]);
  });

  it("mixes weekdays and dates", () => {
    const r = parseNonWorkingDays("NO WORK: Sun; 2026-07-01");
    expect(r.weekdays).toEqual([0]);
    expect(r.dates).toEqual(["2026-07-01"]);
  });

  it("is case-insensitive and accepts spanish keyword", () => {
    const r = parseNonWorkingDays("no laborar: domingo");
    expect(r.hasDirective).toBe(true);
    expect(r.weekdays).toEqual([0]);
  });

  it("ignores unknown tokens but keeps known ones", () => {
    const r = parseNonWorkingDays("NO WORK: holidays-only, Fri");
    expect(r.weekdays).toEqual([5]);
  });

  it("captures the directive text as reason", () => {
    const r = parseNonWorkingDays("NO WORK: Sat, Sun");
    expect(r.reason).toBe("Sat, Sun");
  });
});

describe("nonWorkingReason", () => {
  const rule = parseNonWorkingDays("NO WORK: Sun, 2026-07-01");

  it("matches a blocked weekday (Sunday = 0)", () => {
    expect(nonWorkingReason(rule, "2026-06-14", 0)).toBe("Sun, 2026-07-01");
  });

  it("matches a blocked explicit date", () => {
    expect(nonWorkingReason(rule, "2026-07-01", 3)).toBe("Sun, 2026-07-01");
  });

  it("returns null for a working day", () => {
    expect(nonWorkingReason(rule, "2026-06-16", 2)).toBeNull();
  });

  it("returns null when no directive", () => {
    const none = parseNonWorkingDays("just a note");
    expect(nonWorkingReason(none, "2026-07-01", 3)).toBeNull();
  });
});
