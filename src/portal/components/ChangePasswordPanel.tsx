import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { storePortalToken, usePortal } from '@/portal/lib/portal';

const field = 'w-full h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300';

/** Overview card: the owner picks a new portal password here. Everyone else who is logged in is signed out. */
export default function ChangePasswordPanel() {
  const { token, toast } = usePortal();
  const change = trpc.shop.changeAdminPassword.useMutation();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    if (change.isPending) return;
    setError('');
    if (next.length < 10) { setError('Choose a password of at least 10 characters.'); return; }
    if (next !== again) { setError('The two new passwords are not the same.'); return; }
    try {
      const res = await change.mutateAsync({ token, currentPassword: current, newPassword: next });
      storePortalToken(res.token);
      toast('Password changed. Everyone else has been signed out.');
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The password could not be changed.');
    }
  };

  return (
    <div className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
          <KeyRound size={18} className="text-gold-500" /> Portal password
        </h3>
        {!open && (
          <button onClick={() => setOpen(true)}
            className="h-11 px-4 rounded-full border border-gold-400 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-gold-400/10 transition-colors">
            Change password
          </button>
        )}
      </div>
      {!open ? (
        <p className="mt-1 text-xs text-ink-500">Anyone with this password can open the portal. Change it if someone who should not have it has seen it.</p>
      ) : (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className={field} />
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (at least 10 characters)" className={field} />
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="New password again" className={field} />
          <p className="text-[11px] text-ink-500">Everyone else who is logged in, on any phone or tablet, is signed out the moment this is saved. Write the new password down somewhere safe.</p>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={change.isPending || !current || !next || !again}
              className="h-11 px-5 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-gold-400 transition-colors disabled:opacity-50 flex items-center gap-2">
              {change.isPending && <Loader2 size={14} className="animate-spin" />} Save new password
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(''); setCurrent(''); setNext(''); setAgain(''); }}
              className="h-11 px-4 rounded-full text-ink-500 text-[11px] font-semibold uppercase tracking-[0.1em]">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
