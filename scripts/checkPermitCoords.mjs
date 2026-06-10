import "dotenv/config";

const KEY = process.env.AIRTABLE_API_KEY;
const BASE = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_JOBS_TABLE_ID;

const url = `https://api.airtable.com/v0/${BASE}/${TABLE}?filterByFormula=${encodeURIComponent(
  "{Status}='Permit Approved'",
)}&pageSize=100`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${KEY}` },
});
const data = await res.json();
const recs = data.records ?? [];
console.log("Permit Approved count:", recs.length);
for (const r of recs.slice(0, 15)) {
  const f = r.fields;
  console.log(
    JSON.stringify({
      id: r.id,
      company: f["Company"] ?? null,
      address: f["Job Address"] ?? null,
      municipality: f["Municipality"] ?? f["City"] ?? null,
      lat: f["Lat"] ?? null,
      lon: f["Lon"] ?? null,
    }),
  );
}
// Also list all field names that contain lat/lon/coord/geo
const allKeys = new Set();
for (const r of recs) Object.keys(r.fields).forEach((k) => allKeys.add(k));
const geoKeys = [...allKeys].filter((k) =>
  /lat|lon|long|coord|geo|gps|location|address/i.test(k),
);
console.log("Geo-ish fields present:", geoKeys);
