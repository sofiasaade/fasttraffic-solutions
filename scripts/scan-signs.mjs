const key=process.env.AIRTABLE_API_KEY, base=process.env.AIRTABLE_BASE_ID, tbl=process.env.AIRTABLE_JOBS_TABLE_ID;
let offset, all=[];
do{
  const u=new URL(`https://api.airtable.com/v0/${base}/${tbl}`);
  u.searchParams.set("pageSize","100");
  u.searchParams.set("fields[]","Signs Count");
  if(offset)u.searchParams.set("offset",offset);
  const r=await fetch(u,{headers:{Authorization:`Bearer ${key}`}});
  const d=await r.json();
  if(d.error){console.log("ERR",JSON.stringify(d.error));break;}
  for(const rec of d.records||[]){const v=rec.fields["Signs Count"];if(typeof v==="string")all.push(v);}
  offset=d.offset;
}while(offset && all.length<2000);
console.log("records with Signs Count:", all.length);
const labelCount={};
for(const block of all){
  for(let line of block.split("\n")){
    line=line.trim(); if(!line) continue;
    // strip trailing count
    const m=line.match(/^(.*?)[\s\t]+(\d+)\s*$/);
    const label=(m?m[1]:line).trim().toUpperCase();
    if(!label) continue;
    labelCount[label]=(labelCount[label]||0)+1;
  }
}
const interesting=Object.entries(labelCount)
  .filter(([k])=>/ARROW|MESSAGE|VMB|BOARD|SIGN|CONE|BARRICADE|WM|FLASH/.test(k))
  .sort((a,b)=>b[1]-a[1]);
console.log("\n== labels mentioning arrow/message/board/sign/etc ==");
for(const [k,c] of interesting) console.log(c.toString().padStart(4), k);
