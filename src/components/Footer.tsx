import { Link } from 'react-router';
import { BUSINESS, waLink } from '@/config/business';
import { WhatsAppIcon } from './WhatsAppFloat';

const SHOP_LINKS = [
  { label: 'Sneakers', to: '/#sneakers' },
  { label: 'Custom Jewellery', to: '/#jewellery' },
  { label: 'Handbags', to: '/#handbags' },
  { label: 'Clothing', to: '/#clothing' },
];

export default function Footer() {
  return (
    <footer id="contact" className="bg-white border-t border-gold-400/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-2 gap-8">
        <div>
          <h4 className="text-[11px] uppercase tracking-[0.2em] text-gold-500 font-semibold mb-4">Shop</h4>
          <ul className="space-y-2.5">
            {SHOP_LINKS.map((l) => (
              <li key={l.label}><Link to={l.to} className="text-sm text-ink-900 hover:text-rose-500 transition-colors">{l.label}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] uppercase tracking-[0.2em] text-gold-500 font-semibold mb-4">Help</h4>
          <ul className="space-y-2.5">
            <li><Link to="/track" className="text-sm text-ink-900 hover:text-rose-500 transition-colors">Track Order</Link></li>
            <li><Link to="/checkout" className="text-sm text-ink-900 hover:text-rose-500 transition-colors">Checkout</Link></li>
            <li>
              <a
                href={waLink(BUSINESS.whatsapp, `Hi ${BUSINESS.name}! I have a question.`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-ink-900 hover:text-rose-500 transition-colors"
              >
                <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> Chat to us on WhatsApp
              </a>
            </li>
            <li>
              <a href={`mailto:${BUSINESS.email}`} className="text-sm text-ink-900 hover:text-rose-500 transition-colors">
                {BUSINESS.email}
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gold-400/25">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
          <p className="text-xs text-ink-500 text-center">
            © 2025 Sharmyn Boutique · Style That Defines You · South Africa
          </p>
        </div>
      </div>
    </footer>
  );
}
