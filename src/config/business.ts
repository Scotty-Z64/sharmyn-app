// Central business details for Sharmyn. Update these once and every
// touchpoint (footer, WhatsApp float, checkout, product pages) follows.
export const BUSINESS = {
  name: 'Sharmyn',
  tagline: "Women's fashion boutique",
  whatsapp: '+27000000000', // TODO: Ben's business WhatsApp
  whatsappSupport: '+27000000000', // TODO: support line
  email: 'hello@sharmyn.co.za', // TODO
  instagram: 'https://instagram.com/sharmyn', // TODO
  facebook: 'https://facebook.com/sharmyn', // TODO
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
