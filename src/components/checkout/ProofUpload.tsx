import { useRef, useState } from 'react';
import { CheckCircle2, Loader2, Upload, AlertTriangle } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { prepareProofFile, ProofFileError } from '@/lib/proof-upload';

interface Props {
  orderId: string;
  email: string;
  /** The latest proof's state as the server knows it (from the order). */
  proofStatus?: 'pending' | 'accepted' | 'rejected' | null;
  /** The owner's reason, when the last proof was rejected. */
  proofNote?: string | null;
  onUploaded?: () => void;
}

/**
 * "I've paid — here's my proof": the customer uploads a screenshot/photo/PDF of
 * the bank confirmation. The owner is notified with the proof and the invoice,
 * checks the funds and confirms (invoice + tracking go out) or rejects (with a
 * reason, and the customer can send a new one).
 */
export default function ProofUpload({ orderId, email, proofStatus, proofNote, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = trpc.shop.submitPaymentProof.useMutation();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await prepareProofFile(file);
      await submit.mutateAsync({ id: orderId, email, dataUrl });
      setSent(true);
      onUploaded?.();
    } catch (e) {
      if (e instanceof ProofFileError) setError(e.message);
      else setError((e as { message?: string } | null)?.message || 'Upload failed — please try again, or send it to us on WhatsApp.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ''; // allow re-picking the same file
    }
  };

  const waiting = sent || proofStatus === 'pending';
  const rejected = !sent && proofStatus === 'rejected';

  return (
    <div className="mt-6 mx-auto max-w-sm rounded-2xl border border-gold-400/40 bg-white p-5 text-left shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-gold-500">Already paid?</p>

      {waiting ? (
        <div className="mt-2 flex items-start gap-2 text-[14px] text-ink-900">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[#1F8A5B] mt-0.5" />
          <p>
            Thank you — we&rsquo;ve received your proof of payment. We&rsquo;ll check it and confirm your order shortly, then send your invoice and
            tracking details.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[14px] text-ink-500">Upload your proof of payment (a screenshot or PDF from your bank) so we can confirm your order.</p>
      )}

      {rejected && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-blush-100 p-3 text-[13px] text-rose-600">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            We couldn&rsquo;t confirm your last payment{proofNote ? `: ${proofNote}` : '.'} Please check it and upload a new proof.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-[13px] font-medium text-rose-600">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 h-12 rounded-full border border-rose-300 text-rose-600 text-[12px] font-semibold uppercase tracking-[0.14em] hover:bg-blush-100 active:scale-95 transition disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? 'Uploading…' : waiting ? 'Upload another' : rejected ? 'Upload a new proof' : 'Upload proof of payment'}
      </button>
    </div>
  );
}
