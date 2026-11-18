import { useEffect, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';

/** Overview card: switch "collect from us" on for Krugersdorp and Hartbeespoort, and say where and when. */
export default function CollectionPanel() {
  const { token, toast } = usePortal();
  const q = trpc.shop.collectionAdmin.useQuery({ token }, { staleTime: 30_000 });
  const save = trpc.shop.setCollection.useMutation();
  const [on, setOn] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.data) { setOn(q.data.on); setInfo(q.data.info); }
  }, [q.data]);

  const dirty = !!q.data && (q.data.on !== on || q.data.info !== info.trim());
  const submit = async () => {
    if (save.isPending) return;
    setError('');
    if (on && !info.trim()) { setError('Type where and when customers can collect first.'); return; }
    try {
      await save.mutateAsync({ token, on, info });
      void q.refetch();
      toast(on ? 'Collection is on for Krugersdorp and Hartbeespoort' : 'Collection is off');
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
          <button onClick={() => setOn((v) => !v)} role="switch" aria-checked={on}
            className={`h-7 w-12 rounded-full p-0.5 transition-colors ${on ? 'bg-gold-500' : 'bg-blush-100'}`}>
            <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        When this is on, customers in Krugersdorp and Hartbeespoort collect from you for free, and Pudo lockers in those two towns are switched off at checkout.
        Only type an address you are happy for customers to see.
      </p>
      <textarea value={info} onChange={(e) => setInfo(e.target.value)} rows={3} maxLength={400}
        placeholder="Where and when to collect, e.g. 12 Example Street, Krugersdorp. Mon to Fri, 9am to 5pm. Call 082 123 4567 on arrival."
        className="mt-3 w-full px-3 py-2.5 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 resize-none" />
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      <div className="mt-2 flex items-center gap-3">
        <button onClick={() => void submit()} disabled={!dirty || save.isPending}
          className="h-11 px-5 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-gold-400 transition-colors disabled:opacity-50 flex items-center gap-2">
          {save.isPending && <Loader2 size={14} className="animate-spin" />} Save
        </button>
        <span className="text-[11px] text-ink-500">{q.data?.on && q.data.info ? 'Showing to customers now.' : 'Not showing to customers yet.'}</span>
      </div>
    </div>
  );
}
