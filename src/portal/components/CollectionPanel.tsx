import { useEffect, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';

const box = 'mt-1 w-full px-3 py-2.5 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 resize-none';

/** Overview card: switch "collect from us" on for Krugersdorp and Hartbeespoort, with an address for each. */
export default function CollectionPanel() {
  const { token, toast } = usePortal();
  const q = trpc.shop.collectionAdmin.useQuery({ token }, { staleTime: 30_000 });
  const save = trpc.shop.setCollection.useMutation();
  const [on, setOn] = useState(false);
  const [kru, setKru] = useState('');
  const [har, setHar] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.data) { setOn(q.data.on); setKru(q.data.krugersdorp); setHar(q.data.hartbeespoort); }
  }, [q.data]);

  const dirty = !!q.data && (q.data.on !== on || q.data.krugersdorp !== kru.trim() || q.data.hartbeespoort !== har.trim());
  const showing = [q.data?.krugersdorp && 'Krugersdorp', q.data?.hartbeespoort && 'Hartbeespoort'].filter(Boolean).join(' and ');
  const submit = async () => {
    if (save.isPending) return;
    setError('');
    if (on && !kru.trim() && !har.trim()) { setError('Type where customers can collect (at least one place) first.'); return; }
    try {
      await save.mutateAsync({ token, on, krugersdorp: kru, hartbeespoort: har });
      void q.refetch();
      toast(on ? 'Collection is on' : 'Collection is off');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'It could not be saved.');
    }
  };

  return (
    <div className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
          <MapPin size={18} className="text-gold-500" /> Collect from us
        </h3>
        {q.isLoading ? (
          <Loader2 size={16} className="animate-spin text-ink-500" />
        ) : (
          <button onClick={() => setOn((v) => !v)} role="switch" aria-checked={on} aria-label="Collection on or off"
            className={`h-7 w-12 rounded-full p-0.5 transition-colors ${on ? 'bg-gold-500' : 'bg-blush-100'}`}>
            <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        When this is on, customers choose to collect in Krugersdorp or Hartbeespoort for free, and Pudo lockers in a town with an address below are switched off at checkout.
        A town with no address is not offered. Only type an address you are happy for customers to see.
      </p>
      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Krugersdorp</label>
      <textarea value={kru} onChange={(e) => setKru(e.target.value)} rows={2} maxLength={200}
        placeholder="Address, and when to collect, e.g. 4 Olivier Street, Noordheuwel. Mon to Fri, 9am to 5pm." className={box} />
      <label className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Hartbeespoort</label>
      <textarea value={har} onChange={(e) => setHar(e.target.value)} rows={2} maxLength={200}
        placeholder="Address, and when to collect, e.g. Landsmeer Estate, Hartebeespoortdam. Call on arrival." className={box} />
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      <div className="mt-2 flex items-center gap-3">
        <button onClick={() => void submit()} disabled={!dirty || save.isPending}
          className="h-11 px-5 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-gold-400 transition-colors disabled:opacity-50 flex items-center gap-2">
          {save.isPending && <Loader2 size={14} className="animate-spin" />} Save
        </button>
        <span className="text-[11px] text-ink-500">{q.data?.on && showing ? `Showing to customers: ${showing}.` : 'Not showing to customers yet.'}</span>
      </div>
    </div>
  );
}
