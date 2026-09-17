// Shoe categories + brand + per-size stock — idempotent, safe to re-run.
// - Widens products.category from a fixed enum to varchar (so adding a
//   category never needs another column rebuild) and adds "shoes".
// - Adds products.brand.
// - Converts any existing `sizes` data from the old shape (string[], just a
//   list of available sizes) to the new shape (Record<string, number>, per-size
//   stock) — old rows had no known per-size counts, so they're set to 0 and the
//   owner needs to fill in real numbers via Products > Edit for those items.
// Run: npx tsx scripts/migrate-shoe-categories.ts
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
    await tryAlter(
      "products.category enum → varchar",
      "ALTER TABLE products MODIFY COLUMN category varchar(20) NOT NULL"
    );
    await tryAlter("products.brand", "ALTER TABLE products ADD COLUMN brand varchar(30) NULL");

    // Convert old array-shaped sizes (["3","4","5"]) to the new per-size-stock
    // shape ({"3":0,"4":0,"5":0}) — only rows where `sizes` is still a JSON
    // array; already-migrated rows (JSON object) are left untouched.
    const [rows] = await conn.query(
      "SELECT id, sizes FROM products WHERE sizes IS NOT NULL AND JSON_TYPE(sizes) = 'ARRAY'"
    );
    const arr = rows as { id: string; sizes: string }[];
    if (arr.length) {
      for (const row of arr) {
        const sizeList = JSON.parse(row.sizes) as string[];
        const obj = Object.fromEntries(sizeList.map((s) => [s, 0]));
        await conn.query("UPDATE products SET sizes = ? WHERE id = ?", [JSON.stringify(obj), row.id]);
      }
      console.log(`✔ converted ${arr.length} product(s) from old sizes list to per-size stock (set to 0 — needs owner input)`);
    } else {
      console.log("• sizes shape conversion (nothing to convert — skipped)");
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
