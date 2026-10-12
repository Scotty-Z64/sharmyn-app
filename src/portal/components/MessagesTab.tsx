import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ExternalLink, FileText, ImageIcon, Loader2, MessageCircle, X } from 'lucide-react';
import type { InboundMessage } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import { waLink } from '@/config/business';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function AttachmentViewer({ message, onClose }: { message: InboundMessage; onClose: () => void }) {
  const { token } = usePortal();
  const q = trpc.shop.inboundMedia.useQuery({ token, id: message.id }, { retry: false });
  const isPdf = message.mime === 'application/pdf';
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] bg-ink-900/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="relative w-full max-w-lg max-h-[90dvh] overflow-auto rounded-2xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-2 top-2 w-9 h-9 grid place-items-center rounded-full bg-white/90 text-ink-900 shadow">
          <X size={18} />
        </button>
        {q.isLoading && <div className="py-16 grid place-items-center text-ink-500"><Loader2 className="animate-spin" /></div>}
        {q.error && <p className="py-10 px-4 text-center text-sm text-rose-600">{q.error.message}</p>}
        {q.data && (isPdf
          ? <embed src={q.data.dataUrl} type="application/pdf" className="w-full h-[70dvh] rounded-xl" />
          : <img src={q.data.dataUrl} alt="Attachment" className="w-full rounded-xl" />)}
      </div>
    </motion.div>
  );
}

export default function MessagesTab() {
  const { token, toast } = usePortal();
  const utils = trpc.useUtils();
  const q = trpc.shop.inboundMessages.useQuery({ token }, { refetchInterval: 30_000 });
  const handledMut = trpc.shop.setInboundHandled.useMutation();
  const [showAll, setShowAll] = useState(false);
  const [viewing, setViewing] = useState<InboundMessage | null>(null);

  const all = q.data ?? [];
  const open = all.filter((m) => !m.handled);
  const list = showAll ? all : open;

  const setHandled = async (m: InboundMessage, handled: boolean) => {
    try {
      await handledMut.mutateAsync({ token, id: m.id, handled });
      await utils.shop.inboundMessages.invalidate();
    } catch {
      toast('Could not update — try again');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink-900 flex items-center gap-2">
            <MessageCircle size={20} className="text-gold-500" /> WhatsApp messages
          </h2>
          <p className="text-xs text-ink-500 mt-0.5">Everything customers send to the Sharmyn number lands here. Proofs of payment are filed on their order automatically.</p>
        </div>
        <div className="flex rounded-full bg-blush-100 p-1 shrink-0">
          {([['Open', false], ['All', true]] as const).map(([label, v]) => (
            <button key={label} onClick={() => setShowAll(v)}
              className={`h-9 px-4 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] transition ${showAll === v ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}>
              {label}{label === 'Open' && open.length > 0 ? ` · ${open.length}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {q.isLoading && <div className="py-12 grid place-items-center text-ink-500"><Loader2 className="animate-spin text-gold-500" /></div>}
        {!q.isLoading && list.length === 0 && (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-ink-500 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
            {showAll ? 'No messages yet.' : 'Nothing waiting for you. New messages show up here and in the bell.'}
          </div>
        )}
        {list.map((m) => (
          <motion.div key={m.id} layout className="rounded-2xl bg-white p-4 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900 truncate">{m.name || 'Unknown'} <span className="font-normal text-ink-500">· +{m.from}</span></p>
                <p className="text-[11px] text-ink-500">{when(m.at)}</p>
              </div>
              {m.attachedAsProof ? (
                <span className="shrink-0 h-7 px-3 rounded-full bg-gold-400/20 text-emerald-700 text-[10px] font-semibold uppercase tracking-[0.08em] grid place-items-center">
                  Proof filed on {m.orderId}
                </span>
              ) : m.orderId ? (
                <span className="shrink-0 h-7 px-3 rounded-full bg-blush-100 text-ink-500 text-[10px] font-semibold uppercase tracking-[0.08em] grid place-items-center">
                  Order {m.orderId}
                </span>
              ) : null}
            </div>
            {m.text && <p className="mt-2 text-sm text-ink-900 whitespace-pre-wrap break-words">{m.text}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {m.hasMedia && (
                <button onClick={() => setViewing(m)}
                  className="h-10 px-4 rounded-full bg-[#2E6FB0] text-white text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 hover:opacity-90">
                  {m.mime === 'application/pdf' ? <FileText size={14} /> : <ImageIcon size={14} />} View {m.mime === 'application/pdf' ? 'file' : 'photo'}
                </button>
              )}
              <a href={waLink(`+${m.from}`, `Hi ${(m.name || '').split(' ')[0] || ''}, it's Sharmyn. `.replace('Hi , ', 'Hi, '))} target="_blank" rel="noreferrer"
                className="h-10 px-4 rounded-full border border-gold-400/60 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 hover:bg-gold-400/10">
                <ExternalLink size={14} /> Reply on WhatsApp
              </a>
              <button onClick={() => void setHandled(m, !m.handled)} disabled={handledMut.isPending}
                className="h-10 px-4 rounded-full text-ink-500 text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 hover:text-ink-900 disabled:opacity-50">
                <CheckCircle2 size={14} /> {m.handled ? 'Mark as open' : 'Mark as done'}
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>{viewing && <AttachmentViewer message={viewing} onClose={() => setViewing(null)} />}</AnimatePresence>
    </div>
  );
}
