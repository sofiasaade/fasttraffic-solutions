// Copy plan-fallback extraction rows (filename LIKE 'plan:%') local -> cloud.
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const local = await mysql.createConnection(process.env.DATABASE_URL!);
  const cloudUrl = process.env.CLOUD_URL!;
  const u = new URL(cloudUrl);
  const cloud = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 4000),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace("/", "").split("?")[0],
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
  const [rows]: any = await local.query(
    "SELECT airtableJobId, filename, fileUrl, permitNumber, validFromDate, validFromTime, validFromDay, validToDate, validToTime, validToDay, numberOfDays, parseStatus, rawJson FROM permit_extractions WHERE filename LIKE 'plan:%'",
  );
  console.log("local plan rows:", rows.length);
  let n = 0;
  for (const r of rows) {
    await cloud.execute(
      `INSERT INTO permit_extractions (airtableJobId, filename, fileUrl, permitNumber, validFromDate, validFromTime, validFromDay, validToDate, validToTime, validToDay, numberOfDays, parseStatus, rawJson)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE fileUrl=VALUES(fileUrl), validFromDate=VALUES(validFromDate), validFromTime=VALUES(validFromTime), validFromDay=VALUES(validFromDay), validToDate=VALUES(validToDate), validToTime=VALUES(validToTime), validToDay=VALUES(validToDay), parseStatus=VALUES(parseStatus), rawJson=VALUES(rawJson)`,
      [r.airtableJobId, r.filename, r.fileUrl, r.permitNumber, r.validFromDate, r.validFromTime, r.validFromDay, r.validToDate, r.validToTime, r.validToDay, r.numberOfDays, r.parseStatus, r.rawJson],
    );
    n++;
  }
  console.log("copied to cloud:", n);
  const [c]: any = await cloud.query("SELECT COUNT(*) c FROM permit_extractions WHERE filename LIKE 'plan:%'");
  console.log("cloud plan rows now:", c[0].c);
  await local.end();
  await cloud.end();
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
