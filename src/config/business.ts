// Central business details for Sharmyn. Update these once and every
// touchpoint (footer, WhatsApp float, checkout, product pages) follows.
export const BUSINESS = {
  name: 'Sharmyn',
  tagline: "Women's fashion boutique",
  whatsapp: '+27616455670',
  whatsappSupport: '+27616455670', // same as main WhatsApp unless a separate support line is given
  email: 'info@sharmyn.co.za',
  website: 'https://sharmyn.co.za',
  instagram: 'https://www.instagram.com/sharmynfashion',
  facebook: 'https://www.facebook.com/share/1DiXX9TUHc/',
};

// Banking details for customers paying by EFT. Shown on the checkout
// confirmation, emailed with the order, and sent on WhatsApp. Fill in once.
// Until accountHolder + accountNumber are both set, every touchpoint falls
// back to "we'll WhatsApp you payment details" instead of showing blanks.
export const BANK = {
  bankName: 'FNB',
  accountHolder: '',
  accountNumber: '',
  accountType: '', // e.g. 'Cheque / Current'
  branchCode: '250655', // FNB universal branch code
};

// How long an order waiting for an EFT is held (stock reserved) before the
// system cancels it and releases the stock. Long enough to cover a weekend.
export const UNPAID_HOLD_HOURS = 72;

export const bankConfigured = (): boolean => !!(BANK.accountHolder && BANK.accountNumber);

/** Plain-text "how to pay by EFT" block, for WhatsApp messages and emails. The order number is the payment reference. */
export const eftInstructionsText = (orderId: string, total: number): string =>
  [
    `Please pay R${total} by EFT to:`,
    `Bank: ${BANK.bankName}`,
    `Account name: ${BANK.accountHolder}`,
    `Account number: ${BANK.accountNumber}`,
    ...(BANK.accountType ? [`Account type: ${BANK.accountType}`] : []),
    `Branch code: ${BANK.branchCode}`,
    `Reference: ${orderId}`,
    '',
    `Once paid, WhatsApp your proof of payment to ${BUSINESS.whatsapp} quoting order ${orderId} and we'll send your invoice.`,
  ].join('\n');

export const waLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** Normalise a South African customer number ("082 123 4567") to intl format for wa.me ("27821234567"). */
export const toIntlPhoneZA = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('27')) return digits;
  if (digits.startsWith('0')) return '27' + digits.slice(1);
  return digits;
};
