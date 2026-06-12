import { seedTechnicians, listTechnicians } from "../server/opsDb.ts";

await seedTechnicians();
const rows = await listTechnicians();
console.log(`Seeded. Technicians in DB: ${rows.length}`);
for (const r of rows) console.log(`- ${r.displayName}`);
process.exit(0);
