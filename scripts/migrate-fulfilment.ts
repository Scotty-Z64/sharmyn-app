// Fulfilment pipeline + product ref numbers — idempotent, safe to re-run.
// Run: npx tsx scripts/migrate-fulfilment.ts
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
    await tryAlter("products.ref_number", "ALTER TABLE products ADD COLUMN ref_number int NOT NULL DEFAULT 0");
    await tryAlter("orders.tracking_set_at", "ALTER TABLE orders ADD COLUMN tracking_set_at timestamp NULL");
    await tryAlter("orders.supplier_ordered_at", "ALTER TABLE orders ADD COLUMN supplier_ordered_at timestamp NULL");
    await tryAlter("orders.stock_received_at", "ALTER TABLE orders ADD COLUMN stock_received_at timestamp NULL");
    await tryAlter("orders.invoice_sent_at", "ALTER TABLE orders ADD COLUMN invoice_sent_at timestamp NULL");

    // Backfill ref_number for existing products that are still 0 (first run only —
    // re-running is a no-op since the WHERE clause only matches unassigned rows).
    const [unassigned] = await conn.query(
      "SELECT id FROM products WHERE ref_number = 0 ORDER BY created_at ASC"
    );
    const rows = unassigned as { id: string }[];
    if (rows.length) {
      const [maxRow] = await conn.query("SELECT COALESCE(MAX(ref_number), 0) AS m FROM products");
      let next = ((maxRow as { m: number }[])[0]?.m ?? 0) + 1;
      for (const row of rows) {
        await conn.query("UPDATE products SET ref_number = ? WHERE id = ?", [next, row.id]);
        next++;
      }
      console.log(`✔ backfilled ref_number for ${rows.length} product(s)`);
    } else {
      console.log("• ref_number backfill (nothing to do — skipped)");
    }

    await conn.query(`CREATE TABLE IF NOT EXISTS exchanges (
      id varchar(40) PRIMARY KEY,
      order_id varchar(16) NOT NULL,
      qty int NOT NULL DEFAULT 1,
      original_product_id varchar(32) NOT NULL,
      original_name varchar(255) NOT NULL,
      original_ref_number int NOT NULL,
      new_product_id varchar(32) NOT NULL,
      new_name varchar(255) NOT NULL,
      new_ref_number int NOT NULL,
      note text NOT NULL,
      slip_sent_at timestamp NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log("✔ exchanges table");

    // Backfill tracking_set_at for any order that already has a tracking number
    // but no timestamp for it (best-effort: use the order's createdAt, since we
    // don't know exactly when it was actually set).
    await conn.query(
      "UPDATE orders SET tracking_set_at = created_at WHERE tracking_number IS NOT NULL AND tracking_set_at IS NULL"
    );
    console.log("✔ backfilled tracking_set_at for existing tracked orders");

    console.log("\n-- products columns --");
    console.table(await conn.query("SHOW COLUMNS FROM products").then((r) => r[0]));
    console.log("-- orders columns --");
    console.table(await conn.query("SHOW COLUMNS FROM orders").then((r) => r[0]));
    console.log("-- exchanges columns --");
    console.table(await conn.query("SHOW COLUMNS FROM exchanges").then((r) => r[0]));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
