import "dotenv/config";
import mysql from "mysql2/promise";

const DDL = [
`CREATE TABLE IF NOT EXISTS invoices (
  id int AUTO_INCREMENT NOT NULL,
  invoiceNumber varchar(32) NOT NULL,
  airtableJobId varchar(32),
  clientName varchar(256) NOT NULL,
  jobAddress varchar(512),
  issueDate varchar(10) NOT NULL,
  dueDate varchar(10),
  status varchar(16) NOT NULL DEFAULT 'draft',
  subtotalCents int NOT NULL DEFAULT 0,
  gstRate double NOT NULL DEFAULT 5,
  gstCents int NOT NULL DEFAULT 0,
  totalCents int NOT NULL DEFAULT 0,
  notes text,
  createdAt timestamp NOT NULL DEFAULT (now()),
  updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT invoices_id PRIMARY KEY(id)
)`,
`CREATE TABLE IF NOT EXISTS invoice_items (
  id int AUTO_INCREMENT NOT NULL,
  invoiceId int NOT NULL,
  description varchar(512) NOT NULL,
  quantity double NOT NULL DEFAULT 1,
  unitCents int NOT NULL DEFAULT 0,
  amountCents int NOT NULL DEFAULT 0,
  sortOrder int NOT NULL DEFAULT 0,
  CONSTRAINT invoice_items_id PRIMARY KEY(id)
)`,
];

async function main() {
  const url = process.env.TARGET_URL || process.env.DATABASE_URL!;
  const u = new URL(url);
  const conn = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace("/", "").split("?")[0],
    ssl: u.hostname.includes("tidbcloud") ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
  });
  for (const sql of DDL) await conn.query(sql);
  const [t]: any = await conn.query("SHOW TABLES LIKE 'invoice%'");
  console.log(u.hostname, "->", t.map((r: any) => Object.values(r)[0]).join(", "));
  await conn.end();
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
