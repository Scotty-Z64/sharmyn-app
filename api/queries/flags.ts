// Owner-controlled on/off switches. The table is created on first use, so nothing needs
// migrating by hand. Reads are cached for a few seconds because every storefront page asks.
import { eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { appFlags } from "@db/schema";
import { COLLECTION_POINTS, type CollectionKey } from "@contracts/types";

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    await getDb().execute(sql`CREATE TABLE IF NOT EXISTS app_flags (
      flag_key VARCHAR(40) NOT NULL PRIMARY KEY,
      flag_value VARCHAR(100) NOT NULL
    )`);
    // The collection address and hours need more room than an on/off switch does.
    await getDb().execute(sql`ALTER TABLE app_flags MODIFY flag_value VARCHAR(500) NOT NULL`).catch((e) => {
      console.error("[flags] could not widen app_flags.flag_value:", e);
    });
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

/** The password hash the owner set in the portal, read fresh from the database (null = none set). */
export async function readAdminPasswordHash(): Promise<string | null> {
  await ensureTable();
  const [row] = await getDb().select().from(appFlags).where(eq(appFlags.key, "admin_pw_hash"));
  return row?.value ?? null;
}

export async function saveAdminPasswordHash(hash: string): Promise<void> {
  await setFlag("admin_pw_hash", hash);
}

/** One place customers can collect from: its town and the address and hours the owner typed. */
export interface CollectionPoint {
  key: CollectionKey;
  town: string;
  info: string;
}

/**
 * Collection ("collect from us") for the two towns we do not courier to. A place only counts when the owner has
 * typed its address, and collection is only on when the owner has switched it on AND at least one place has an
 * address. If the setting cannot be read, collection is off.
 */
export async function collectionSettings(): Promise<{ enabled: boolean; points: CollectionPoint[] }> {
  try {
    const points: CollectionPoint[] = [];
    for (const p of COLLECTION_POINTS) {
      const info = ((await getFlag(`collect_${p.key}`)) ?? "").trim();
      if (info) points.push({ key: p.key, town: p.town, info });
    }
    return { enabled: (await getFlag("collect_on")) === "on" && points.length > 0, points };
  } catch (e) {
    console.error("[flags] could not read the collection setting:", e);
    return { enabled: false, points: [] };
  }
}

/** What the portal shows and edits: the switch and each place's text, even while one of them is missing. */
export async function collectionSettingsForOwner(): Promise<{ on: boolean; krugersdorp: string; hartbeespoort: string }> {
  return {
    on: (await getFlag("collect_on")) === "on",
    krugersdorp: ((await getFlag("collect_krugersdorp")) ?? "").trim(),
    hartbeespoort: ((await getFlag("collect_hartbeespoort")) ?? "").trim(),
  };
}

export async function saveCollectionSettings(on: boolean, texts: Record<CollectionKey, string>): Promise<void> {
  for (const p of COLLECTION_POINTS) await setFlag(`collect_${p.key}`, texts[p.key].trim().slice(0, 200) || " ");
  await setFlag("collect_on", on ? "on" : "off");
}
