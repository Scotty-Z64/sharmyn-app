import { Loader2, PartyPopper } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';

/** Overview card: switch the Sharmyn Opening Special on or off. */
export default function PromoPanel() {
  const { token, toast } = usePortal();
  const utils = trpc.useUtils();
  const promo = trpc.shop.promo.useQuery(undefined, { staleTime: 0 });
  const setMut = trpc.shop.setOpeningSpecial.useMutation();
  const on = promo.data?.openingSpecial === true;

  const toggle = async () => {
    if (setMut.isPending || promo.isLoading) return;
    try {
      await setMut.mutateAsync({ token, enabled: !on });
      await utils.shop.promo.invalidate();
      toast(on ? 'Opening special switched off' : 'Opening special switched on');
    } catch {
      toast('Could not change it — try again');
    }
  };

  return (
    <div className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
          <PartyPopper size={18} className="text-gold-500" /> Opening special
        </h3>
        <button onClick={() => void toggle()} disabled={setMut.isPending || promo.isLoading} aria-pressed={on}
          className={`h-9 px-4 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-60 ${on ? 'bg-gold-500 text-white' : 'bg-blush-100 text-ink-500'}`}>
          {promo.isLoading || setMut.isPending ? <Loader2 size={14} className="animate-spin" /> : on ? 'On' : 'Off'}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        More than one pair of sneakers: R100 off each pair. More than one handbag: R50 off each handbag.
        {on ? ' Customers see the banner, the saving in their bag, and it is taken off the order automatically.' : ' Switched off: normal prices, no banner.'}
      </p>
    </div>
  );
}
