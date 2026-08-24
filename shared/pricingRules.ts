// FTS — Reglas de Cobro v3.0 (Julio 2026), encoded from the official pricing
// rules PDF (analysis of 100 QuickBooks invoices + 289 Airtable jobs).
// Everything here quotes in CENTS. GST (5%) is applied by the invoice, not here.

export type Industry =
  | "utilities"
  | "road"
  | "telecom"
  | "residential"
  | "specialty";

export type Complexity = "simple" | "standard" | "complex" | "major";

/** 5-15 simple · 15-30 standard · 30-50 complex · 50+ major */
export function complexityForSigns(signs: number): Complexity {
  if (signs > 50) return "major";
  if (signs > 30) return "complex";
  if (signs > 15) return "standard";
  return "simple";
}

// Client → industry tier (Sección 6). Checked in order; default residential.
const INDUSTRY_PATTERNS: [RegExp, Industry][] = [
  [/lbco|kobi|cannex|kidco|blue-?con|north\s*star|kang|t\.?a\.?\s*excavating|eagle\s*crest|borger/i, "utilities"],
  [/lts\s*build|volker|bow\s*mark|bowmark/i, "road"],
  [/telus|bt\s*yyc|fibercomm|wp\s*telectronics|ledcor|smart\s*home|afl\s*global/i, "telecom"],
  [/mammoet|spark\s*power|opus|birchcliff|alpine\s*glass/i, "specialty"],
];

export function industryFor(company: string | null | undefined): Industry {
  const c = company ?? "";
  for (const [re, ind] of INDUSTRY_PATTERNS) if (re.test(c)) return ind;
  return "residential";
}

// Sección 1.1 — day setup fees (midpoints of the published ranges), cents.
const DAY_SETUP: Record<Industry, Record<Complexity, number>> = {
  utilities: { simple: 65000, standard: 80000, complex: 100000, major: 120000 },
  road: { simple: 60000, standard: 95000, complex: 200000, major: 250000 },
  telecom: { simple: 55000, standard: 75000, complex: 100000, major: 170000 },
  residential: { simple: 55000, standard: 70000, complex: 90000, major: 95000 },
  specialty: { simple: 65000, standard: 75000, complex: 95000, major: 115000 },
};

// Sección 1.2 — night setup fees; industries not listed use day + $300.
const NIGHT_SETUP: Partial<Record<Industry, Record<Complexity, number>>> = {
  utilities: { simple: 85000, standard: 100000, complex: 120000, major: 135000 },
  telecom: { simple: 95000, standard: 105000, complex: 135000, major: 165000 },
  road: { simple: 80000, standard: 115000, complex: 175000, major: 300000 },
};

// Client pricing cards — setup fee per day, in cents.
// CALIBRATED Aug 2026 against QuickBooks "Sales by Product/Service Detail"
// (Jan 2025 – Aug 2026, 1,720 invoices): median of each client's actual
// "Set up (Day)" lines, clients with n ≥ 13 setups. Night = client median
// where known, else day + $200 (the observed night premium).
const CLIENT_SETUP_OVERRIDES: [RegExp, { day?: number; night?: number }][] = [
  [/lbco/i, { day: 75000 }], // n=262
  [/bow\s*-?mark|bowmark/i, { day: 40000 }], // n=240 — many small daily setups
  [/kobi/i, { day: 65000 }], // n=205 — real median (the −20% deal ≈ this)
  [/telus/i, { day: 75000, night: 95000 }], // n=122 day, n=11 night
  [/lts\s*build/i, { day: 85000 }], // n=97
  [/kidco/i, { day: 95000 }], // n=80
  [/blue-?con/i, { day: 75000 }], // n=63
  [/cannex/i, { day: 75000 }], // n=62
  [/north\s*star/i, { day: 85000 }], // n=60
  [/wpt\s*electronics|wp\s*telectronics/i, { day: 90000 }], // n=54
  [/maf-?worx/i, { day: 75000 }], // n=41
  [/precision\s*underground/i, { day: 87500 }], // n=32
  [/fibercomm/i, { day: 75000 }], // n=28
  [/marmot/i, { day: 75000 }], // n=24
  [/smart\s*(home\s*)?communications?/i, { day: 95000, night: 105000 }], // n=23
  [/dominium/i, { day: 75000 }], // n=22
  [/kang\s*construction/i, { day: 115000 }], // n=21
  [/pcl\s*construction/i, { day: 85000 }], // n=20
  [/turn\s*group/i, { day: 65000 }], // n=19
  [/t\.?a\.?\s*excavating/i, { day: 75000 }], // n=18
  [/mcintyre/i, { day: 75000 }], // n=15
  [/alpine\s*glass/i, { day: 85000, night: 145000 }], // n=15
  [/borger/i, { day: 95000 }], // n=15
  [/birchcliff/i, { day: 75000 }], // n=14
  [/alsa\s*road/i, { day: 65000 }], // n=13
];

/** Observed night premium over the client's day rate (QB medians ≈ +$200). */
const NIGHT_PREMIUM = 20000;

/**
 * Sofia's rule (Aug 24 2026, supersedes the $140/h matrix): the setup fee
 * bills by the hour at $90/h with SIX impact tiers —
 *   basic 5h ($450) · low 6h ($540) · low-medium 7h ($630) ·
 *   medium 8h ($720) · medium-high 9h ($810) · high 10h ($900).
 * A known impact tier beats every client card. Unknown impact + at most 10
 * sign panels falls back to the basic 5-hour job (Sofia: "el basic job tiene
 * max 10 señales"); more than 10 with unknown impact uses the client card.
 */
const BASIC_MAX_SIGNS = 10;
const BASIC_HOURLY_CENTS = 9000;
const IMPACT_HOURS = {
  basic: 5,
  low: 6,
  low_medium: 7,
  medium: 8,
  medium_high: 9,
  high: 10,
} as const;
type ImpactTier = keyof typeof IMPACT_HOURS;

/** Parse Airtable "Impact Category" text into the billing tier. */
export function impactTier(raw: string | null | undefined): ImpactTier | null {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return null;
  const hasLow = /low/.test(s);
  const hasMed = /med/.test(s);
  const hasHigh = /high/.test(s);
  if (hasLow && hasMed) return "low_medium";
  if (hasMed && hasHigh) return "medium_high";
  if (hasHigh) return "high";
  if (hasMed) return "medium";
  if (hasLow) return "low";
  return null;
}

// Sección 2 — equipment rental per day, cents.
export const RENTAL_RATES = {
  windmasterSign: 300, // $3.00 — the standard per-sign combo
  signOnly: 100,
  windmasterOnly: 200,
  barricade: 250,
  cone: 100,
  noParking: 150,
  flasher: 200,
  aFrame: 110,
  barrel: 125,
  pedestrianDetour: 50,
  sidewalkClosed: 50,
  messageBoard: 9500,
  arrowBoard: 4500,
  /** Arrow-board trailer — separate product from the plain arrow board (QB median $65/day). */
  arrowBoardTrailer: 6500,
  /** Arrow board WITH truck bills PER HOUR, not per day (QB: $120/h). */
  arrowBoardTruckHour: 12000,
  /** QB shows $170/day, not the $84 in the rules PDF. */
  trafficLights: 17000,
  /** Custom-fabricated sign — ONE-TIME charge per sign, not per day. */
  customSignEach: 8990,
  /** Equipment delivery / pick-up trip (QB median $225, range $85–450). */
  deliveryPickup: 22500,
  /** Mobile set-up (QB median $120). */
  mobileSetup: 12000,
} as const;

/** Per-category tally parsed from the Airtable "Signs Count" text block. */
export interface EquipmentTally {
  /** WM / Windmaster lines — each is a WM+Sign combo at $3.00/day. */
  wmSigns: number;
  /** Named sign lines (CA, CE, DA, MAX 50, …) with no WM line to carry them. */
  looseSigns: number;
  noParking: number;
  barricades: number;
  cones: number;
  flashers: number;
  aFrames: number;
  barrels: number;
  pedestrianDetour: number;
  sidewalkClosed: number;
  arrowBoards: number;
  messageBoards: number;
  /** Custom-fabricated signs — one-time charge each ($89.90). */
  customSigns: number;
  /** All sign-type items (drives the setup complexity tier). */
  totalSigns: number;
}

const EMPTY_EQUIPMENT: EquipmentTally = {
  wmSigns: 0, looseSigns: 0, noParking: 0, barricades: 0, cones: 0,
  flashers: 0, aFrames: 0, barrels: 0, pedestrianDetour: 0, sidewalkClosed: 0,
  arrowBoards: 0, messageBoards: 0, customSigns: 0, totalSigns: 0,
};

function lineQty(line: string): number {
  const m = line.match(/(\d{1,4})\s*$/);
  if (m) return parseInt(m[1], 10);
  const lead = line.match(/^\s*(\d{1,4})\s*[xX]?\b/);
  if (lead) return parseInt(lead[1], 10);
  return 1;
}

/**
 * Parse the free-text "Signs Count" block: one device per line, quantity at
 * the end ("WM 19", "BARRICADES + ROAD CLOSURE 4", "Parking Prohibited\t10").
 * Named traffic signs ride on the WM count when a WM line exists (they are the
 * signs mounted on those windmasters); with no WM line they bill as combos.
 */
export function parseEquipment(text: string | null | undefined): EquipmentTally {
  const t: EquipmentTally = { ...EMPTY_EQUIPMENT };
  if (!text) return t;
  // "SIGNS 22" summary lines and itemized named-sign lines describe the SAME
  // panels — use whichever is larger, never the sum.
  let signsSummary = 0;
  let itemizedSigns = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^PHASE\s*\d/i.test(line)) continue;
    const U = line.toUpperCase();
    const qty = lineQty(line);
    if (/CUSTOM/.test(U)) t.customSigns += qty;
    else if (/MESSAGE\s*BOARD|\bVMB\b|\bVMS\b|VARIABLE\s+MESSAGE/.test(U)) t.messageBoards += qty;
    else if (/ARROW\s*BOARD|\bABL\b|\bABR\b|\bDAB\b/.test(U)) t.arrowBoards += qty;
    else if (/WINDMASTER|^WM\b/.test(U)) t.wmSigns += qty;
    else if (/CONE/.test(U)) t.cones += qty;
    else if (/BARRICADE/.test(U)) t.barricades += qty;
    else if (/PARKING\s*PROHIBITED|NO\s*PARKING|^NP\b\s*-?/.test(U)) t.noParking += qty;
    else if (/FLASHER/.test(U)) t.flashers += qty;
    else if (/A[\s-]?FRAME/.test(U)) t.aFrames += qty;
    else if (/BARREL/.test(U)) t.barrels += qty;
    else if (/PEDESTRIAN|^PDL\b|^PDR\b/.test(U)) t.pedestrianDetour += qty;
    else if (/SIDEWALK\s*CLOSED|^SC\b\s*-?/.test(U)) t.sidewalkClosed += qty;
    else if (/^SIGNS?\b/.test(U)) signsSummary += qty; // "SIGNS 22" summary line
    else if (/\d\s*$/.test(line)) itemizedSigns += qty; // named sign, e.g. "CA - CONSTRUCTION AHEAD 4"
  }
  const namedSigns = Math.max(signsSummary, itemizedSigns);
  // Named signs are the panels mounted on the windmasters; only the excess
  // over the WM count bills separately (as sign-only rentals → loose).
  t.looseSigns = t.wmSigns > 0 ? Math.max(0, namedSigns - t.wmSigns) : namedSigns;
  if (t.wmSigns === 0) {
    // No windmaster line: named signs still need bases → bill as combos.
    t.wmSigns = t.looseSigns;
    t.looseSigns = 0;
  }
  t.totalSigns =
    Math.max(t.wmSigns, namedSigns) +
    t.noParking +
    t.pedestrianDetour +
    t.sidewalkClosed +
    t.customSigns;
  return t;
}

// Sección 3 — fixed services, cents.
export const FIXED = {
  permitAcq: 5000,
  stamp: 55000,
  tmpStandard: 40000,
  parkingBan: 35000,
  /** Stockpile: Sofia's rule (Aug 2026) — <80 signs $450, ≥80 signs $950. */
  /** Stockpile signage — ALWAYS $450 (Sofia, Aug 24 2026: no size tiers). */
  stockpile: 45000,
  flaggerHour: 4000,
  flaggerOtHour: 6000,
} as const;

/**
 * Airtable "Type of Submission" — gates WHAT is billable (Sofia, Aug 2026):
 *  - full_pack: whole process (plan, permit acquisition, setup, pickup) → bill everything.
 *  - plan_only: we only made the plan → bill just the plan.
 *  - plan_and_setup: client pulls AND pays the permit → bill plan + setup + rental,
 *    NO permit pass-through and NO $50 ACQ.
 *  - setup_only: client made their own plans and pulled the permit → bill only
 *    setup (+ our equipment rental); no plan, no ACQ, no permits.
 *  - no_parking_setup: we only installed No Parking signs → Parking Ban install
 *    + NP sign rental; no setup fee, no plan, no permits.
 *  - plan_and_sign_rental: we made the plans (billed) + rental, client pulled
 *    the permits → no ACQ, no permit pass-through, no setup fee.
 */
export type SubmissionType =
  | "full_pack"
  | "plan_only"
  | "plan_and_setup"
  | "setup_only"
  | "no_parking_setup"
  | "plan_and_sign_rental"
  | "unknown";

export function parseSubmissionType(
  raw: string | null | undefined,
): SubmissionType {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return "unknown";
  if (/plan\s*only/.test(s)) return "plan_only";
  if (/no\s*parking/.test(s)) return "no_parking_setup";
  if (/plan\b.*(sign|rental)/.test(s)) return "plan_and_sign_rental";
  if (/plan\b.*set\s*-?up|set\s*-?up.*\bplan/.test(s)) return "plan_and_setup";
  if (/set\s*-?up\s*only/.test(s)) return "setup_only";
  if (/full/.test(s)) return "full_pack";
  return "unknown";
}

/** Short human label for the submission type (invoice workspace chip). */
export function submissionTypeLabel(t: SubmissionType): string {
  switch (t) {
    case "full_pack": return "Full pack";
    case "plan_only": return "Plan Only";
    case "plan_and_setup": return "Plan and Set up";
    case "setup_only": return "Set up Only";
    case "no_parking_setup": return "No Parking Set up";
    case "plan_and_sign_rental": return "Plan and Sign rental";
    default: return "Unknown";
  }
}

/** What the submission type means for billing (shown next to the chip). */
export function submissionTypeBillingNote(t: SubmissionType): string | null {
  switch (t) {
    case "full_pack": return "Bill everything: plan, permits, setup, rental.";
    case "plan_only": return "Bill ONLY the plan — no setup, no rental, no permits.";
    case "plan_and_setup": return "Client pays the permit — do NOT bill permits or the $50 ACQ.";
    case "setup_only": return "Client made plans & pulled permit — bill only setup + rental.";
    case "no_parking_setup": return "Only NP signs installed — Parking Ban + NP sign rental only.";
    case "plan_and_sign_rental": return "Bill plan + rental; client pulled permits — no ACQ, no permits, no setup fee.";
    default: return null;
  }
}

export interface QuoteInput {
  company: string | null;
  /** Per-category equipment tally (from parseEquipment on "Signs Count"). */
  equipment?: EquipmentTally;
  /** Total sign count for the job (complexity tier). */
  signs: number;
  /**
   * ONLY the traffic-sign panels (WM + loose signs) — Sofia's rule: the
   * low-impact <25/25+ threshold counts just these, not NP/pedestrian/etc.
   */
  panelSigns?: number;
  /** Days billed (Number of Days field, else date span inclusive). */
  days: number;
  /** Airtable "Setup Duration" text. */
  setupDuration: string | null;
  /** Airtable "Impact Category" (e.g. "2️⃣ Low") — drives the hourly setup rule. */
  impact?: string | null;
  /** "Plan Only" job: ONLY the plan is billed — no setup, no rental, nothing else. */
  planOnly?: boolean;
  /** Airtable "Type of Submission" — gates which sections are billable. */
  submissionType?: SubmissionType;
  /**
   * Codes/names of the DISTINCT stamped plans — one $550 stamp line each
   * (Sofia: "se le cobra uno a uno si son 3 planos distintos").
   */
  stampedPlans?: string[];
  /** Job starts on a Saturday or Sunday. */
  weekendStart: boolean;
  /** A stamped plan is attached. */
  hasStamp: boolean;
  /** Has a plan attached at all (charges TMP when not stamped). */
  hasPlan: boolean;
  /** Airtable "Parking Ban" is set to something affirmative. */
  parkingBan: boolean;
  /** Airtable "Stockpile" is set to something affirmative. */
  stockpile: boolean;
  arrowBoards: number;
  messageBoards: number;
  /** City permit cost in cents (pass-through), if known. */
  permitCostCents: number | null;
  /**
   * Itemized city permits (one line each): SU code + dates + exact cost.
   * When present these REPLACE the single permitCostCents line.
   */
  permitLines?: { label: string; cents: number }[];
}

export interface QuoteLine {
  description: string;
  quantity: number;
  unitCents: number;
  /** Invoice editor section: sign/equipment rental vs the other charges. */
  section?: "rental" | "service";
  /** Rental lines: number of devices (e.g. 16 signs). */
  itemQty?: number;
  /** Rental lines: per-device per-day rate in cents (e.g. 300 = $3.00/day). */
  rateCents?: number;
}

export interface QuoteResult {
  industry: Industry;
  complexity: Complexity;
  lines: QuoteLine[];
  /** Human-readable notes on how each number was chosen. */
  reasons: string[];
}

function isNight(setupDuration: string | null): boolean {
  return /night/i.test(setupDuration ?? "");
}
function isDailySeveral(setupDuration: string | null): boolean {
  return /several/i.test(setupDuration ?? "");
}


function pushStampLines(lines: QuoteLine[], input: QuoteInput): boolean {
  // One Engineering Stamp per distinct stamped plan, labeled with its code.
  if (input.stampedPlans && input.stampedPlans.length > 0) {
    for (const code of input.stampedPlans) {
      lines.push({
        description: `TMP Engineering Stamp — ${code}`,
        quantity: 1,
        unitCents: FIXED.stamp,
        section: "service",
      });
    }
    return true;
  }
  if (input.hasStamp) {
    lines.push({ description: "TMP Engineering Stamp", quantity: 1, unitCents: FIXED.stamp, section: "service" });
    return true;
  }
  return false;
}

/** Build a suggested quote from the FTS pricing rules. */
export function buildQuote(input: QuoteInput): QuoteResult {
  const industry = industryFor(input.company);
  const complexity = complexityForSigns(input.signs);
  const lines: QuoteLine[] = [];
  const reasons: string[] = [];
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;

  // ---- Type of Submission gates (Sofia, Aug 2026) ----
  const st = input.submissionType ?? "unknown";
  const billSetup = st !== "plan_and_sign_rental" && st !== "no_parking_setup";
  const billPlan = st !== "setup_only" && st !== "no_parking_setup";
  const billPermits = st === "full_pack" || st === "unknown";
  if (st !== "unknown") {
    reasons.push(`Type of Submission: ${submissionTypeLabel(st)} — ${submissionTypeBillingNote(st)}`);
  }

  // "No Parking Set up": we ONLY installed the No Parking signs — bill the
  // Parking Ban install + NP sign rental; no setup fee, no plan, no permits.
  if (st === "no_parking_setup") {
    const np = input.equipment?.noParking ?? 0;
    const npDays = Math.max(1, input.days);
    if (np > 0) {
      lines.push({
        description: "No Parking signs",
        quantity: npDays,
        unitCents: np * RENTAL_RATES.noParking,
        section: "rental",
        itemQty: np,
        rateCents: RENTAL_RATES.noParking,
      });
    }
    lines.push({ description: "Parking Ban (NP install)", quantity: 1, unitCents: FIXED.parkingBan, section: "service" });
    return { industry, complexity, lines, reasons };
  }

  // "Plan Only": the client only got the plan — bill the plan (stamp or TMP)
  // and any FTS-pulled city-permit costs; NO setup, NO rental, NO signs.
  if (input.planOnly || st === "plan_only") {
    if (pushStampLines(lines, input)) {
      // stamped plan lines added
    } else if (input.hasPlan) {
      lines.push({ description: "Traffic Management Plan", quantity: 1, unitCents: FIXED.tmpStandard, section: "service" });
    }
    if (input.permitLines && input.permitLines.length > 0) {
      lines.push({ description: "Permit acquisition (ACQ)", quantity: 1, unitCents: FIXED.permitAcq, section: "service" });
      for (const p of input.permitLines) {
        lines.push({ description: p.label, quantity: 1, unitCents: p.cents, section: "service" });
      }
    } else if (input.permitCostCents && input.permitCostCents > 0) {
      lines.push({ description: "Permit acquisition (ACQ)", quantity: 1, unitCents: FIXED.permitAcq, section: "service" });
      lines.push({ description: "Street Use Permit — city cost (pass-through)", quantity: 1, unitCents: input.permitCostCents, section: "service" });
    }
    reasons.push("PLAN ONLY — only the plan is billed: no setup, no rental, no signs");
    return { industry, complexity, lines, reasons };
  }

  // ---- Setup fee ----
  if (billSetup) {
  const night = isNight(input.setupDuration);
  let setup: number | null = null;
  let setupWhy = "";

  // Setup bills hourly at $90/h across SIX impact tiers — beats every card.
  // Unknown impact + <25 sign panels = the basic 5-hour job.
  const tier = impactTier(input.impact);
  const thresholdSigns = input.panelSigns ?? input.signs;
  const smallJob = thresholdSigns <= BASIC_MAX_SIGNS;
  const effectiveTier: ImpactTier | null =
    tier ?? (smallJob && thresholdSigns > 0 ? "basic" : null);
  if (effectiveTier) {
    const hours = IMPACT_HOURS[effectiveTier];
    setup = hours * BASIC_HOURLY_CENTS;
    const label =
      effectiveTier === "basic"
        ? "basic job"
        : `${effectiveTier.replace("_", "-")} impact`;
    setupWhy = `${label}: ${hours}h × $${(BASIC_HOURLY_CENTS / 100).toFixed(0)}/h`;
    if (night) {
      setup += NIGHT_PREMIUM;
      setupWhy += " · night premium";
    }
  }

  const override = CLIENT_SETUP_OVERRIDES.find(([re]) => re.test(input.company ?? ""));
  if (setup === null && override) {
    const o = override[1];
    setup = night ? (o.night ?? (o.day ?? 0) + NIGHT_PREMIUM) : (o.day ?? null);
    if (setup) setupWhy = `client card, QB median (${night ? "night" : "day"})`;
  }
  if (setup === null) {
    setup = night
      ? (NIGHT_SETUP[industry]?.[complexity] ?? DAY_SETUP[industry][complexity] + NIGHT_PREMIUM)
      : DAY_SETUP[industry][complexity];
    setupWhy = `${industry} · ${complexity} (${input.signs} signs)${night ? " · night" : ""}`;
  }
  if (input.weekendStart) {
    setup = Math.round(setup * 1.25);
    setupWhy += " · weekend +25%";
  }

  // Daily "several days" setups bill the setup each day; 24-hour and single
  // setups bill it once (rental covers the standing days).
  const setupQty = isDailySeveral(input.setupDuration) ? Math.max(1, input.days) : 1;
  lines.push({
    description: `Setup fee — ${setupWhy}`,
    quantity: setupQty,
    unitCents: setup,
    section: "service",
  });
  reasons.push(
    `Setup ${money(setup)} × ${setupQty}: ${setupWhy}${setupQty > 1 ? " — daily setup bills each day" : ""}`,
  );
  } // billSetup

  // ---- Equipment rental — per-category breakdown when we parsed the field ----
  const eq = input.equipment;
  const days = Math.max(1, input.days);
  if (eq && (eq.wmSigns || eq.barricades || eq.cones || eq.noParking || eq.customSigns)) {
    // Itemized rental section: one line per device category (its own section
    // in the invoice editor, with the per-day rate visible on every line).
    let rentalTotal = 0;
    const rentalLine = (label: string, qty: number, rateCents: number) => {
      if (qty <= 0) return;
      rentalTotal += qty * rateCents * days;
      lines.push({
        description: label,
        quantity: days,
        unitCents: qty * rateCents,
        section: "rental",
        itemQty: qty,
        rateCents,
      });
    };
    // Sofia's rule (Aug 2026): windmasters and signs bill as SEPARATE lines —
    // windmasters $2.00/day, sign panels $1.00/day (same $3 total per combo).
    rentalLine("Windmasters", eq.wmSigns, RENTAL_RATES.windmasterOnly);
    rentalLine("Signs", eq.wmSigns + eq.looseSigns, RENTAL_RATES.signOnly);
    rentalLine("No Parking signs", eq.noParking, RENTAL_RATES.noParking);
    rentalLine("Barricades", eq.barricades, RENTAL_RATES.barricade);
    rentalLine("Cones", eq.cones, RENTAL_RATES.cone);
    rentalLine("Flashers", eq.flashers, RENTAL_RATES.flasher);
    rentalLine("A-Frame stands", eq.aFrames, RENTAL_RATES.aFrame);
    rentalLine("Barrels", eq.barrels, RENTAL_RATES.barrel);
    rentalLine("Pedestrian detour signs", eq.pedestrianDetour, RENTAL_RATES.pedestrianDetour);
    rentalLine("Sidewalk closed signs", eq.sidewalkClosed, RENTAL_RATES.sidewalkClosed);
    if (eq.customSigns > 0) {
      // Custom signs are a ONE-TIME fabrication charge, not a daily rental.
      rentalTotal += eq.customSigns * RENTAL_RATES.customSignEach;
      lines.push({
        description: "Custom signs (one-time charge)",
        quantity: 1,
        unitCents: eq.customSigns * RENTAL_RATES.customSignEach,
        section: "rental",
        itemQty: eq.customSigns,
        rateCents: RENTAL_RATES.customSignEach,
      });
      reasons.push(
        `${eq.customSigns} custom sign(s) × $${(RENTAL_RATES.customSignEach / 100).toFixed(2)} — one-time fabrication charge`,
      );
    }
    if (rentalTotal > 0) {
      reasons.push(
        `Sign & equipment rental (itemized from Signs Count) × ${days} day(s) = $${(rentalTotal / 100).toFixed(2)}`,
      );
    }
  } else if (input.signs > 0 && input.days > 0) {
    lines.push({
      description: "Windmasters",
      quantity: input.days,
      unitCents: input.signs * RENTAL_RATES.windmasterOnly,
      section: "rental",
      itemQty: input.signs,
      rateCents: RENTAL_RATES.windmasterOnly,
    });
    lines.push({
      description: "Signs",
      quantity: input.days,
      unitCents: input.signs * RENTAL_RATES.signOnly,
      section: "rental",
      itemQty: input.signs,
      rateCents: RENTAL_RATES.signOnly,
    });
    reasons.push(
      `Rental: ${input.signs} windmasters × $2.00 + ${input.signs} signs × $1.00 × ${input.days} day(s)`,
    );
  } else {
    reasons.push(
      "No equipment found in Airtable Signs Count — add the rental line manually",
    );
  }
  if (input.arrowBoards > 0 && input.days > 0) {
    lines.push({
      description: `Arrow board × ${input.arrowBoards} — $45.00/day`,
      quantity: input.days,
      unitCents: input.arrowBoards * RENTAL_RATES.arrowBoard,
      section: "rental",
    });
  }
  if (input.messageBoards > 0 && input.days > 0) {
    lines.push({
      description: `Message board × ${input.messageBoards} — $95.00/day`,
      quantity: input.days,
      unitCents: input.messageBoards * RENTAL_RATES.messageBoard,
      section: "rental",
    });
    // Sofia (Aug 24 2026): MORE than one message board adds a $250 delivery.
    if (input.messageBoards > 1) {
      lines.push({
        description: "Message board delivery",
        quantity: 1,
        unitCents: 25000,
        section: "service",
      });
      reasons.push(
        `${input.messageBoards} message boards → $250.00 delivery charge`,
      );
    }
  }

  // ---- Plan / stamp ----
  if (!billPlan) {
    // setup_only: the client made their own plans — nothing to bill here.
  } else if (pushStampLines(lines, input)) {
    const n = input.stampedPlans?.length ?? 1;
    reasons.push(
      n > 1
        ? `${n} distinct stamped plans → ${n} × Engineering Stamp $550`
        : "Stamped plan attached → Engineering Stamp $550",
    );
  } else if (input.hasPlan) {
    lines.push({ description: "Traffic Management Plan", quantity: 1, unitCents: FIXED.tmpStandard, section: "service" });
    reasons.push("Plan without stamp → TMP $400 (standard)");
  }

  // ---- Permits ----
  if (!billPermits) {
    // Client pulls (and pays) the permits under this submission type: no
    // $50 ACQ and no city-cost pass-through.
  } else {
  lines.push({ description: "Permit acquisition (ACQ)", quantity: 1, unitCents: FIXED.permitAcq, section: "service" });
  if (input.permitLines && input.permitLines.length > 0) {
    for (const p of input.permitLines) {
      lines.push({
        description: p.label,
        quantity: 1,
        unitCents: p.cents,
        section: "service",
      });
    }
    reasons.push(
      `City permits (pass-through): ${input.permitLines
        .map((p) => `${p.label} ${money(p.cents)}`)
        .join(" · ")}`,
    );
  } else if (input.permitCostCents && input.permitCostCents > 0) {
    lines.push({
      description: "Street Use Permit — city cost (pass-through)",
      quantity: 1,
      unitCents: input.permitCostCents,
      section: "service",
    });
    reasons.push(`City permit pass-through ${money(input.permitCostCents)}`);
  }
  } // billPermits

  // ---- Extra services ----
  if (input.parkingBan) {
    lines.push({ description: "Parking Ban (NP install)", quantity: 1, unitCents: FIXED.parkingBan, section: "service" });
    reasons.push("Parking Ban set in Airtable → $350");
  }
  if (input.stockpile) {
    lines.push({
      description: "Stockpile signage",
      quantity: 1,
      unitCents: FIXED.stockpile,
      section: "service",
    });
    reasons.push(`Stockpile → ${money(FIXED.stockpile)} (flat — never changes)`);
  }

  return { industry, complexity, lines, reasons };
}
