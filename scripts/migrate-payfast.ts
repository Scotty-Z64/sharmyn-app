// Payfast integration — adds orders.payment_gateway. Idempotent, safe to re-run.
// Run: npx tsx scripts/migrate-payfast.ts
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

  const tryAlter = async (label: string, sqlText: string) => {
    try {
      await conn.query(sqlText);
      console.log(`✔ ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Duplicate column/i.test(msg)) console.log(`• ${label} (already exists — skipped)`);
      else {
        console.error(`✘ ${label}: ${msg}`);
        throw e;
      }
    }
  };

  try {
    await tryAlter("orders.payment_gateway", "ALTER TABLE orders ADD COLUMN payment_gateway varchar(10) NULL");

    // Backfill: every existing paid order with a paymentRef was paid through
    // Yoco (Payfast didn't exist yet) — safe, one-time, idempotent (only
    // touches rows still NULL).
    const [res] = await conn.query(
      "UPDATE orders SET payment_gateway = 'yoco' WHERE payment_gateway IS NULL AND payment_status = 'paid' AND payment_ref IS NOT NULL"
    );
    console.log(`✔ backfilled payment_gateway='yoco' for existing paid orders (${(res as { affectedRows: number }).affectedRows} row(s))`);

    console.log("\n-- orders columns --");
    console.table(await conn.query("SHOW COLUMNS FROM orders").then((r) => r[0]));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
