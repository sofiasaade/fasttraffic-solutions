const key=process.env.AIRTABLE_API_KEY, base=process.env.AIRTABLE_BASE_ID, tbl=process.env.AIRTABLE_JOBS_TABLE_ID;
if(!key){console.log("NO_KEY");process.exit(0);}
const r = await fetch(`https://api.airtable.com/v0/${base}/${tbl}?pageSize=10`,{headers:{Authorization:`Bearer ${key}`}});
const d = await r.json();
if (d.error){console.log("ERR",JSON.stringify(d.error));process.exit(0);}
const fields=new Set();
(d.records||[]).forEach(rec=>Object.keys(rec.fields).forEach(f=>fields.add(f)));
console.log(JSON.stringify([...fields].sort(),null,1));
