// Keeps the server's copy of the owner-chosen portal password current, so a change made on one
// request is honoured on the next. Cheap: at most one small read every 15 seconds.
import { setStoredAdminHash } from "../lib/admin";
import { readAdminPasswordHash } from "./flags";

const REFRESH_MS = 15_000;
let loadedAt = 0;

export async function refreshAdminAuth(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < REFRESH_MS) return;
  try {
    setStoredAdminHash(await readAdminPasswordHash());
    loadedAt = Date.now();
  } catch (e) {
    console.error("[admin] could not read the stored portal password:", e);
  }
}
