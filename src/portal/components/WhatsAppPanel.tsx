import { useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, XCircle } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';

const KIND_LABEL: Record<string, string> = {
  payment: 'Banking details + invoice',
  received: 'Payment received + paid invoice',
  shipped: 'Shipped + tracking',
  issue: 'Payment problem notice',
  owner_proof: 'Proof-of-payment alert to you',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Overview card: is automatic WhatsApp working right now, and a one-tap test to any number. */
export default function WhatsAppPanel() {
  const { token } = usePortal();
  const status = trpc.shop.whatsappStatus.useQuery({ token }, { staleTime: 60_000 });
  const testMut = trpc.shop.sendWhatsAppTest.useMutation();
  const [to, setTo] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const s = status.data;

  const send = async () => {
    if (testMut.isPending || to.replace(/\D/g, '').length < 9) return;
    setResult(null);
    try {
      await testMut.mutateAsync({ token, to });
      setResult({ ok: true, text: 'Sent. Check that phone for Meta\u2019s "Hello World" message.' });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'The test message could not be sent.' });
    }
  };

  return (
    <div className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
          <MessageCircle size={18} className="text-gold-500" /> Automatic WhatsApp
        </h3>
        {status.isLoading ? (
          <Loader2 size={16} className="animate-spin text-ink-500" />
        ) : s?.ok ? (
          <span className="h-7 px-3 rounded-full bg-gold-400/20 text-emerald-700 text-[11px] font-semibold uppercase tracking-[0.08em] flex items-center gap-1">
            <CheckCircle2 size={13} /> Connected
          </span>
        ) : (
          <span className="h-7 px-3 rounded-full bg-rose-100 text-rose-600 text-[11px] font-semibold uppercase tracking-[0.08em] flex items-center gap-1">
            <XCircle size={13} /> {s?.configured ? 'Not working' : 'Not set up'}
          </span>
        )}
      </div>
      {s?.ok && <p className="mt-2 text-xs text-ink-500">Sending from {s.number}{s.name ? ` (${s.name})` : ''}.</p>}
      {s && !s.ok && <p className="mt-2 text-xs text-rose-600">{s.problem}</p>}
      {s && !s.ok && <p className="mt-1 text-[11px] text-ink-500">Until it is fixed, use the WhatsApp buttons on each order. Nothing else is affected.</p>}

      <div className="mt-3 flex gap-2">
        <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="tel" placeholder="Test number, e.g. 082 123 4567"
          className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300" />
        <button onClick={() => void send()} disabled={testMut.isPending || to.replace(/\D/g, '').length < 9}
          className="h-11 px-4 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-gold-400 transition-colors disabled:opacity-50">
          {testMut.isPending ? 'Sending…' : 'Send test'}
        </button>
      </div>
      {result && <p className={`mt-2 text-xs ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{result.text}</p>}
    </div>
  );
}

/** Inside an open order: what the automatic WhatsApps for it did, and why any failed. */
export function OrderMessages({ orderId }: { orderId: string }) {
  const { token } = usePortal();
  const q = trpc.shop.orderMessages.useQuery({ token, id: orderId }, { staleTime: 15_000 });
  const rows = q.data ?? [];
  if (q.isLoading || rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-blush-100 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500 mb-2">Automatic WhatsApp messages</p>
      <ul className="space-y-1.5">
        {rows.map((m, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            {m.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-rose-600" />}
            <span className="min-w-0">
              <span className="font-semibold text-ink-900">{KIND_LABEL[m.kind] ?? m.kind}</span>
              <span className="text-ink-500"> · {when(m.at)}</span>
              <span className={`block ${m.ok ? 'text-ink-500' : 'text-rose-600'}`}>{m.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
