// Central business details for Sharmyn. Update these once and every
// touchpoint (footer, WhatsApp float, checkout, product pages) follows.
export const BUSINESS = {
  name: 'Sharmyn',
  tagline: "Women's fashion boutique",
  whatsapp: '+27616455670',
  whatsappSupport: '+27616455670', // same as main WhatsApp unless a separate support line is given
  email: 'hello@sharmyn.co.za', // TODO
  instagram: 'https://www.instagram.com/sharmynfashion',
  facebook: 'https://www.facebook.com/share/1DiXX9TUHc/',
};

export const waLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** Normalise a South African customer number ("082 123 4567") to intl format for wa.me ("27821234567"). */
export const toIntlPhoneZA = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('27')) return digits;
  if (digits.startsWith('0')) return '27' + digits.slice(1);
  return digits;
};
