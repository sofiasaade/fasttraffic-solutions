import { getDb } from "../server/db.ts";
import { technicians, jobAssignments, schedulerAssignments } from "../drizzle/schema.ts";
import { TECHNICIANS } from "../shared/airtableFields.ts";
import { eq, inArray } from "drizzle-orm";

const d = await getDb();
if (!d) {
  console.error("DB not available");
  process.exit(1);
}

const official = new Set(TECHNICIANS.map((n) => n.trim()));
const all = await d.select().from(technicians);

const stale = all.filter((t) => !official.has((t.displayName ?? "").trim()) && !official.has((t.airtableName ?? "").trim()));
console.log(`Total in DB: ${all.length}; official: ${official.size}; stale candidates: ${stale.length}`);

const removed = [];
const kept = [];
for (const t of stale) {
  // Safety: never delete if linked to a user account.
  if (t.userId) {
    kept.push(`${t.displayName} (linked userId=${t.userId})`);
    continue;
  }
  // Safety: never delete if referenced by any assignment (by airtableName or displayName).
  const names = [t.airtableName, t.displayName].filter(Boolean);
  const ja = await d.select({ id: jobAssignments.id }).from(jobAssignments).where(inArray(jobAssignments.technicianName, names)).limit(1);
  const sa = await d.select({ id: schedulerAssignments.id }).from(schedulerAssignments).where(inArray(schedulerAssignments.technicianName, names)).limit(1);
  if (ja.length || sa.length) {
    kept.push(`${t.displayName} (has assignments)`);
    continue;
  }
  await d.delete(technicians).where(eq(technicians.id, t.id));
  removed.push(t.displayName);
}

console.log(`Removed (${removed.length}): ${removed.join(", ") || "none"}`);
console.log(`Kept stale (${kept.length}): ${kept.join(", ") || "none"}`);

const after = await d.select().from(technicians);
console.log(`Technicians in DB now: ${after.length}`);
for (const r of after) console.log(`- ${r.displayName}`);
process.exit(0);
