import { describe, expect, it } from "vitest";
import { deriveAssignmentState } from "../shared/jobStatus";

const active = { status: "Approved", subStatus: null };

describe("deriveAssignmentState", () => {
  it("returns 'pending' when no technician is assigned", () => {
    expect(
      deriveAssignmentState({ ...active, total: 0, confirmed: 0 }),
    ).toBe("pending");
  });

  it("returns 'tentative' when some technicians are assigned but not all confirmed", () => {
    expect(
      deriveAssignmentState({ ...active, total: 3, confirmed: 0 }),
    ).toBe("tentative");
    expect(
      deriveAssignmentState({ ...active, total: 3, confirmed: 2 }),
    ).toBe("tentative");
  });

  it("returns 'confirmed' only when every assigned technician is confirmed", () => {
    expect(
      deriveAssignmentState({ ...active, total: 3, confirmed: 3 }),
    ).toBe("confirmed");
  });

  it("treats over-counted confirmations as confirmed (defensive)", () => {
    expect(
      deriveAssignmentState({ ...active, total: 2, confirmed: 5 }),
    ).toBe("confirmed");
  });

  it("returns 'cancelled' for cancelled jobs even when technicians exist", () => {
    expect(
      deriveAssignmentState({
        status: "Field",
        subStatus: "Cancelled",
        total: 2,
        confirmed: 2,
      }),
    ).toBe("cancelled");
    expect(
      deriveAssignmentState({
        status: "Declined",
        subStatus: null,
        total: 0,
        confirmed: 0,
      }),
    ).toBe("cancelled");
  });
});
