import "dotenv/config";

const key = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;
const tableId = process.env.AIRTABLE_JOBS_TABLE_ID;

if (!key || !baseId) {
  console.error("Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID");
  process.exit(1);
}

const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
  headers: { Authorization: `Bearer ${key}` },
});

console.log("HTTP", res.status);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
const table = data.tables.find((t) => t.id === tableId) || data.tables[0];
console.log("\n=== TABLE:", table.name, "(", table.id, ") ===\n");
for (const f of table.fields) {
  let opts = "";
  if (f.options?.choices) {
    opts = " -> [" + f.options.choices.map((c) => c.name).join(", ") + "]";
  }
  console.log(`- ${f.name} (${f.type})${opts}`);
}
console.log("\nAll tables:", data.tables.map((t) => `${t.name} (${t.id})`).join(", "));
