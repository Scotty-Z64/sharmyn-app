/**
 * A payment notice for the owner portal: a countdown to a payment deadline. It exists only while
 * PAYMENT_NOTICE_DEADLINE (an ISO date-time, e.g. 2026-10-15T23:59:59+02:00) is set, so removing that
 * setting removes the notice. It informs; it never blocks access on its own.
 */
export type PaymentNotice = { deadline: string; amount: number; reference: string; contact: string };

export function paymentNotice(): PaymentNotice | null {
  const raw = (process.env.PAYMENT_NOTICE_DEADLINE || "").trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  const amount = Number(process.env.PAYMENT_NOTICE_AMOUNT) > 0 ? Number(process.env.PAYMENT_NOTICE_AMOUNT) : 7500;
  return { deadline: new Date(t).toISOString(), amount, reference: "Sharmyn SLA", contact: "063 738 3625" };
}
