// Server-only admin auth. Never imported from src/ (client bundle).
//
// Token flow:
//   1. adminLogin({ password }) → { token } (12h expiry)
//   2. All other admin procedures take { token } and call assertAdminToken.
// Token = `${expMs}.${hmac}` where hmac = HMAC-SHA256(`exp:${expMs}`, secret),
// secret derived from ADMIN_PASSWORD + APP_SECRET. Fails CLOSED when
// ADMIN_PASSWORD is unset: every admin procedure throws PRECONDITION_FAILED.
import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
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
  return `${adminPassword()}|${process.env.APP_SECRET ?? ""}`;
}

export function verifyAdminPassword(password: string): boolean {
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
