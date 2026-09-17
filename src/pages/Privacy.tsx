import LegalPageLayout, { Section } from '@/components/LegalPageLayout';
import { BUSINESS } from '@/config/business';

export default function Privacy() {
  return (
    <LegalPageLayout title="Privacy Policy" updated="18 September 2026">
      <p className="text-[15px] text-ink-500 leading-relaxed">
        {BUSINESS.name} ("we", "us") respects your privacy and handles your personal information in
        line with South Africa's Protection of Personal Information Act (POPIA). This page explains
        what we collect, why, and how you can contact us about it.
      </p>

      <Section title="What we collect">
        <p>When you place an order, track an order, or contact us, we collect:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Name, email address, and phone number</li>
          <li>Delivery address and city (only when you choose door or locker delivery)</li>
          <li>Order details — items, sizes, prices, delivery method</li>
          <li>Payment status from our payment gateway (we never see or store your card details)</li>
        </ul>
      </Section>

      <Section title="Why we collect it">
        <ul className="list-disc pl-5 space-y-1">
          <li>To process, pack, and deliver your order</li>
          <li>To contact you about your order (WhatsApp, email, or phone)</li>
          <li>To send order confirmations, invoices, and delivery updates</li>
          <li>To handle exchanges, cancellations, and customer support requests</li>
        </ul>
      </Section>

      <Section title="Who we share it with">
        <p>We only share what's needed to fulfil your order:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Pudo</strong> — locker name/city, for locker deliveries</li>
          <li><strong>Our courier partner</strong> — name, phone, and address, for door deliveries</li>
          <li><strong>Our payment gateway</strong> (Payfast/Yoco) — for processing online payments</li>
          <li><strong>Resend</strong> (our email provider) — to send order and invoice emails</li>
        </ul>
        <p>We never sell your information to anyone.</p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep order records for as long as needed for accounting, tax, and warranty/exchange
          purposes, in line with South African legal requirements.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Under POPIA, you can ask us to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Tell you what personal information we hold about you</li>
          <li>Correct information that's wrong or outdated</li>
          <li>Delete information we no longer need to keep by law</li>
        </ul>
        <p>
          To make a request, email{' '}
          <a href={`mailto:${BUSINESS.email}`} className="text-gold-500 underline">{BUSINESS.email}</a>{' '}
          or WhatsApp us on {BUSINESS.whatsapp}.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy? Reach us at{' '}
          <a href={`mailto:${BUSINESS.email}`} className="text-gold-500 underline">{BUSINESS.email}</a>.
        </p>
      </Section>
    </LegalPageLayout>
  );
}
