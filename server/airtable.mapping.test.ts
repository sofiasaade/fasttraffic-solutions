import { describe, expect, it } from "vitest";
import { mapRecordToJob } from "./airtable";
import { AF } from "@shared/airtableFields";

// Unit tests for mapRecordToJob: ensure Closure Type (multi-select), Impact
// Category, and the emoji extracted from "Calendar info" map correctly.
// No network access.
describe("mapRecordToJob — closure type, impact & emoji", () => {
  it("joins a multi-select closure type into a single string", () => {
    const job = mapRecordToJob({
      id: "rec1",
      fields: {
        [AF.company]: "LBCO Contracting",
        [AF.closureType]: [
          "Single left lane closure",
          "Single right lane closure",
          "Multi-lane closure two left lanes",
        ],
        [AF.impact]: "3️⃣ Medium",
      },
    });
    expect(job.closureType).toBe(
      "Single left lane closure · Single right lane closure · Multi-lane closure two left lanes",
    );
    expect(job.impact).toBe("3️⃣ Medium");
  });

  it("maps a single-value closure type", () => {
    const job = mapRecordToJob({
      id: "rec1b",
      fields: { [AF.closureType]: ["Road closure"] },
    });
    expect(job.closureType).toBe("Road closure");
  });

  it("extracts a leading run of emojis from Calendar info", () => {
    const job = mapRecordToJob({
      id: "rec2",
      fields: {
        [AF.calendarInfo]: "📌 🚨 FWD Construction Ltd 121 Main Street S, Airdrie",
      },
    });
    expect(job.emoji).toBe("📌 🚨");
    expect(job.calendarInfo).toContain("FWD Construction");
  });

  it("extracts a single emoji", () => {
    const job = mapRecordToJob({
      id: "rec2b",
      fields: { [AF.calendarInfo]: "🛞 LBCO Contracting 1133 Macleod Trl SE" },
    });
    expect(job.emoji).toBe("🛞");
  });

  it("returns null emoji when Calendar info has no emoji", () => {
    const job = mapRecordToJob({
      id: "rec3",
      fields: { [AF.calendarInfo]: "Onsite Sign 2303 4th St SW, Calgary" },
    });
    expect(job.emoji).toBeNull();
  });

  it("returns null fields when absent", () => {
    const job = mapRecordToJob({ id: "rec4", fields: {} });
    expect(job.closureType).toBeNull();
    expect(job.impact).toBeNull();
    expect(job.calendarInfo).toBeNull();
    expect(job.emoji).toBeNull();
    expect(job.clientMessage).toBeNull();
  });

  it("maps the Client message field", () => {
    const job = mapRecordToJob({
      id: "rec5",
      fields: { [AF.clientMessage]: "NO WORK: Sat, Sun" },
    });
    expect(job.clientMessage).toBe("NO WORK: Sat, Sun");
  });
});
