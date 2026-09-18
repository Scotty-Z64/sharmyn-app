// Adds products.images (JSON array of extra angle photos) — idempotent, safe to re-run.
// Run: npx tsx scripts/migrate-product-images.ts
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

  try {
    const [existing] = await conn.query(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'images'"
    );
    if ((existing as unknown[]).length > 0) {
      console.log("• products.images already exists (skipped)");
    } else {
      await conn.query("ALTER TABLE products ADD COLUMN images JSON NULL");
      console.log("✔ products.images added");
    }

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
