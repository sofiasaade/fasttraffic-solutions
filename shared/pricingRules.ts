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
  stockpile: 45000,
  flaggerHour: 4000,
  flaggerOtHour: 6000,
} as const;

export interface QuoteInput {
  company: string | null;
  /** Per-category equipment tally (from parseEquipment on "Signs Count"). */
  equipment?: EquipmentTally;
  /** Total sign count for the job (complexity tier). */
  signs: number;
  /** Days billed (Number of Days field, else date span inclusive). */
  days: number;
  /** Airtable "Setup Duration" text. */
  setupDuration: string | null;
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

/** Build a suggested quote from the FTS pricing rules. */
export function buildQuote(input: QuoteInput): QuoteResult {
  const industry = industryFor(input.company);
  const complexity = complexityForSigns(input.signs);
  const lines: QuoteLine[] = [];
  const reasons: string[] = [];
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;

  // ---- Setup fee ----
  const night = isNight(input.setupDuration);
  let setup: number | null = null;
  let setupWhy = "";

  const override = CLIENT_SETUP_OVERRIDES.find(([re]) => re.test(input.company ?? ""));
  if (override) {
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
    rentalLine("WM + Sign", eq.wmSigns, RENTAL_RATES.windmasterSign);
    rentalLine("Sign only", eq.looseSigns, RENTAL_RATES.signOnly);
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
      description: "Sign rental",
      quantity: input.days,
      unitCents: input.signs * RENTAL_RATES.windmasterSign,
      section: "rental",
      itemQty: input.signs,
      rateCents: RENTAL_RATES.windmasterSign,
    });
    reasons.push(
      `Rental: ${input.signs} WM+Sign × $3.00 × ${input.days} day(s)`,
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
  }

  // ---- Plan / stamp ----
  if (input.hasStamp) {
    lines.push({ description: "TMP Engineering Stamp", quantity: 1, unitCents: FIXED.stamp, section: "service" });
    reasons.push("Stamped plan attached → Engineering Stamp $550");
  } else if (input.hasPlan) {
    lines.push({ description: "Traffic Management Plan", quantity: 1, unitCents: FIXED.tmpStandard, section: "service" });
    reasons.push("Plan without stamp → TMP $400 (standard)");
  }

  // ---- Permits ----
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

  // ---- Extra services ----
  if (input.parkingBan) {
    lines.push({ description: "Parking Ban (NP install)", quantity: 1, unitCents: FIXED.parkingBan, section: "service" });
    reasons.push("Parking Ban set in Airtable → $350");
  }
  if (input.stockpile) {
    const surcharge = input.signs > 50;
    const cents = surcharge ? Math.round(FIXED.stockpile * 1.5) : FIXED.stockpile;
    lines.push({
      description: `Stockpile signage${surcharge ? " (+50%, >50 signs)" : ""}`,
      quantity: 1,
      unitCents: cents,
      section: "service",
    });
    reasons.push(`Stockpile → ${money(cents)}${surcharge ? " (>50 signs surcharge)" : ""}`);
  }

  return { industry, complexity, lines, reasons };
}
