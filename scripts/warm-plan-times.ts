// One-off: warm the plan-fallback (TMP "SETUP INFORMATION") schedule cache for
// every job, and report which jobs gained a start time from their plan.
import "dotenv/config";
import { fetchMapJobs } from "../server/airtable";
import { getPermitSchedulesForJobs } from "../server/permitExtraction";
import { selectStreetUsePermits } from "../shared/permitSchedule";

async function main() {
  const jobs = await fetchMapJobs();
  console.log(`jobs: ${jobs.length}`);
  const map = await getPermitSchedulesForJobs(
    jobs.map((j) => ({ id: j.id, planFile: (j as any).planFile ?? [] })),
  );
  let withTime = 0;
  let planOnly = 0;
  for (const j of jobs) {
    const s = map.get(j.id);
    if (s?.validFromTime) withTime++;
    const hasPermit = selectStreetUsePermits((j as any).planFile).length > 0;
    if (s?.validFromTime && !hasPermit) {
      planOnly++;
      console.log(
        `PLAN-ONLY  ${j.company ?? "?"} · ${j.jobAddress ?? "?"} -> ${s.validFromTime} (${s.validFromDate ?? "no date"})`,
      );
    }
  }
  console.log(`with start time: ${withTime}/${jobs.length}; from plan only: ${planOnly}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
