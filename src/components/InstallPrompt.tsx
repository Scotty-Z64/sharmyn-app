import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';

// Chrome/Android/Edge fire this before showing their own install UI — capturing
// it lets us trigger the native install flow from our own button instead of
// relying on Ben finding it buried in the browser menu. iOS Safari never fires
// this event at all (Apple has no install API), so there we can only show
// instructions for the manual Share -> Add to Home Screen steps.
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

/** Dismissible "Install app" banner — same component, different copy/scope for
 * the store vs the owner portal (each has its own manifest and dismissal key). */
export default function InstallPrompt({ storageKey, appName }: { storageKey: string; appName: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1');
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(storageKey, '1'); } catch { /* private browsing — fine, just won't persist */ }
    setDismissed(true);
  };

  if (dismissed || isStandalone()) return null;
  // Nothing actionable here (desktop Chrome without a trigger yet, Firefox, etc.) — stay invisible.
  if (!deferred && !isIos()) return null;

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      dismiss();
      return;
    }
    setShowIosHelp(true);
  };

  return (
    <>
      {/* Sits above the app's own sticky header in normal flow rather than being
          sticky itself — two stacked sticky elements at top-0 would fight for
          the same position once you scroll. */}
      <div className="relative z-[65] bg-gold-500 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-11 flex items-center justify-between gap-3">
          <button onClick={install} className="flex-1 min-w-0 flex items-center gap-2 text-left">
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

      {showIosHelp && (
        <div className="fixed inset-0 z-[80] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowIosHelp(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm bg-white rounded-2xl p-6 text-center">
            <p className="font-display text-xl font-semibold text-ink-900">Add {appName} to your Home Screen</p>
            <div className="mt-5 space-y-4 text-left">
              <p className="flex items-start gap-3 text-sm text-ink-900">
                <span className="shrink-0 w-7 h-7 rounded-full bg-blush-100 grid place-items-center font-semibold text-xs">1</span>
                Tap the <Share size={16} className="inline mx-1 -mt-0.5" /> <b>Share</b> button in Safari's toolbar.
              </p>
              <p className="flex items-start gap-3 text-sm text-ink-900">
                <span className="shrink-0 w-7 h-7 rounded-full bg-blush-100 grid place-items-center font-semibold text-xs">2</span>
                Scroll down and tap <SquarePlus size={16} className="inline mx-1 -mt-0.5" /> <b>Add to Home Screen</b>.
              </p>
              <p className="flex items-start gap-3 text-sm text-ink-900">
                <span className="shrink-0 w-7 h-7 rounded-full bg-blush-100 grid place-items-center font-semibold text-xs">3</span>
                Tap <b>Add</b> — done! It'll appear on your Home Screen like any other app.
              </p>
            </div>
            <button onClick={() => { setShowIosHelp(false); dismiss(); }}
              className="mt-6 w-full h-12 rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 transition">
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
