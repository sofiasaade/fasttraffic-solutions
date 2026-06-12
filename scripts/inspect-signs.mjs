const key=process.env.AIRTABLE_API_KEY, base=process.env.AIRTABLE_BASE_ID, tbl=process.env.AIRTABLE_JOBS_TABLE_ID;
const r = await fetch(`https://api.airtable.com/v0/${base}/${tbl}?pageSize=50`,{headers:{Authorization:`Bearer ${key}`}});
const d = await r.json();
let shown=0;
for (const rec of d.records||[]){
  const v = rec.fields["Signs Count"];
  if (v!==undefined && shown<8){
    console.log("ID:", rec.fields["ID"] ?? rec.id, "| type:", typeof v, Array.isArray(v)?"(array)":"");
    console.log(JSON.stringify(v));
    console.log("----");
    shown++;
  }
}
if(!shown) console.log("No 'Signs Count' values found in first page");
