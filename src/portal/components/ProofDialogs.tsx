import { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Loader2 } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import type { Order } from '@/portal/lib/utils-shop';

/** Shows the proof of payment the customer uploaded, next to the invoice, so the owner can check it against the bank account. */
export function ProofViewer({ order, onClose }: { order: Order; onClose: () => void }) {
  const { token } = usePortal();
  const proofQuery = trpc.shop.adminPaymentProof.useQuery({ token, id: order.id });
  const proof = proofQuery.data;
  const isPdf = proof?.mime === 'application/pdf';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-ink-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ y: 30, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-5 border-t-2 border-gold-400/60">
        <h3 className="font-display text-xl font-semibold text-ink-900">Proof of payment · {order.id}</h3>
        <p className="mt-1 text-sm text-ink-500">
          Check that <strong>{`R ${order.total}`}</strong> from {order.customer.name} is showing in the FNB account, with {order.id} as the reference.
        </p>

        <div className="mt-4 rounded-xl border border-blush-100 bg-blush-50 min-h-[160px] grid place-items-center overflow-hidden">
          {proofQuery.isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          ) : !proof ? (
            <p className="p-6 text-sm text-ink-500">No proof of payment has been uploaded for this order.</p>
          ) : isPdf ? (
            <iframe title="Proof of payment" src={proof.dataUrl} className="w-full h-[60vh] bg-white" />
          ) : (
            <img src={proof.dataUrl} alt="Customer's proof of payment" className="w-full h-auto" />
          )}
        </div>

        {proof && (
          <p className="mt-2 text-[11px] text-ink-500">
            Uploaded {new Date(proof.createdAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}

        <div className="mt-4 flex gap-3">
          <a href={`/api/invoice/${order.id}`} target="_blank" rel="noreferrer"
            className="flex-1 h-11 rounded-full border border-gold-400 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 hover:bg-blush-50">
            <Download size={13} /> Invoice
          </a>
          <button onClick={onClose}
            className="flex-1 h-11 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-gold-400">
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const QUICK_REASONS = [
  'The money is not showing in our account yet',
  'The amount does not match the order total',
  'The proof is unclear — please send it again',
];

/** Rejecting a payment needs a reason: the customer is told what it is and asked for a new proof. */
export function RejectPaymentDialog({
  order, busy, onReject, onCancel,
}: { order: Order; busy: boolean; onReject: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}>
      <motion.div initial={{ y: 30, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 border-t-2 border-gold-400/60">
        <h3 className="font-display text-xl font-semibold text-ink-900">Payment not confirmed for {order.id}?</h3>
        <p className="mt-2 text-sm text-ink-500">
          The order stays on hold. {order.customer.name} is told why and asked to send a new proof of payment.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={`px-3 py-1.5 rounded-full border text-[11px] text-left ${reason === r ? 'border-gold-400 bg-blush-100 text-ink-900' : 'border-blush-100 text-ink-500 hover:bg-blush-50'}`}>
              {r}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500" htmlFor="reject-reason">Reason the customer will see</label>
        <textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 160))} rows={3}
          className="mt-1 w-full rounded-xl border border-blush-100 p-3 text-sm text-ink-900 focus:outline-none focus:border-gold-400"
          placeholder="e.g. The money is not showing in our account yet" />
        <div className="mt-5 flex gap-3">
          <button onClick={onCancel}
            className="flex-1 h-11 rounded-full border border-blush-100 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500 hover:bg-blush-50">
            Back
          </button>
          <button onClick={() => valid && onReject(reason.trim())} disabled={!valid || busy}
            className="flex-1 h-11 rounded-full bg-rose-600 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-[#C2496F] disabled:opacity-50">
            {busy ? 'Sending…' : 'Reject payment'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
