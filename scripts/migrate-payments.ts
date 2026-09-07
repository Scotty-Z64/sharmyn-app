// One-off migration: add payment_status + payment_ref to orders.
// Run: npx tsx scripts/migrate-payments.ts
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
  try {
    try {
      await conn.query(
        "ALTER TABLE orders ADD COLUMN payment_status varchar(20) NOT NULL DEFAULT 'unpaid', ADD COLUMN payment_ref varchar(64) NULL"
      );
      console.log("Columns added.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Duplicate column/i.test(msg)) console.log("Columns already exist — skipping.");
      else throw e;
    }
    const [cols] = await conn.query("SHOW COLUMNS FROM orders LIKE 'payment_%'");
    console.log(cols);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
