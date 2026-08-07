import { describe, expect, it } from "vitest";
import {
  buildQuote,
  complexityForSigns,
  industryFor,
  type QuoteInput,
} from "./pricingRules";

const base: QuoteInput = {
  company: "Some Contractor",
  signs: 20,
  days: 5,
  setupDuration: "Daily Set Up (9:00 AM - 3:00) (Several Days)",
  weekendStart: false,
  hasStamp: false,
  hasPlan: true,
  parkingBan: false,
  stockpile: false,
  arrowBoards: 0,
  messageBoards: 0,
  permitCostCents: null,
};

describe("pricing rules — classification", () => {
  it("classifies industries from company names", () => {
    expect(industryFor("Kidco Construction Ltd")).toBe("utilities");
    expect(industryFor("Bowmark Group")).toBe("road");
    expect(industryFor("Telus")).toBe("telecom");
    expect(industryFor("Alpine Glass ltd")).toBe("specialty");
    expect(industryFor("Hi Nasser")).toBe("residential");
  });

  it("maps sign count to complexity", () => {
    expect(complexityForSigns(10)).toBe("simple");
    expect(complexityForSigns(20)).toBe("standard");
    expect(complexityForSigns(40)).toBe("complex");
    expect(complexityForSigns(120)).toBe("major");
  });
});

describe("pricing rules — quotes", () => {
  it("residential standard daily setup bills each day", () => {
    const q = buildQuote(base);
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(70000); // residential standard $700
    expect(setup?.quantity).toBe(5); // daily several days → per day
  });

  it("24-hour setup bills the setup once and rental per day", () => {
    const q = buildQuote({ ...base, setupDuration: "24 Hours Set Up", signs: 40 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.quantity).toBe(1);
    const rental = q.lines.find((l) => l.description.includes("Equipment rental"));
    expect(rental?.quantity).toBe(5);
    expect(rental?.unitCents).toBe(40 * 300); // 40 signs × $3/day
  });

  it("applies the Kobi 20% discount on the residential rate", () => {
    const q = buildQuote({ ...base, company: "Kobi Construction Ltd", signs: 10 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(Math.round(55000 * 0.8)); // $550 − 20% = $440
  });

  it("uses the Telus client card, including night premium", () => {
    const q = buildQuote({
      ...base,
      company: "Telus",
      setupDuration: "Nightime Work (9:00 PM - 5:00 AM)",
    });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(142500); // Telus night $1,425
  });

  it("adds weekend surcharge only to the setup fee", () => {
    const q = buildQuote({ ...base, weekendStart: true, signs: 10 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(Math.round(55000 * 1.25));
  });

  it("charges stamp when a stamped plan is attached, TMP otherwise", () => {
    const withStamp = buildQuote({ ...base, hasStamp: true });
    expect(withStamp.lines.some((l) => l.description.includes("Stamp"))).toBe(true);
    const noStamp = buildQuote(base);
    expect(
      noStamp.lines.find((l) => l.description === "Traffic Management Plan")
        ?.unitCents,
    ).toBe(40000);
  });

  it("adds stockpile surcharge over 50 signs", () => {
    const q = buildQuote({ ...base, stockpile: true, signs: 80 });
    const sp = q.lines.find((l) => l.description.startsWith("Stockpile"));
    expect(sp?.unitCents).toBe(67500); // $450 + 50%
  });

  it("passes the city permit cost through exactly", () => {
    const q = buildQuote({ ...base, permitCostCents: 21535 });
    const cp = q.lines.find((l) => l.description.includes("City permit"));
    expect(cp?.unitCents).toBe(21535);
  });
});
