import LegalPageLayout, { Section } from '@/components/LegalPageLayout';
import { BUSINESS, waLink } from '@/config/business';

export default function Returns() {
  return (
    <LegalPageLayout title="Returns & Exchanges" updated="18 September 2026">
      <p className="text-[15px] text-ink-500 leading-relaxed">
        We want you to love what you ordered. If something isn't right, here's how exchanges and
        returns work.
      </p>

      <Section title="Your right to cancel">
        <p>
          Under South Africa's Electronic Communications and Transactions Act, you may cancel an
          online order within 7 calendar days of receiving it, without penalty, for a full refund —
          except for customised or personalised items (such as made-to-order custom jewellery), which
          cannot be cancelled once we've started making them.
        </p>
      </Section>

      <Section title="Exchanges">
        <p>
          Prefer a different size or colour? WhatsApp us your order number within 7 days of delivery
          and we'll arrange an exchange — no additional charge, subject to stock availability. We'll
          send you a confirmation slip once it's processed.
        </p>
      </Section>

      <Section title="Condition for returns/exchanges">
        <ul className="list-disc pl-5 space-y-1">
          <li>Unworn, unwashed, and in its original packaging with tags attached</li>
          <li>Accompanied by your order number or invoice</li>
        </ul>
      </Section>

      <Section title="Refunds">
        <p>
          Once we've received and checked the returned item, we'll refund your original payment
          method within 7 working days. If you paid via EFT or on delivery, we'll arrange the refund
          with you directly on WhatsApp.
        </p>
      </Section>

      <Section title="How to start a return or exchange">
        <p>
          Message us on WhatsApp with your order number and what you'd like to do — we'll take it
          from there.
        </p>
        <a
          href={waLink(BUSINESS.whatsappSupport, `Hi ${BUSINESS.name}! I'd like to return/exchange an item from my order.`)}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 mt-2 h-11 px-5 rounded-full bg-gold-400 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-500 transition-colors"
        >
          WhatsApp us about a return
        </a>
      </Section>
    </LegalPageLayout>
  );
}
