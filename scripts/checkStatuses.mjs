import "dotenv/config";

const KEY = process.env.AIRTABLE_API_KEY;
const BASE = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_JOBS_TABLE_ID;

const records = [];
let offset;
do {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("fields[]", "Status");
  if (offset) params.set("offset", offset);
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?${params}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const data = await res.json();
  records.push(...(data.records ?? []));
  offset = data.offset;
} while (offset);

const counts = {};
for (const r of records) {
  const s = r.fields?.Status ?? "(empty)";
  counts[s] = (counts[s] ?? 0) + 1;
}
console.log("Total records:", records.length);
console.log("Distinct Status values + counts:");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${JSON.stringify(k)}: ${v}`);
}
