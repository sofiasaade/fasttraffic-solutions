import "dotenv/config";
import mysql from "mysql2/promise";
async function main() {
  const url = process.env.TARGET_URL || process.env.DATABASE_URL!;
  const u = new URL(url);
  const conn = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace("/", "").split("?")[0],
    ssl: u.hostname.includes("tidbcloud") ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
  });
  for (const col of ["startTime", "endTime"]) {
    const [c]: any = await conn.query(`SHOW COLUMNS FROM technician_availability LIKE '${col}'`);
    if (c.length === 0) await conn.query(`ALTER TABLE technician_availability ADD COLUMN ${col} varchar(5)`);
  }
  console.log(u.hostname, "-> hours columns ok");
  await conn.end();
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
