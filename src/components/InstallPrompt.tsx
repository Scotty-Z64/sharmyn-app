import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';

// Chrome/Android/Edge fire this before showing their own install UI — capturing
// it lets us trigger the native install flow from our own button instead of
// relying on Ben finding it buried in the browser menu. iOS Safari never fires
// this event at all (Apple has no install API), so there we can only show
// instructions for the manual Share -> Add to Home Screen steps. And an
// in-app browser (opening the link from inside WhatsApp, Instagram, etc.)
// often fires neither and actively blocks installing at all — that's the
// single most common reason someone can't install a PWA from their phone.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return !!(window.navigator as Navigator & { standalone?: boolean }).standalone;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** True when the page is almost certainly running inside an in-app browser
 * (WhatsApp, Instagram, Facebook, TikTok, ...) rather than real Chrome/Safari —
 * these routinely block installing a PWA and never fire beforeinstallprompt. */
function isLikelyInAppBrowser(): boolean {
  const ua = window.navigator.userAgent.toLowerCase();
  return /fban|fbav|instagram|whatsapp|tiktok|line\/|micromessenger|snapchat/.test(ua);
}

function useDeferredInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  return deferred;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-3 text-sm text-ink-900">
      <span className="shrink-0 w-7 h-7 rounded-full bg-blush-100 grid place-items-center font-semibold text-xs">{n}</span>
      {children}
    </p>
  );
}

/** Shared "how to install" modal — iOS gets the exact Share -> Add to Home
 * Screen steps; everything else (Android where the native prompt didn't fire,
 * an in-app browser, desktop) gets a generic fallback that calls out the
 * in-app-browser trap by name, since that's the most likely real blocker. */
function InstallHelpModal({ appName, ios, onClose }: { appName: string; ios: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-white rounded-2xl p-6 text-center">
        <p className="font-display text-xl font-semibold text-ink-900">Add {appName} to your Home Screen</p>
        <div className="mt-5 space-y-4 text-left">
          {ios ? (
            <>
              <Step n={1}>Tap the <Share size={16} className="inline mx-1 -mt-0.5" /> <b>Share</b> button in Safari's toolbar.</Step>
              <Step n={2}>Scroll down and tap <SquarePlus size={16} className="inline mx-1 -mt-0.5" /> <b>Add to Home Screen</b>.</Step>
              <Step n={3}>Tap <b>Add</b> — done! It'll appear on your Home Screen like any other app.</Step>
            </>
          ) : (
            <>
              <Step n={1}>
                If you opened this from WhatsApp, Instagram or another app, tap <b>••• </b>
                or <b>Open in Browser</b> first — installing doesn't work from inside those apps.
              </Step>
              <Step n={2}>In Chrome, tap the <b>⋮</b> menu (top-right) and choose <b>Add to Home screen</b> or <b>Install app</b>.</Step>
              <Step n={3}>Confirm — {appName} will appear on your Home Screen like any other app.</Step>
            </>
          )}
        </div>
        <button onClick={onClose}
          className="mt-6 w-full h-12 rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 transition">
          Got it
        </button>
      </div>
    </div>
  );
}

/** Dismissible "Install app" banner — same component, different copy/scope for
 * the store vs the owner portal (each has its own manifest and dismissal key). */
export default function InstallPrompt({ storageKey, appName }: { storageKey: string; appName: string }) {
  const deferred = useDeferredInstallPrompt();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1');
  const [showHelp, setShowHelp] = useState(false);

  const dismiss = () => {
    try { localStorage.setItem(storageKey, '1'); } catch { /* private browsing — fine, just won't persist */ }
    setDismissed(true);
  };

  if (dismissed || isStandalone()) return null;
  // Nothing actionable here (desktop Chrome without a trigger yet, Firefox, etc.) — stay invisible.
  // An in-app browser gets the banner too, even with no native prompt: it's the
  // one case where "tap here" genuinely helps, since the fallback modal calls
  // out exactly why the install is stuck and what to do about it.
  if (!deferred && !isIos() && !isLikelyInAppBrowser()) return null;

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      dismiss();
      return;
    }
    setShowHelp(true);
  };

  return (
    <>
      {/* Sits above the app's own sticky header in normal flow rather than being
          sticky itself — two stacked sticky elements at top-0 would fight for
          the same position once you scroll. */}
      <div className="relative z-[65] bg-gold-500 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-11 flex items-center justify-between gap-3">
          <button onClick={() => void install()} className="flex-1 min-w-0 flex items-center gap-2 text-left">
            <Download size={16} className="shrink-0" />
            <span className="text-[12px] font-semibold truncate">
              Add {appName} to your home screen — tap here
            </span>
          </button>
          <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 w-7 h-7 grid place-items-center rounded-full hover:bg-white/20 transition">
            <X size={15} />
          </button>
        </div>
      </div>

      {showHelp && <InstallHelpModal appName={appName} ios={isIos()} onClose={() => { setShowHelp(false); dismiss(); }} />}
    </>
  );
}

/** Persistent, always-discoverable install icon for a header — unlike the
 * banner above, this never hides itself based on a dismissed flag or on
 * whether the native prompt has fired yet, so there's always a way in even
 * if the banner was dismissed earlier or never appeared (in-app browsers,
 * Android before its install heuristics are satisfied, etc.). */
export function InstallButton({ appName, className, children }: { appName: string; className?: string; children?: React.ReactNode }) {
  const deferred = useDeferredInstallPrompt();
  const [showHelp, setShowHelp] = useState(false);
  const [standalone] = useState(isStandalone);

  if (standalone) return null;

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      return;
    }
    setShowHelp(true);
  };

  return (
    <>
      <button type="button" onClick={() => void install()} aria-label={`Add ${appName} to home screen`}
        title={`Add ${appName} to home screen`}
        className={className ?? 'w-11 h-11 grid place-items-center text-ink-900 hover:text-gold-500 transition-colors'}>
        {children ?? <Download size={20} />}
      </button>
      {showHelp && <InstallHelpModal appName={appName} ios={isIos()} onClose={() => setShowHelp(false)} />}
    </>
  );
}
