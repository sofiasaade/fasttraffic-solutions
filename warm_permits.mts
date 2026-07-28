import "dotenv/config";
import { getPermitSchedulesForJobs } from "./server/permitExtraction";
import { fetchMapJobs } from "./server/airtable";

const jobs = (await fetchMapJobs()) as any[];
const withSU = jobs
  .map((j) => ({ id: j.id, planFile: j.planFile ?? [], company: j.company }))
  .filter((j) => (j.planFile as any[]).some((f) => /^su[-_ ]/i.test(f.filename ?? "")));
console.log("trabajos con permiso SU-:", withSU.length);
let done = 0;
for (const j of withSU) {
  try {
    const map = await getPermitSchedulesForJobs([j]);
    const s = map.get(j.id);
    console.log(`[${++done}/${withSU.length}] ${j.company}: ${s?.validFromTime ?? "—"} → ${s?.validToTime ?? "—"} (${s?.validFromDate ?? "?"})`);
  } catch (e: any) {
    console.log(`[${++done}/${withSU.length}] ${j.company}: ERR ${e.message.slice(0, 60)}`);
  }
}
console.log("caché caliente ✅");
