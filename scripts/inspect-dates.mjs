const key=process.env.AIRTABLE_API_KEY, base=process.env.AIRTABLE_BASE_ID, tbl=process.env.AIRTABLE_JOBS_TABLE_ID;
const r = await fetch(`https://api.airtable.com/v0/${base}/${tbl}?pageSize=20`,{headers:{Authorization:`Bearer ${key}`}});
const d = await r.json();
let n=0;
for (const rec of d.records||[]){
  const sd=rec.fields["Start Date"], ed=rec.fields["End Date"], dur=rec.fields["Setup Duration"];
  if((sd||ed) && n<12){ console.log(JSON.stringify({sd,ed,dur})); n++; }
}
