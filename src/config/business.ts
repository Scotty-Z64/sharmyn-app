// Central business details for Sharmyn. Update these once and every
// touchpoint (footer, WhatsApp float, checkout, product pages) follows.
export const BUSINESS = {
  name: 'Sharmyn',
  tagline: "Women's fashion boutique",
  whatsapp: '+27000000000', // TODO: Ben's business WhatsApp
  whatsappSupport: '+27000000000', // TODO: support line
  email: 'hello@sharmyn.co.za', // TODO
  instagram: 'https://instagram.com/sharmyn', // TODO
};

export const waLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
