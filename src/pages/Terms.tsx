import LegalPageLayout, { Section } from '@/components/LegalPageLayout';
import { BUSINESS } from '@/config/business';

export default function Terms() {
  return (
    <LegalPageLayout title="Terms of Sale" updated="18 September 2026">
      <p className="text-[15px] text-ink-500 leading-relaxed">
        These terms apply to every order placed with {BUSINESS.name} through this website. By placing
        an order, you agree to them.
      </p>

      <Section title="Prices & availability">
        <p>
          All prices are shown in South African Rand (ZAR) and include VAT where applicable. We try
          to keep stock levels accurate, but if an item sells out before we confirm your order, we'll
          let you know and offer a refund or a swap for something similar.
        </p>
      </Section>

      <Section title="Payment">
        <p>
          You can pay online by card or instant EFT through our secure payment gateway, or choose
          "Pay later" and settle by EFT, SnapScan, or card on delivery — we'll confirm payment details
          with you on WhatsApp. Your order is only packed and shipped once payment is confirmed.
        </p>
      </Section>

      <Section title="Delivery">
        <p>We deliver anywhere in South Africa via Pudo smart locker — you choose the locker nearest
          you at checkout. Delivery is R150 per parcel of up to 3 items; larger orders are priced per
          extra parcel (e.g. 4–6 items is R300), shown at checkout before you pay.</p>
        <p>
          Delivery typically takes 2–4 working days from payment confirmation. Delays can happen with
          courier partners beyond our control — we'll keep you updated if this happens.
        </p>
      </Section>

      <Section title="Order changes & cancellations">
        <p>
          You can request a change or cancellation any time before your order is packed by WhatsApping
          us your order number. Once an order has shipped, our{' '}
          <a href="/returns" className="text-gold-500 underline">Returns & Exchanges</a> policy applies instead.
        </p>
      </Section>

      <Section title="Our right to refuse an order">
        <p>
          We may decline or cancel an order — for example if an item is out of stock, a price was
          listed incorrectly, or we suspect fraud. If this happens after payment, we'll refund you in full.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These terms are governed by the laws of South Africa, including the Consumer Protection Act
          and the Electronic Communications and Transactions Act.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about an order? WhatsApp us on {BUSINESS.whatsapp} or email{' '}
          <a href={`mailto:${BUSINESS.email}`} className="text-gold-500 underline">{BUSINESS.email}</a>.
        </p>
      </Section>
    </LegalPageLayout>
  );
}
