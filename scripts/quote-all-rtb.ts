// Auto-quote EVERY "Job Completed - Ready to Bill" project and dump JSON
// for the review PDF. Uses live Airtable + the DB given in DATABASE_URL.
import "dotenv/config";
import { fetchAccountingJobs, fetchJobById, fetchJobRawFields } from "../server/airtable";
import { buildQuote, parseEquipment } from "../shared/pricingRules";
import { listFlaggingHoursForJob } from "../server/opsDb";

async function main() {
  const all = await fetchAccountingJobs();
  const rtb = all.filter((j) => j.status === "Job Completed - Ready to Bill");
  console.error(`ready to bill: ${rtb.length}`);
  const results: any[] = [];
  for (const r of rtb) {
    try {
      const job = await fetchJobById(r.id);
      const raw = await fetchJobRawFields(r.id);
      const rawMap = new Map(raw.map((f) => [f.name.toLowerCase(), f.value]));
      const rawGet = (n: string) => rawMap.get(n.toLowerCase()) ?? null;
      const equipment = parseEquipment(job.signsCount ?? null);
      let days = Number(rawGet("Number of Days")) || 0;
      if (!days && job.startDate && job.endDate) {
        const s = new Date(job.startDate.slice(0, 10) + "T00:00:00");
        const e = new Date(job.endDate.slice(0, 10) + "T00:00:00");
        days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
      }
      if (!days) days = 1;
      const start = job.startDate ? new Date(job.startDate.slice(0, 10) + "T00:00:00") : null;
      const weekendStart = !!start && (start.getDay() === 0 || start.getDay() === 6);
      const files = (job.planFile ?? []) as { filename?: string | null }[];
      const hasStamp = files.some((f) => /stamp/i.test(f.filename ?? ""));
      const hasPlan = files.length > 0;
      const affirmative = (v: string | null) => !!v && !/^(no|none|n\/a|-)$/i.test(v.trim());
      const num = (v: string | null) => {
        const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
        return Number.isFinite(n) ? n : 0;
      };
      const pc = rawGet("Permit Cost");
      let permitCostCents: number | null = null;
      if (pc) {
        const amounts = pc.match(/\$\s*[\d,]+(?:\.\d{1,2})?/g);
        if (amounts?.length) {
          const total = amounts.reduce((n, a) => n + Number(a.replace(/[$,\s]/g, "")), 0);
          if (total > 0) permitCostCents = Math.round(total * 100);
        } else {
          const n = Number(pc.replace(/[$,\s]/g, ""));
          if (Number.isFinite(n) && n > 0) permitCostCents = Math.round(n * 100);
        }
      }
      const quote = buildQuote({
        company: job.company,
        equipment,
        signs: equipment.totalSigns,
        days,
        setupDuration: job.setupDuration,
        weekendStart,
        hasStamp,
        hasPlan,
        parkingBan: affirmative(rawGet("Parking Ban")),
        stockpile: affirmative(rawGet("Stockpile")),
        arrowBoards: Math.max(equipment.arrowBoards, num(rawGet("Arrow Boards"))),
        messageBoards: Math.max(equipment.messageBoards, num(rawGet("Message Boards"))),
        permitCostCents,
      });
      const flagging = await listFlaggingHoursForJob(r.id);
      for (const f of flagging) {
        const rate = (f as any).hourlyRateCents ?? 4000;
        const hours = (f as any).hours ?? 0;
        if (hours > 0)
          quote.lines.push({ description: `Flaggers — ${hours}h × $${(rate / 100).toFixed(2)}/h`, quantity: hours, unitCents: rate, section: "service" });
      }
      const subtotal = quote.lines.reduce((n, l) => n + Math.round(l.quantity * l.unitCents), 0);
      results.push({
        id: r.id, company: job.company, address: job.jobAddress,
        startDate: job.startDate, endDate: job.endDate, days,
        setupDuration: job.setupDuration, industry: quote.industry, complexity: quote.complexity,
        lines: quote.lines, reasons: quote.reasons,
        subtotalCents: subtotal, gstCents: Math.round(subtotal * 0.05), totalCents: Math.round(subtotal * 1.05),
      });
      console.error(`ok  ${job.company} — $${(subtotal * 1.05 / 100).toFixed(2)}`);
    } catch (e: any) {
      console.error(`ERR ${r.company}: ${e.message}`);
      results.push({ id: r.id, company: r.company, address: r.jobAddress, error: e.message });
    }
  }
  console.log(JSON.stringify(results));
  process.exit(0);
}
main();
