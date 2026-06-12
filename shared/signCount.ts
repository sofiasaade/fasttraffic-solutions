// Parse the free-text Airtable "Signs Count" field into device tallies.
//
// The field is unstructured text where each line is roughly
// "<LABEL><sep><QUANTITY>" — the separator can be a tab, spaces, ":", "=",
// "-", or "x". The quantity may also appear BEFORE the label (e.g. "3 X NO
// PARKING SIGNS", "2 MESSAGE BOARDS"). Blocks may contain phase headers
// ("PHASE 1", "PHASE 2 - FTS-1996-A") which we ignore for totals.
//
// We only count three categories for the dashboard widget:
//   - customSigns:   ONLY lines that explicitly say "Custom Sign" (Option A).
//   - arrowBoards:    lines for arrow boards (ARROW BOARD / AB - ARROW BOARD /
//                     ABL - ARROW BOARD LEFT / DAB - DOUBLE ARROW BOARD).
//   - messageBoards:  lines for variable message boards (MESSAGE BOARD / VMB /
//                     VMS / VARIABLE MESSAGE BOARD).
//
// Everything else (regular coded signs, cones, barricades, WM, flashers, …)
// is intentionally NOT counted here.

export interface SignTally {
  customSigns: number;
  arrowBoards: number;
  messageBoards: number;
}

export const EMPTY_SIGN_TALLY: SignTally = {
  customSigns: 0,
  arrowBoards: 0,
  messageBoards: 0,
};

type Category = keyof SignTally;

/** Pull a single quantity out of a line; falls back to 1 when a matching
 *  label has no explicit number (people sometimes omit it). */
function extractQuantity(line: string): number {
  // Prefer a trailing number: "... 4", "...:4", "...= 4", "... - 4", "...\t4"
  const trailing = line.match(/[\s:\-=xX]\s*(\d{1,4})\s*$/);
  if (trailing) return parseInt(trailing[1], 10);
  // Otherwise a leading number: "3 X NO PARKING", "2 MESSAGE BOARDS"
  const leading = line.match(/^\s*(\d{1,4})\s*[xX]?\b/);
  if (leading) return parseInt(leading[1], 10);
  // No number present — count it as a single occurrence.
  return 1;
}

/** Classify a single normalized (UPPERCASE) line into a category, or null. */
function classifyLine(upper: string): Category | null {
  // Ignore obvious phase headers / empty separators.
  if (/^PHASE\s*\d/.test(upper)) return null;

  // Message boards FIRST (so "VMB-MESSAGE BOARD" doesn't fall into arrow logic).
  if (
    /\bMESSAGE\s*BOARD/.test(upper) ||
    /\bVMB\b/.test(upper) ||
    /\bVMS\b/.test(upper) ||
    /VARIABLE\s+MESSAGE/.test(upper)
  ) {
    return "messageBoards";
  }

  // Arrow boards: an actual "ARROW BOARD" device (not "ARROW LEFT" on a sign
  // or barricade). Accept AB / ABL / ABR / DAB codes and "DOUBLE ARROW".
  if (
    /ARROW\s*BOARD/.test(upper) ||
    /\bAB\b\s*-?\s*ARROW/.test(upper) ||
    /\bABL\b/.test(upper) ||
    /\bABR\b/.test(upper) ||
    /\bDAB\b/.test(upper) ||
    /DOUBLE\s+ARROW/.test(upper)
  ) {
    return "arrowBoards";
  }

  // Custom signs — Option A: ONLY explicit "CUSTOM SIGN".
  if (/CUSTOM\s+SIGN/.test(upper)) {
    return "customSigns";
  }

  return null;
}

/** Parse one "Signs Count" text block into a SignTally. */
export function parseSignCount(text: string | null | undefined): SignTally {
  const tally: SignTally = { ...EMPTY_SIGN_TALLY };
  if (!text || typeof text !== "string") return tally;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    const cat = classifyLine(upper);
    if (!cat) continue;
    const qty = extractQuantity(line);
    tally[cat] += Number.isFinite(qty) && qty > 0 ? qty : 0;
  }

  return tally;
}

/** Sum many SignTally objects (e.g. across all Starting-today jobs). */
export function sumSignTallies(tallies: SignTally[]): SignTally {
  return tallies.reduce<SignTally>(
    (acc, t) => ({
      customSigns: acc.customSigns + t.customSigns,
      arrowBoards: acc.arrowBoards + t.arrowBoards,
      messageBoards: acc.messageBoards + t.messageBoards,
    }),
    { ...EMPTY_SIGN_TALLY },
  );
}
