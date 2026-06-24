// Colors for each "Sub-Status Field Operations" option, mirroring the exact
// single-select colors configured in Airtable (read from the base schema).
//
// Airtable's color tokens (e.g. "blueBright", "orangeLight1") are mapped to
// approximate hex values from Airtable's own palette so the app matches what
// the coordinator sees in Airtable.

/** Airtable single-select color token -> hex (background) + readable text. */
const AIRTABLE_PALETTE: Record<string, { bg: string; text: string }> = {
  // Bright (saturated) — use white text
  blueBright: { bg: "#2d7ff9", text: "#ffffff" },
  greenBright: { bg: "#20c933", text: "#ffffff" },
  redBright: { bg: "#f82b60", text: "#ffffff" },
  yellowBright: { bg: "#fcb400", text: "#1d1f25" },
  cyanBright: { bg: "#18bfff", text: "#1d1f25" },
  tealBright: { bg: "#20d9d2", text: "#1d1f25" },
  orangeBright: { bg: "#ff6f2c", text: "#ffffff" },
  purpleBright: { bg: "#8b46ff", text: "#ffffff" },
  pinkBright: { bg: "#ff08c2", text: "#ffffff" },
  grayBright: { bg: "#666666", text: "#ffffff" },

  // Dark 1 — use white text
  blueDark1: { bg: "#2750ae", text: "#ffffff" },
  greenDark1: { bg: "#338a17", text: "#ffffff" },
  redDark1: { bg: "#ba1e45", text: "#ffffff" },
  yellowDark1: { bg: "#b87503", text: "#ffffff" },
  cyanDark1: { bg: "#0b76b7", text: "#ffffff" },
  tealDark1: { bg: "#06a09b", text: "#ffffff" },
  orangeDark1: { bg: "#d74d26", text: "#ffffff" },
  purpleDark1: { bg: "#6b1cb0", text: "#ffffff" },
  pinkDark1: { bg: "#b2158b", text: "#ffffff" },
  grayDark1: { bg: "#444444", text: "#ffffff" },

  // Light 1 — dark text
  blueLight1: { bg: "#9cc7ff", text: "#1d1f25" },
  greenLight1: { bg: "#93e088", text: "#1d1f25" },
  redLight1: { bg: "#ffa0b9", text: "#1d1f25" },
  yellowLight1: { bg: "#ffd66e", text: "#1d1f25" },
  cyanLight1: { bg: "#77d1f3", text: "#1d1f25" },
  tealLight1: { bg: "#72ddc3", text: "#1d1f25" },
  orangeLight1: { bg: "#ffa981", text: "#1d1f25" },
  purpleLight1: { bg: "#cdb0ff", text: "#1d1f25" },
  pinkLight1: { bg: "#f99de2", text: "#1d1f25" },
  grayLight1: { bg: "#cccccc", text: "#1d1f25" },

  // Light 2 — dark text (palest)
  blueLight2: { bg: "#cfdfff", text: "#1d1f25" },
  greenLight2: { bg: "#d1f7c4", text: "#1d1f25" },
  redLight2: { bg: "#ffdce5", text: "#1d1f25" },
  yellowLight2: { bg: "#ffeab6", text: "#1d1f25" },
  cyanLight2: { bg: "#d0f0fd", text: "#1d1f25" },
  tealLight2: { bg: "#c2f5e9", text: "#1d1f25" },
  orangeLight2: { bg: "#fee2d5", text: "#1d1f25" },
  purpleLight2: { bg: "#ede2fe", text: "#1d1f25" },
  pinkLight2: { bg: "#ffdaf6", text: "#1d1f25" },
  grayLight2: { bg: "#eeeeee", text: "#1d1f25" },
};

/**
 * Exact color token per Sub-Status option, as configured in Airtable.
 * Keys are normalized (trimmed) for matching; see normalizeSubStatus.
 */
const SUB_STATUS_TOKEN: Record<string, string> = {
  "TMP Creation": "orangeLight1",
  "Permit Request Submitted(Field)": "blueLight2",
  "Permit Request (Set-Up Prepare)": "blueLight1",
  "Permit Approved(Field)": "blueBright",
  "Only Parking Signs Prepared (Field)": "tealLight1",
  "Setup Prepared - Signs Missing (Field)": "purpleLight2",
  "Setup Prepared (Field)": "greenLight2",
  "Daily Setup (Field)": "greenBright",
  "24 Hours Setup (Field)": "yellowBright",
  "Setup - Cancelled (Field)": "purpleLight1",
  "Setup - Postponed (Field)": "cyanLight2",
  "Setup - On Hold (Field)": "tealLight2",
  "Picked up": "redBright",
  "Cancelled (Field)": "yellowDark1",
  "Declined (Field)": "redLight1",
};

const NEUTRAL = { bg: "#e5e7eb", text: "#1d1f25" };

export function normalizeSubStatus(s?: string | null): string {
  return (s ?? "").trim();
}

export type SubStatusColor = { bg: string; text: string; token: string | null };

/** Returns the Airtable-matched color for a given Sub-Status value. */
export function subStatusColor(subStatus?: string | null): SubStatusColor {
  const key = normalizeSubStatus(subStatus);
  const token = SUB_STATUS_TOKEN[key] ?? null;
  if (!token) return { ...NEUTRAL, token: null };
  const pal = AIRTABLE_PALETTE[token] ?? NEUTRAL;
  return { bg: pal.bg, text: pal.text, token };
}

/** Ordered legend of all sub-statuses with their colors. */
export function subStatusLegend(): { label: string; color: SubStatusColor }[] {
  return Object.keys(SUB_STATUS_TOKEN).map((label) => ({
    label,
    color: subStatusColor(label),
  }));
}
