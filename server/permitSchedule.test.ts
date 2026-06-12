import { describe, it, expect } from "vitest";
import {
  isStreetUsePermitFile,
  selectStreetUsePermits,
  pickMostCurrentPermit,
  classifyNineAm,
  parseMinutes,
  isPickupOnDate,
  startsOnDate,
  timeFromIso,
  dateFromIso,
  timeFromDurationLabel,
  resolveStartTime,
  type AttachmentLike,
  type PermitSchedule,
} from "../shared/permitSchedule";

const su = (filename: string): AttachmentLike => ({
  url: `https://x/${filename}`,
  filename,
  type: "application/pdf",
});

describe("isStreetUsePermitFile", () => {
  it("matches filenames starting with SU and a number", () => {
    expect(isStreetUsePermitFile(su("SU-26-672264-45STSW.PDF"))).toBe(true);
    expect(isStreetUsePermitFile(su("su_26_672264.pdf"))).toBe(true);
    expect(isStreetUsePermitFile(su("SU 26 672264.pdf"))).toBe(true);
  });

  it("matches non-Calgary SUP permits (Cochrane etc.)", () => {
    expect(
      isStreetUsePermitFile(su("SUP2026-15525RiverHeightsDrive.pdf")),
    ).toBe(true);
    expect(isStreetUsePermitFile(su("SUP-2026-15.PDF"))).toBe(true);
  });

  it("rejects non-SU or non-PDF files", () => {
    expect(isStreetUsePermitFile(su("Plan-Final.PDF"))).toBe(false);
    expect(isStreetUsePermitFile(su("Summary.pdf"))).toBe(false);
    expect(
      isStreetUsePermitFile({ url: "x", filename: "SU-26.png", type: "image/png" }),
    ).toBe(false);
    expect(isStreetUsePermitFile({ url: "x" })).toBe(false);
  });
});

describe("selectStreetUsePermits", () => {
  it("returns only SU permit attachments", () => {
    const list = [su("SU-26-1.PDF"), su("Plan.PDF"), su("SU-26-2.PDF")];
    const out = selectStreetUsePermits(list);
    expect(out.map((a) => a.filename)).toEqual([
      "SU-26-1.PDF",
      "SU-26-2.PDF",
    ]);
  });

  it("handles empty / null input", () => {
    expect(selectStreetUsePermits(null)).toEqual([]);
    expect(selectStreetUsePermits([])).toEqual([]);
  });
});

describe("pickMostCurrentPermit", () => {
  it("returns the single permit when only one", () => {
    expect(pickMostCurrentPermit([su("SU-1.PDF")])?.filename).toBe("SU-1.PDF");
  });

  it("prefers the latest validFromDate", () => {
    const permits = [su("SU-A.PDF"), su("SU-B.PDF")];
    const schedules: Record<string, PermitSchedule> = {
      "SU-A.PDF": { validFromDate: "2026-05-10" },
      "SU-B.PDF": { validFromDate: "2026-06-01" },
    };
    expect(pickMostCurrentPermit(permits, schedules)?.filename).toBe("SU-B.PDF");
  });

  it("falls back to highest trailing number when no schedule", () => {
    const permits = [su("SU-26-100.PDF"), su("SU-26-205.PDF")];
    expect(pickMostCurrentPermit(permits)?.filename).toBe("SU-26-205.PDF");
  });

  it("returns null for empty", () => {
    expect(pickMostCurrentPermit([])).toBeNull();
  });
});

describe("classifyNineAm", () => {
  it("classifies before/at/after 9AM", () => {
    expect(classifyNineAm("07:00")).toBe("before9");
    expect(classifyNineAm("08:59")).toBe("before9");
    expect(classifyNineAm("09:00")).toBe("at9");
    expect(classifyNineAm("09:01")).toBe("after9");
    expect(classifyNineAm("22:00")).toBe("after9");
  });

  it("returns unknown for unparseable times", () => {
    expect(classifyNineAm(null)).toBe("unknown");
    expect(classifyNineAm("")).toBe("unknown");
    expect(classifyNineAm("noon")).toBe("unknown");
  });
});

describe("parseMinutes", () => {
  it("parses HH:MM", () => {
    expect(parseMinutes("09:00")).toBe(540);
    expect(parseMinutes("22:30")).toBe(1350);
  });
  it("rejects invalid", () => {
    expect(parseMinutes("25:00")).toBeNull();
    expect(parseMinutes("09:99")).toBeNull();
    expect(parseMinutes(undefined)).toBeNull();
  });
});

describe("isPickupOnDate / startsOnDate", () => {
  const sched: PermitSchedule = {
    validFromDate: "2026-05-16",
    validFromTime: "09:00",
    validToDate: "2026-05-18",
    validToTime: "22:00",
  };
  it("pickup matches validToDate", () => {
    expect(isPickupOnDate(sched, "2026-05-18")).toBe(true);
    expect(isPickupOnDate(sched, "2026-05-16")).toBe(false);
    expect(isPickupOnDate(null, "2026-05-18")).toBe(false);
  });
  it("starts matches validFromDate", () => {
    expect(startsOnDate(sched, "2026-05-16")).toBe(true);
    expect(startsOnDate(sched, "2026-05-18")).toBe(false);
  });
});

describe("ISO + duration helpers", () => {
  it("timeFromIso extracts HH:MM", () => {
    expect(timeFromIso("2026-04-28T09:00:00.000Z")).toBe("09:00");
    expect(timeFromIso("2026-04-28")).toBeNull();
    expect(timeFromIso(null)).toBeNull();
  });
  it("dateFromIso extracts YYYY-MM-DD", () => {
    expect(dateFromIso("2026-04-28T09:00:00.000Z")).toBe("2026-04-28");
    expect(dateFromIso("bad")).toBeNull();
  });
  it("timeFromDurationLabel parses 12h windows", () => {
    expect(timeFromDurationLabel("Daytime Work (9:00 AM - 3:00 PM)")).toBe("09:00");
    expect(timeFromDurationLabel("Nightime Work (9:00 PM - 5:00 AM)")).toBe("21:00");
    expect(timeFromDurationLabel("24 Hours Set Up")).toBeNull();
  });
});

describe("resolveStartTime (permit-only, no Start-date fallback)", () => {
  it("uses permit validFromTime when present", () => {
    expect(resolveStartTime({ validFromTime: "07:00" })).toBe("07:00");
  });
  it("returns null when no permit schedule (missing-info)", () => {
    expect(resolveStartTime(null)).toBeNull();
    expect(resolveStartTime({})).toBeNull();
  });
});
