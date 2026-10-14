import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { trpc } from '@/providers/trpc';

const pad = (n: number) => String(n).padStart(2, '0');

/** Countdown to the payment deadline set by the Provider. Shows nothing when no deadline is set. */
export default function PaymentNotice() {
  const q = trpc.shop.paymentNotice.useQuery(undefined, { refetchInterval: 10 * 60_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const n = q.data;
  if (!n) return null;

  const end = Date.parse(n.deadline);
  const left = end - now;
  const overdue = left <= 0;
  const s = Math.max(0, Math.floor(left / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const urgent = overdue || left < 7 * 86400_000;
  const dateText = new Date(n.deadline).toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <div role="alert" className={`${urgent ? 'bg-rose-700' : 'bg-ink-900'} text-white`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5">
        <div className="flex items-center gap-2 shrink-0">
          <Clock size={18} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">
            {overdue ? 'Payment overdue' : 'Payment deadline'}
          </span>
        </div>
        {!overdue && (
          <div className="font-mono tabular-nums text-lg sm:text-xl font-semibold shrink-0">
            {d}d {pad(h)}h {pad(m)}m {pad(sec)}s
          </div>
        )}
        <p className="text-[12px] leading-snug sm:flex-1">
          {overdue
            ? `R${n.amount.toLocaleString('en-ZA')} is overdue under the Service Level Agreement. Please arrange payment and send proof of payment. `
            : `R${n.amount.toLocaleString('en-ZA')} is due by ${dateText} under the Service Level Agreement. `}
          Reference “{n.reference}”.{' '}
          <a href="https://wa.me/27637383625" target="_blank" rel="noreferrer" className="underline font-semibold">
            Send proof to Zane Scott: {n.contact}
          </a>
        </p>
      </div>
    </div>
  );
}
