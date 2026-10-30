import { useEffect } from 'react';

/**
 * On a tablet the owner portal asks the device to stay sideways (the way the shop is used on one).
 * Phones are left alone and keep turning freely. Only an installed app on Android can honour the request;
 * browser tabs and iPads refuse it, and that refusal is ignored.
 */
export function useTabletLandscape(): void {
  useEffect(() => {
    const shortSide = Math.min(window.screen.width, window.screen.height);
    const orientation = window.screen.orientation as unknown as
      { lock?: (o: string) => Promise<void>; unlock?: () => void } | undefined;
    if (shortSide < 600 || !orientation?.lock) return;
    orientation.lock('landscape').catch(() => { /* not installed as an app, or the device will not allow it */ });
    return () => { try { orientation.unlock?.(); } catch { /* it was never locked */ } };
  }, []);
}
