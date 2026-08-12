// Cross-check the Airtable "Signs Count" field against the sign schedule
// printed INSIDE the Traffic Management Plan PDF. The FTS plans embed the
// same legend table (e.g. "WM 19", "CONSTRUCTION AHEAD 4"), so each field
// line is searched in the plan text and its quantity compared.
import { pickPlans } from "../shared/planDocs";
import type { AttachmentLike } from "../shared/permitSchedule";

export interface SignCheckRow {
  label: string;
  fieldQty: number;
  planQty: number | null;
  verdict: "match" | "differs" | "not_found" | "drawn";
}

/** Row-joined text of every page of a PDF (positional, left→right per row). */
async function pdfRowText(buf: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as any[])
      .filter((i) => typeof i.str === "string" && i.str.trim())
      .map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    const rows = new Map<number, { s: string; x: number }[]>();
    for (const it of items) {
      const key = Math.round(it.y / 4) * 4;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push(it);
    }
    for (const its of Array.from(rows.values())) {
      out.push(
        its
          .sort((a: { x: number }, b: { x: number }) => a.x - b.x)
          .map((i) => i.s)
          .join(" "),
      );
    }
  }
  return out.join("\n");
}

/** Normalize a device label for fuzzy matching (strip codes and fillers). */
function normLabel(label: string): string {
  return label
    .toUpperCase()
    .replace(/^[A-Z]{1,4}\s*[-–]\s*/, "") // leading codes: "CA - ", "PDL - "
    .replace(/[().]/g, " ")
    .replace(/\bENDS?\b/, "END") // CONSTRUCTION END(S)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * For every "LABEL QTY" line of the Signs Count field, look for the same
 * label inside the plan text and compare the number that follows it.
 */
export async function verifySignsAgainstPlan(
  signsCount: string | null | undefined,
  planFile: AttachmentLike[] | null | undefined,
): Promise<{ planFilename: string | null; rows: SignCheckRow[] }> {
  const rows: SignCheckRow[] = [];
  const fieldLines: { label: string; qty: number }[] = [];
  for (const raw of (signsCount ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^(.*?)[\s:\t]+(\d{1,4})\s*$/);
    if (m && m[1].trim()) fieldLines.push({ label: m[1].trim(), qty: Number(m[2]) });
  }
  if (fieldLines.length === 0) return { planFilename: null, rows };

  const plan = (pickPlans((planFile ?? []) as { filename?: string | null }[]) as AttachmentLike[]).find(
    (p) => /\.pdf$/i.test(p.filename ?? ""),
  );
  if (!plan?.url) return { planFilename: null, rows };

  const buf = Buffer.from(await (await fetch(plan.url)).arrayBuffer());
  const textRaw = await pdfRowText(new Uint8Array(buf));
  const text = textRaw.toUpperCase().replace(/[().]/g, " ").replace(/[ \t]+/g, " ");

  for (const f of fieldLines) {
    const label = normLabel(f.label);
    if (label.length < 2) continue;
    // Cones are DRAWN as dots on the plan, not listed as text — can't count
    // them from the PDF (per Sofia). Mark them so the UI explains it.
    if (/\bCONE/i.test(label)) {
      rows.push({ label: f.label, fieldQty: f.qty, planQty: null, verdict: "drawn" });
      continue;
    }
    // Escape regex chars, allow flexible whitespace between words.
    const pattern = label
      .split(" ")
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const re = new RegExp(`${pattern}\\s+(\\d{1,4})(?!\\d)`, "g");
    const found: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && found.length < 8) found.push(Number(m[1]));
    if (found.length === 0) {
      rows.push({ label: f.label, fieldQty: f.qty, planQty: null, verdict: "not_found" });
    } else if (found.includes(f.qty)) {
      rows.push({ label: f.label, fieldQty: f.qty, planQty: f.qty, verdict: "match" });
    } else {
      rows.push({ label: f.label, fieldQty: f.qty, planQty: found[0], verdict: "differs" });
    }
  }
  return { planFilename: plan.filename ?? null, rows };
}
