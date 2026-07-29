/**
 * Classify the attachments in Airtable's "Plan File" field by filename.
 * Real-world patterns (from FTS jobs):
 *   - "FTS-26-3351-...-1615 46 St NW_Stamped.pdf"  → the Traffic Management
 *     Plan (their plan naming always starts with the FTS code / says Stamped)
 *   - "SU-26-685626 - ... .PDF"                    → Street Use Permit
 *   - "NP-26-685630 - ... .PDF"                    → No Parking permit
 *   - "221757.pdf" (bare request number)           → permit application info
 *
 * Technicians must see the PLAN — never the application or misc paperwork.
 */
export type PlanDocKind = "plan" | "permit" | "other";

export function planDocKind(filename: string | null | undefined): PlanDocKind {
  const f = (filename ?? "").trim();
  // City permits: SU- (street use), NP- (no parking), or explicit wording.
  if (/^(su|np)[-_ ]/i.test(f) || /street\s*use|no\s*parking/i.test(f)) {
    return "permit";
  }
  // The plan: FTS-coded name, stamped drawing, or explicit TMP wording.
  if (/^fts[-_ ]?/i.test(f) || /stamped|traffic\s*management|tmp\b/i.test(f)) {
    return "plan";
  }
  // Bare request numbers / applications / receipts → reference paperwork.
  if (/^\d+(\s*\(\d+\))?\.pdf$/i.test(f) || /application|receipt|invoice/i.test(f)) {
    return "other";
  }
  // Unknown names: safer to treat as plan candidates than to hide them —
  // but only AFTER real plans; pickPlans() puts recognized plans first.
  return "plan";
}

export function pickPlans<T extends { filename?: string | null }>(files: T[]): T[] {
  const plans = files.filter((f) => planDocKind(f.filename) === "plan");
  // Recognized FTS/stamped plans first, unknown-name candidates after.
  return plans.sort((a, b) => {
    const ra = /^fts[-_ ]?|stamped/i.test(a.filename ?? "") ? 0 : 1;
    const rb = /^fts[-_ ]?|stamped/i.test(b.filename ?? "") ? 0 : 1;
    return ra - rb;
  });
}

export function pickPermits<T extends { filename?: string | null }>(files: T[]): T[] {
  return files.filter((f) => planDocKind(f.filename) === "permit");
}

export function pickOtherDocs<T extends { filename?: string | null }>(files: T[]): T[] {
  return files.filter((f) => planDocKind(f.filename) === "other");
}
