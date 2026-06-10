import { describe, it, expect } from "vitest";
import { isCancelledJob } from "../shared/jobStatus";

describe("isCancelledJob", () => {
  it("flags jobs with a top-level Cancelled status", () => {
    expect(isCancelledJob({ status: "Cancelled", subStatus: null })).toBe(true);
  });

  it("flags jobs with a Permit Declined status", () => {
    expect(isCancelledJob({ status: "Permit Declined", subStatus: null })).toBe(
      true,
    );
  });

  it("flags Field jobs that carry a cancelled sub-status", () => {
    expect(
      isCancelledJob({ status: "Field", subStatus: "Cancelled (Field)" }),
    ).toBe(true);
  });

  it("flags jobs with a setup-cancelled sub-status", () => {
    expect(
      isCancelledJob({
        status: "Field",
        subStatus: "Setup - Cancelled (Field)",
      }),
    ).toBe(true);
  });

  it("flags declined sub-status", () => {
    expect(
      isCancelledJob({ status: "Field", subStatus: "Declined (Field)" }),
    ).toBe(true);
  });

  it("does NOT flag a normal Field job", () => {
    expect(
      isCancelledJob({ status: "Field", subStatus: "Daily Setup (Field)" }),
    ).toBe(false);
  });

  it("does NOT flag Permit Approved / Submitted jobs", () => {
    expect(isCancelledJob({ status: "Permit Approved", subStatus: null })).toBe(
      false,
    );
    expect(
      isCancelledJob({ status: "Permit Request Submitted", subStatus: null }),
    ).toBe(false);
  });

  it("handles null status and sub-status gracefully", () => {
    expect(isCancelledJob({ status: null, subStatus: null })).toBe(false);
  });
});
