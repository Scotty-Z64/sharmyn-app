// Homepage banner shape picker — idempotent, safe to re-run.
// Run: node scripts/migrate-hero-aspect.js
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

  const tryAlter = async (label, sqlText) => {
    try {
      await conn.query(sqlText);
      console.log(`✔ ${label}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Duplicate column/i.test(msg)) console.log(`• ${label} (already exists — skipped)`);
      else {
        console.error(`✘ ${label}: ${msg}`);
        throw e;
      }
    }
  };

  try {
    await tryAlter("site_settings.hero_aspect", "ALTER TABLE site_settings ADD COLUMN hero_aspect varchar(10) NULL");

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
