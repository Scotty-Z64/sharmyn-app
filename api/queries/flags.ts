// Owner-controlled on/off switches. The table is created on first use, so nothing needs
// migrating by hand. Reads are cached for a few seconds because every storefront page asks.
import { eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { appFlags } from "@db/schema";

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    await getDb().execute(sql`CREATE TABLE IF NOT EXISTS app_flags (
      flag_key VARCHAR(40) NOT NULL PRIMARY KEY,
      flag_value VARCHAR(100) NOT NULL
    )`);
  })().catch((e) => {
    tableReady = null;
    throw e;
  });
  return tableReady;
}

const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; value: string | null }>();

async function getFlag(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  await ensureTable();
  const [row] = await getDb().select().from(appFlags).where(eq(appFlags.key, key));
  const value = row?.value ?? null;
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function setFlag(key: string, value: string): Promise<void> {
  await ensureTable();
  await getDb().insert(appFlags).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
  cache.set(key, { at: Date.now(), value });
}

/** The Opening Special is ON unless the owner has switched it off. If the switch cannot be read, it stays on. */
export async function openingSpecialEnabled(): Promise<boolean> {
  try {
    return (await getFlag("opening_special")) !== "off";
  } catch (e) {
    console.error("[flags] could not read the opening special switch:", e);
    return true;
  }
}

export async function setOpeningSpecialEnabled(enabled: boolean): Promise<void> {
  await setFlag("opening_special", enabled ? "on" : "off");
}

/** The last call Meta made to the WhatsApp webhook (time and what happened), so a silent webhook can be diagnosed. */
export async function recordWebhookEvent(summary: string): Promise<void> {
  try {
    await setFlag("wa_last_webhook", `${new Date().toISOString().slice(0, 19)}Z ${summary}`.slice(0, 100));
  } catch (e) {
    console.error("[flags] could not record the webhook event:", e);
  }
}

export async function lastWebhookEvent(): Promise<string | null> {
  try {
    return await getFlag("wa_last_webhook");
  } catch {
    return null;
  }
}
