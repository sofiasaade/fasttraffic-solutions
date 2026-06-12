import { describe, it, expect } from "vitest";
import { subStatusColor, subStatusLegend } from "../shared/subStatusColors";

describe("subStatusColor", () => {
  it("maps known sub-statuses to their Airtable colors", () => {
    // Picked up = redBright in Airtable
    expect(subStatusColor("Picked up").bg.toLowerCase()).toBe("#f82b60");
    // Daily Setup (Field) = greenBright
    expect(subStatusColor("Daily Setup (Field)").bg.toLowerCase()).toBe("#20c933");
    // 24 Hours Setup (Field) = yellowBright
    expect(subStatusColor("24 Hours Setup (Field)").bg.toLowerCase()).toBe("#fcb400");
    // Permit Approved(Field) = blueBright
    expect(subStatusColor("Permit Approved(Field)").bg.toLowerCase()).toBe("#2d7ff9");
  });

  it("trims trailing whitespace when matching (Airtable stores 'Setup Prepared (Field) ')", () => {
    const trimmed = subStatusColor("Setup Prepared (Field)");
    const withSpace = subStatusColor("Setup Prepared (Field) ");
    expect(withSpace.bg).toBe(trimmed.bg);
    expect(trimmed.token).toBe("greenLight2");
  });

  it("returns a neutral color (no token) for unknown or empty sub-status", () => {
    expect(subStatusColor(null).token).toBeNull();
    expect(subStatusColor("").token).toBeNull();
    expect(subStatusColor("Some Unknown Status").token).toBeNull();
  });

  it("provides readable text color on bright backgrounds", () => {
    // bright/saturated -> white text
    expect(subStatusColor("Picked up").text.toLowerCase()).toBe("#ffffff");
    // light -> dark text
    expect(subStatusColor("TMP Creation").text.toLowerCase()).toBe("#1d1f25");
  });

  it("legend covers all 15 sub-status options with colors", () => {
    const legend = subStatusLegend();
    expect(legend.length).toBe(15);
    for (const entry of legend) {
      expect(entry.color.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(entry.color.token).not.toBeNull();
    }
  });
});
