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

// Sección 7 — client pricing cards (setup fee overrides, cents).
const CLIENT_SETUP_OVERRIDES: [RegExp, { day?: number; night?: number }][] = [
  [/lbco/i, { day: 80000, night: 95000 }],
  [/telus/i, { day: 106000, night: 142500 }],
  [/north\s*star/i, { day: 125000 }],
  [/cannex/i, { day: 70000 }],
];

/** Kobi: verbal 20% discount — residential rate minus 20% (Sección 1.3). */
const KOBI_RE = /kobi/i;

// Sección 2 — equipment rental per day, cents.
export const RENTAL_RATES = {
  windmasterSign: 300, // $3.00 — the standard per-sign combo
  messageBoard: 9500,
  arrowBoard: 4500,
  trafficLights: 8400,
} as const;

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
  /** Total sign count for the job. */
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
}

export interface QuoteLine {
  description: string;
  quantity: number;
  unitCents: number;
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
    setup = night ? (o.night ?? (o.day ?? 0) + 30000) : (o.day ?? null);
    if (setup) setupWhy = `client pricing card (${night ? "night" : "day"})`;
  }
  if (setup === null && KOBI_RE.test(input.company ?? "")) {
    const base = night
      ? DAY_SETUP.residential[complexity] + 30000
      : DAY_SETUP.residential[complexity];
    setup = Math.round(base * 0.8);
    setupWhy = "Kobi agreement: residential rate −20%";
  }
  if (setup === null) {
    setup = night
      ? (NIGHT_SETUP[industry]?.[complexity] ?? DAY_SETUP[industry][complexity] + 30000)
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
  });
  reasons.push(
    `Setup ${money(setup)} × ${setupQty}: ${setupWhy}${setupQty > 1 ? " — daily setup bills each day" : ""}`,
  );

  // ---- Equipment rental ----
  if (input.signs > 0 && input.days > 0) {
    lines.push({
      description: `Equipment rental — ${input.signs} signs × $3.00/day`,
      quantity: input.days,
      unitCents: input.signs * RENTAL_RATES.windmasterSign,
    });
    reasons.push(
      `Rental: ${input.signs} WM+Sign × $3.00 × ${input.days} day(s)`,
    );
  }
  if (input.arrowBoards > 0 && input.days > 0) {
    lines.push({
      description: `Arrow board × ${input.arrowBoards} — $45.00/day`,
      quantity: input.days,
      unitCents: input.arrowBoards * RENTAL_RATES.arrowBoard,
    });
  }
  if (input.messageBoards > 0 && input.days > 0) {
    lines.push({
      description: `Message board × ${input.messageBoards} — $95.00/day`,
      quantity: input.days,
      unitCents: input.messageBoards * RENTAL_RATES.messageBoard,
    });
  }

  // ---- Plan / stamp ----
  if (input.hasStamp) {
    lines.push({ description: "TMP Engineering Stamp", quantity: 1, unitCents: FIXED.stamp });
    reasons.push("Stamped plan attached → Engineering Stamp $550");
  } else if (input.hasPlan) {
    lines.push({ description: "Traffic Management Plan", quantity: 1, unitCents: FIXED.tmpStandard });
    reasons.push("Plan without stamp → TMP $400 (standard)");
  }

  // ---- Permits ----
  lines.push({ description: "Permit acquisition (ACQ)", quantity: 1, unitCents: FIXED.permitAcq });
  if (input.permitCostCents && input.permitCostCents > 0) {
    lines.push({
      description: "City permit (pass-through)",
      quantity: 1,
      unitCents: input.permitCostCents,
    });
    reasons.push(`City permit pass-through ${money(input.permitCostCents)}`);
  }

  // ---- Extra services ----
  if (input.parkingBan) {
    lines.push({ description: "Parking Ban (NP install)", quantity: 1, unitCents: FIXED.parkingBan });
    reasons.push("Parking Ban set in Airtable → $350");
  }
  if (input.stockpile) {
    const surcharge = input.signs > 50;
    const cents = surcharge ? Math.round(FIXED.stockpile * 1.5) : FIXED.stockpile;
    lines.push({
      description: `Stockpile signage${surcharge ? " (+50%, >50 signs)" : ""}`,
      quantity: 1,
      unitCents: cents,
    });
    reasons.push(`Stockpile → ${money(cents)}${surcharge ? " (>50 signs surcharge)" : ""}`);
  }

  return { industry, complexity, lines, reasons };
}
