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
  it("basic jobs (<25 signs) bill setup as 4h × $140/h = $560", () => {
    const q = buildQuote({ ...base, signs: 10, company: "Kobi Construction Ltd" });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(56000); // beats the client card for basics
  });

  it("residential standard daily setup bills each day", () => {
    const q = buildQuote({ ...base, signs: 28 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(70000); // residential standard $700
    expect(setup?.quantity).toBe(5); // daily several days → per day
  });

  it("24-hour setup bills the setup once and rental per day", () => {
    const q = buildQuote({ ...base, setupDuration: "24 Hours Set Up", signs: 40 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.quantity).toBe(1);
    const wm = q.lines.find((l) => l.description === "Windmasters");
    const signs = q.lines.find((l) => l.description === "Signs");
    expect(wm?.quantity).toBe(5);
    expect(wm?.unitCents).toBe(40 * 200); // 40 windmasters × $2/day
    expect(signs?.unitCents).toBe(40 * 100); // 40 signs × $1/day
  });

  it("uses Kobi's calibrated QB rate ($650 day median, n=205)", () => {
    const q = buildQuote({ ...base, company: "Kobi Construction Ltd", signs: 30 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(65000);
  });

  it("uses the Telus client card, including night premium", () => {
    const q = buildQuote({
      ...base,
      signs: 30,
      company: "Telus",
      setupDuration: "Nightime Work (9:00 PM - 5:00 AM)",
    });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(95000); // Telus night — QB median $950
  });

  it("adds weekend surcharge only to the setup fee", () => {
    const q = buildQuote({ ...base, weekendStart: true, signs: 10 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(Math.round(56000 * 1.25)); // basic $560 +25%
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
    const cp = q.lines.find((l) => l.description.includes("Street Use Permit"));
    expect(cp?.unitCents).toBe(21535);
  });
});

import { parseEquipment } from "./pricingRules";

describe("parseEquipment (Signs Count block)", () => {
  it("parses a Kobi-style tab-separated block with WM covering named signs", () => {
    const t = parseEquipment(
      "SIGNS\t22\nWM\t22\nBARRICADES (Plain)\t3\nBARRICADES + ROAD CLOSURE\t4\nParking Prohibited\t10\nCA - Construction Ahead\t6\nSC-Sidewalk Closed\t2\nPedestrian Detour Right\t1",
    );
    expect(t.wmSigns).toBe(22);
    expect(t.barricades).toBe(7);
    expect(t.noParking).toBe(10);
    expect(t.sidewalkClosed).toBe(2);
    expect(t.pedestrianDetour).toBe(1);
    // 22 named signs ride on the 22 windmasters — nothing loose.
    expect(t.looseSigns).toBe(0);
    expect(t.totalSigns).toBe(22 + 13); // max(SIGNS 22, itemized) + 10 NP + 2 SC + 1 PD
  });

  it("bills named signs as combos when there is no WM line", () => {
    const t = parseEquipment(
      "Sidewalk closed 7\npedestrian right 4\npedestrian left 3\nparking prohibited 32",
    );
    expect(t.wmSigns).toBe(0);
    expect(t.noParking).toBe(32);
    expect(t.pedestrianDetour).toBe(7);
    expect(t.sidewalkClosed).toBe(7);
  });

  it("counts cones and boards", () => {
    const t = parseEquipment("WM 19\nCONES 30\nVMB-MESSAGE BOARD 1\nABL 2");
    expect(t.wmSigns).toBe(19);
    expect(t.cones).toBe(30);
    expect(t.messageBoards).toBe(1);
    expect(t.arrowBoards).toBe(2);
  });
});

describe("custom signs pricing", () => {
  it("charges custom signs once at $89.90 each, not per day", () => {
    const eq = parseEquipment("WM 10\nCUSTOM SIGN - ROAD WORK 3\nCONES 5");
    expect(eq.customSigns).toBe(3);
    const q = buildQuote({
      company: "Test Co",
      equipment: eq,
      signs: eq.totalSigns,
      days: 4,
      setupDuration: "Daytime Work (7:00 AM - 5:00 PM)",
      weekendStart: false,
      hasStamp: false,
      hasPlan: false,
      parkingBan: false,
      stockpile: false,
      arrowBoards: 0,
      messageBoards: 0,
      permitCostCents: null,
    });
    const custom = q.lines.find((l) => /custom/i.test(l.description));
    expect(custom).toBeTruthy();
    expect(custom!.quantity).toBe(1);            // one-time charge
    expect(custom!.unitCents).toBe(3 * 8990);    // 3 signs × $89.90
    expect(custom!.itemQty).toBe(3);
    expect(custom!.rateCents).toBe(8990);
    const wm = q.lines.find((l) => l.description === "Windmasters");
    expect(wm!.quantity).toBe(4);           // rental IS per day
  });
});
