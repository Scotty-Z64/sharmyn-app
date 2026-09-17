// Storefront settings (editable homepage hero banner) — idempotent, safe to re-run.
// Creates a `site_settings` singleton table (id=1) that holds an owner-uploaded
// hero image/caption; the storefront falls back to the bundled /hero-main.png
// and default caption when no row (or null fields) exist yet.
// Run: npx tsx scripts/migrate-site-settings.ts
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

  try {
    const [tables] = await conn.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_settings'"
    );
    if ((tables as unknown[]).length === 0) {
      await conn.query(`
        CREATE TABLE site_settings (
          id INT PRIMARY KEY,
          hero_image MEDIUMTEXT NULL,
          hero_caption VARCHAR(80) NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("✔ created site_settings table");
    } else {
      console.log("• site_settings table (already exists — skipped)");
    }

    console.log("\n-- site_settings columns --");
    console.table(await conn.query("SHOW COLUMNS FROM site_settings").then((r) => r[0]));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
