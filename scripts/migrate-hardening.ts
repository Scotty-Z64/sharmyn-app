// Hardening migration — idempotent, safe to re-run. NEVER uses db:push --force.
// Run: npx tsx scripts/migrate-hardening.ts
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
    // 1. refund_status on orders
    await tryAlter(
      "orders.refund_status",
      "ALTER TABLE orders ADD COLUMN refund_status varchar(20) NOT NULL DEFAULT 'none'"
    );

    // 2. orders.status must accept 'cancelled' — inspect information_schema first.
    const [statusCol] = await conn.query(
      "SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'status'"
    );
    const col = (statusCol as { DATA_TYPE: string; COLUMN_TYPE: string }[])[0];
    if (col && col.DATA_TYPE === "enum" && !col.COLUMN_TYPE.includes("cancelled")) {
      await tryAlter(
        "orders.status enum → varchar",
        "ALTER TABLE orders MODIFY COLUMN status varchar(20) NOT NULL DEFAULT 'pending'"
      );
    } else {
      console.log("• orders.status already accepts 'cancelled' (skipped)");
    }

    // 3. products.image → MEDIUMTEXT (supports inline data-URI / long URLs)
    const [imgCol] = await conn.query(
      "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'image'"
    );
    const img = (imgCol as { DATA_TYPE: string }[])[0];
    if (img && img.DATA_TYPE !== "mediumtext") {
      await tryAlter("products.image → MEDIUMTEXT", "ALTER TABLE products MODIFY COLUMN image MEDIUMTEXT NULL");
    } else {
      console.log("• products.image already MEDIUMTEXT (skipped)");
    }

    // 4. notifications table
    await conn.query(`CREATE TABLE IF NOT EXISTS notifications (
      id varchar(40) PRIMARY KEY,
      type varchar(32) NOT NULL,
      message text NOT NULL,
      order_id varchar(16) NULL,
      is_read tinyint(1) NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log("✔ notifications table");

    // Verify
    console.log("\n-- orders columns --");
    console.table(await conn.query("SHOW COLUMNS FROM orders").then((r) => r[0]));
    console.log("-- notifications columns --");
    console.table(await conn.query("SHOW COLUMNS FROM notifications").then((r) => r[0]));
    const [pimg] = await conn.query(
      "SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'image'"
    );
    console.log("products.image:", pimg);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
