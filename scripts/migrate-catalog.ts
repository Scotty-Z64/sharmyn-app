// Cost price (profit tracking) + selectable sizes — idempotent, safe to re-run.
// Run: npx tsx scripts/migrate-catalog.ts
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
    await tryAlter("products.cost_price", "ALTER TABLE products ADD COLUMN cost_price int NOT NULL DEFAULT 0");
    await tryAlter("products.sizes", "ALTER TABLE products ADD COLUMN sizes json NULL");

    console.log("\n-- products columns --");
    console.table(await conn.query("SHOW COLUMNS FROM products").then((r) => r[0]));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
