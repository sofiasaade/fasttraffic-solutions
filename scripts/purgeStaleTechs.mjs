import { getDb } from "../server/db.ts";
import {
  technicians,
  jobAssignments,
  schedulerAssignments,
} from "../drizzle/schema.ts";
import { TECHNICIANS } from "../shared/airtableFields.ts";
import { eq, inArray } from "drizzle-orm";

const d = await getDb();
if (!d) {
  console.error("DB not available");
  process.exit(1);
}

const official = new Set(TECHNICIANS.map((n) => n.trim()));
const all = await d.select().from(technicians);
const stale = all.filter(
  (t) =>
    !official.has((t.displayName ?? "").trim()) &&
    !official.has((t.airtableName ?? "").trim()),
);

if (stale.length === 0) {
  console.log("No stale technicians. DB already matches official roster.");
} else {
  const names = stale.flatMap((t) => [t.airtableName, t.displayName].filter(Boolean));
  // Delete their (test) assignments first to satisfy data integrity.
  const ja = await d
    .delete(jobAssignments)
    .where(inArray(jobAssignments.technicianName, names));
  const sa = await d
    .delete(schedulerAssignments)
    .where(inArray(schedulerAssignments.technicianName, names));
  console.log(
    `Deleted assignments for stale techs (job_assignments + scheduler_assignments).`,
  );
  for (const t of stale) {
    await d.delete(technicians).where(eq(technicians.id, t.id));
    console.log(`Removed technician: ${t.displayName}`);
  }
}

const after = await d.select().from(technicians);
console.log(`\nTechnicians in DB now: ${after.length}`);
for (const r of after) console.log(`- ${r.displayName}`);
process.exit(0);
