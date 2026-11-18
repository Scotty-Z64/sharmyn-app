// Server-only admin auth. Never imported from src/ (client bundle).
//
// Token flow:
//   1. adminLogin({ password }) → { token } (30d expiry)
//   2. All other admin procedures take { token } and call assertAdminToken.
// Token = `${expMs}.${hmac}` where hmac = HMAC-SHA256(`exp:${expMs}`, secret),
// secret derived from ADMIN_PASSWORD + APP_SECRET. Fails CLOSED when
// ADMIN_PASSWORD is unset: every admin procedure throws PRECONDITION_FAILED.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

// 30d, paired with client-side localStorage (not sessionStorage) token
// storage — this is a single shared owner password, not a per-user account,
// so "stay logged in" is the expected behaviour rather than a security
// regression; logging out is still one tap away.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// A password the owner chose inside the portal is kept as a salted hash (never the password itself).
// While one is set it replaces ADMIN_PASSWORD from Render: the old password stops working and every
// login made with it is cut off, because tokens are signed with the stored hash instead. Clearing it
// (delete the "admin_pw_hash" row from app_flags) hands control back to ADMIN_PASSWORD.
const HASH_PREFIX = "s1";
let storedHash: string | null = null;

export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16);
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${scryptSync(password, salt, 32).toString("base64url")}`;
}

function parseHash(h: string | null): { salt: Buffer; key: Buffer } | null {
  const [prefix, salt, key] = (h ?? "").split("$");
  if (prefix !== HASH_PREFIX || !salt || !key) return null;
  return { salt: Buffer.from(salt, "base64url"), key: Buffer.from(key, "base64url") };
}

/** Called with the hash read from the database (null = none). A value that cannot be read is ignored, so Render's password still gets the owner in. */
export function setStoredAdminHash(h: string | null): void {
  storedHash = parseHash(h) ? h : null;
}

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD || !!storedHash;
}

function adminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ADMIN_NOT_CONFIGURED",
    });
  }
  return pw;
}

function secret(): string {
  return `${storedHash ?? adminPassword()}|${process.env.APP_SECRET ?? ""}`;
}

export function verifyAdminPassword(password: string): boolean {
  const parsed = parseHash(storedHash);
  if (parsed) {
    const got = scryptSync(password, parsed.salt, parsed.key.length);
    return got.length === parsed.key.length && timingSafeEqual(got, parsed.key);
  }
  const expected = adminPassword();
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function issueAdminToken(): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = createHmac("sha256", secret()).update(`exp:${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function assertAdminToken(token: string): void {
  const [expStr, sig] = (token ?? "").split(".");
  const exp = Number(expStr);
  if (!expStr || !sig || !Number.isFinite(exp) || exp < Date.now()) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired admin token" });
  }
  const expected = createHmac("sha256", secret()).update(`exp:${expStr}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired admin token" });
  }
}

// ---- tiny in-memory per-IP rate limiter ----

const buckets = new Map<string, number[]>();

/**
 * Throws TOO_MANY_REQUESTS when `key` exceeds `limit` calls within `windowMs`.
 * Key should include the client IP + procedure, e.g. `adminLogin:1.2.3.4`.
 */
export function rateLimit(key: string, limit: number, windowMs = 60_000): void {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests — slow down" });
  }
  arr.push(now);
  buckets.set(key, arr);
  // Occasional cleanup so the map doesn't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
