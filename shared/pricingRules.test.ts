import { describe, expect, it } from "vitest";
import { isPermitPulledByFts } from "./permitSchedule";
import {
  buildQuote,
  complexityForSigns,
  industryFor,
  parseSubmissionType,
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
  it("basic jobs (max 10 signs) bill setup as 5h × $90/h = $450", () => {
    const q = buildQuote({ ...base, signs: 10, company: "Kobi Construction Ltd" });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(45000); // beats the client card for basics
  });

  it("11+ signs with unknown impact is NOT basic — falls to the client card", () => {
    const q = buildQuote({ ...base, signs: 12, company: "Kobi Construction Ltd" });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).not.toBe(45000);
    expect(setup?.unitCents).toBe(65000); // Kobi QB median card
  });

  it("low impact bills 6h × $90 = $540 at any sign count", () => {
    const small = buildQuote({ ...base, signs: 12, impact: "2️⃣ Low" });
    expect(
      small.lines.find((l) => l.description.startsWith("Setup fee"))?.unitCents,
    ).toBe(54000); // 6h × $90
    const large = buildQuote({ ...base, signs: 30, impact: "2️⃣ Low" });
    expect(
      large.lines.find((l) => l.description.startsWith("Setup fee"))?.unitCents,
    ).toBe(54000); // same tier — count no longer changes the hours
  });

  it("intermediate tiers: low-medium 7h ($630) and medium-high 9h ($810)", () => {
    const lm = buildQuote({ ...base, signs: 20, impact: "Low-Medium" });
    expect(
      lm.lines.find((l) => l.description.startsWith("Setup fee"))?.unitCents,
    ).toBe(63000);
    const mh = buildQuote({ ...base, signs: 20, impact: "Medium-High" });
    expect(
      mh.lines.find((l) => l.description.startsWith("Setup fee"))?.unitCents,
    ).toBe(81000);
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
    expect(setup?.unitCents).toBe(Math.round(45000 * 1.25)); // basic $450 +25%
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

  it("stockpile: $450 up to 60 signs, DOUBLE ($900) above 60", () => {
    const small = buildQuote({ ...base, stockpile: true, signs: 40 });
    expect(
      small.lines.find((l) => l.description.startsWith("Stockpile"))?.unitCents,
    ).toBe(45000);
    const atSixty = buildQuote({ ...base, stockpile: true, signs: 60 });
    expect(
      atSixty.lines.find((l) => l.description.startsWith("Stockpile"))?.unitCents,
    ).toBe(45000);
    const large = buildQuote({ ...base, stockpile: true, signs: 61 });
    expect(
      large.lines.find((l) => l.description.startsWith("Stockpile"))?.unitCents,
    ).toBe(90000);
  });

  it("2+ message boards add the $250 delivery charge; 1 does not", () => {
    const one = buildQuote({ ...base, messageBoards: 1, days: 3 });
    expect(one.lines.some((l) => /Message board delivery/.test(l.description))).toBe(false);
    const two = buildQuote({ ...base, messageBoards: 2, days: 3 });
    const del = two.lines.find((l) => /Message board delivery/.test(l.description));
    expect(del?.unitCents).toBe(25000);
    expect(del?.quantity).toBe(1);
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

describe("low-impact threshold counts only sign panels", () => {
  it("20 WM + 30 NP signs is still a 4h low-impact job (panels < 25)", () => {
    const eq = parseEquipment("WM 20\nParking Prohibited 30");
    expect(eq.wmSigns).toBe(20);
    expect(eq.totalSigns).toBeGreaterThan(25); // total includes NP…
    const q = buildQuote({
      company: "Test Co",
      equipment: eq,
      signs: eq.totalSigns,
      panelSigns: eq.wmSigns + eq.looseSigns,
      days: 1,
      setupDuration: "Daytime Work (7:00 AM - 5:00 PM)",
      impact: "2️⃣ Low",
      weekendStart: false,
      hasStamp: false,
      hasPlan: false,
      parkingBan: false,
      stockpile: false,
      arrowBoards: 0,
      messageBoards: 0,
      permitCostCents: null,
    });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(54000); // …low tier: 6h × $90
  });
});

describe("high impact setup", () => {
  it("high impact bills 10h × $90 = $900", () => {
    const q = buildQuote({ ...baseInput(), impact: "🔴 High", signs: 60 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(90000);
  });
});

function baseInput(): QuoteInput {
  return {
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
}

describe("medium impact setup", () => {
  it("medium impact bills 8h × $90 = $720", () => {
    const q = buildQuote({ ...baseInput(), impact: "3️⃣ Medium", signs: 30 });
    const setup = q.lines.find((l) => l.description.startsWith("Setup fee"));
    expect(setup?.unitCents).toBe(72000);
  });
});

describe("plan-only jobs", () => {
  it("bills ONLY the plan — no setup, no rental", () => {
    const q = buildQuote({ ...baseInput(), planOnly: true, hasStamp: true, signs: 40 });
    expect(q.lines.some((l) => l.description.startsWith("Setup fee"))).toBe(false);
    expect(q.lines.some((l) => l.section === "rental")).toBe(false);
    expect(q.lines.some((l) => l.description.includes("Stamp"))).toBe(true);
  });
});

describe("Type of Submission gates (Sofia, Aug 2026)", () => {
  it("parses the Airtable values", () => {
    expect(parseSubmissionType("Full Pack")).toBe("full_pack");
    expect(parseSubmissionType("Plan Only")).toBe("plan_only");
    expect(parseSubmissionType("Plan and Set up")).toBe("plan_and_setup");
    expect(parseSubmissionType("Set up Only")).toBe("setup_only");
    expect(parseSubmissionType("No Parking Set up")).toBe("no_parking_setup");
    expect(parseSubmissionType("Plan and Sign rental")).toBe("plan_and_sign_rental");
    expect(parseSubmissionType(null)).toBe("unknown");
  });

  const withPermits = (): QuoteInput => ({
    ...baseInput(),
    hasPlan: true,
    permitLines: [{ label: "Street Use Permit SU-26-1 — Jul 1", cents: 22105 }],
  });
  const has = (q: { lines: { description: string }[] }, re: RegExp) =>
    q.lines.some((l) => re.test(l.description));

  it("full pack bills everything", () => {
    const q = buildQuote({ ...withPermits(), submissionType: "full_pack" });
    expect(has(q, /^Setup fee/)).toBe(true);
    expect(has(q, /Traffic Management Plan|Stamp/)).toBe(true);
    expect(has(q, /Permit acquisition/)).toBe(true);
    expect(has(q, /Street Use Permit/)).toBe(true);
  });

  it("plan and set up: client pays the permit — no ACQ, no pass-through", () => {
    const q = buildQuote({ ...withPermits(), submissionType: "plan_and_setup" });
    expect(has(q, /^Setup fee/)).toBe(true);
    expect(has(q, /Traffic Management Plan|Stamp/)).toBe(true);
    expect(has(q, /Permit acquisition/)).toBe(false);
    expect(has(q, /Street Use Permit/)).toBe(false);
  });

  it("set up only: no plan, no permits — setup + rental still bill", () => {
    const q = buildQuote({ ...withPermits(), submissionType: "setup_only" });
    expect(has(q, /^Setup fee/)).toBe(true);
    expect(q.lines.some((l) => l.section === "rental")).toBe(true);
    expect(has(q, /Traffic Management Plan|Stamp/)).toBe(false);
    expect(has(q, /Permit acquisition|Street Use Permit/)).toBe(false);
  });

  it("plan and sign rental: plan + rental only — no setup fee, no permits", () => {
    const q = buildQuote({ ...withPermits(), submissionType: "plan_and_sign_rental" });
    expect(has(q, /^Setup fee/)).toBe(false);
    expect(q.lines.some((l) => l.section === "rental")).toBe(true);
    expect(has(q, /Traffic Management Plan|Stamp/)).toBe(true);
    expect(has(q, /Permit acquisition|Street Use Permit/)).toBe(false);
  });

  it("no parking set up: only Parking Ban + NP sign rental", () => {
    const q = buildQuote({
      ...withPermits(),
      submissionType: "no_parking_setup",
      equipment: { ...({} as any), wmSigns: 5, looseSigns: 0, noParking: 12, barricades: 2, cones: 0, flashers: 0, aFrames: 0, barrels: 0, pedestrianDetour: 0, sidewalkClosed: 0, arrowBoards: 0, messageBoards: 0, customSigns: 0, totalSigns: 17 },
    });
    expect(has(q, /^Setup fee/)).toBe(false);
    expect(has(q, /Parking Ban/)).toBe(true);
    const np = q.lines.find((l) => l.description === "No Parking signs");
    expect(np?.itemQty).toBe(12);
    expect(q.lines.filter((l) => l.section === "rental")).toHaveLength(1);
    expect(has(q, /Permit acquisition|Street Use Permit|Traffic Management Plan/)).toBe(false);
  });

  it("plan_only via submission type behaves like planOnly", () => {
    const q = buildQuote({ ...baseInput(), submissionType: "plan_only", hasStamp: true });
    expect(has(q, /^Setup fee/)).toBe(false);
    expect(q.lines.some((l) => l.section === "rental")).toBe(false);
    expect(has(q, /Stamp/)).toBe(true);
  });
});

describe("permit ownership (On Behalf Of)", () => {
  it("FTS-pulled, unknown, and client-pulled permits", () => {
    expect(isPermitPulledByFts("LBCO / FTS Fast Traffic Solutions")).toBe(true);
    expect(isPermitPulledByFts("Fast Traffic Solutions")).toBe(true);
    expect(isPermitPulledByFts(null)).toBe(true); // unknown → keep billing (safe default)
    expect(isPermitPulledByFts("LBCO Contracting")).toBe(false);
    expect(isPermitPulledByFts("Kobi Construction Ltd")).toBe(false);
  });
});
