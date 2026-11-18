import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertAdminToken,
  hashAdminPassword,
  issueAdminToken,
  setStoredAdminHash,
  verifyAdminPassword,
} from "./admin";

const keep = { pw: process.env.ADMIN_PASSWORD, secret: process.env.APP_SECRET };
beforeEach(() => {
  process.env.ADMIN_PASSWORD = "render-password-1";
  process.env.APP_SECRET = "test-secret";
  setStoredAdminHash(null);
});
afterEach(() => {
  setStoredAdminHash(null);
  if (keep.pw === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = keep.pw;
  if (keep.secret === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = keep.secret;
});

describe("portal password", () => {
  it("is the one from Render until the owner chooses another", () => {
    expect(verifyAdminPassword("render-password-1")).toBe(true);
    expect(verifyAdminPassword("something else")).toBe(false);
  });

  it("is replaced by the one the owner chooses: the Render password stops working", () => {
    setStoredAdminHash(hashAdminPassword("my-new-password-9"));
    expect(verifyAdminPassword("my-new-password-9")).toBe(true);
    expect(verifyAdminPassword("render-password-1")).toBe(false);
  });

  it("stores a salted hash, never the password, and two hashes of one password differ", () => {
    const a = hashAdminPassword("my-new-password-9");
    const b = hashAdminPassword("my-new-password-9");
    expect(a).not.toContain("my-new-password-9");
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(100); // fits the app_flags value column
  });

  it("signs out every login made before the change, and accepts new ones", () => {
    const before = issueAdminToken();
    expect(() => assertAdminToken(before)).not.toThrow();
    setStoredAdminHash(hashAdminPassword("my-new-password-9"));
    expect(() => assertAdminToken(before)).toThrow();
    expect(() => assertAdminToken(issueAdminToken())).not.toThrow();
  });

  it("falls back to the Render password if the stored value is unreadable", () => {
    setStoredAdminHash("garbage");
    expect(verifyAdminPassword("render-password-1")).toBe(true);
    expect(() => assertAdminToken(issueAdminToken())).not.toThrow();
  });

  it("lets the owner back in with the Render password once the stored one is cleared", () => {
    setStoredAdminHash(hashAdminPassword("my-new-password-9"));
    setStoredAdminHash(null);
    expect(verifyAdminPassword("render-password-1")).toBe(true);
  });
});
