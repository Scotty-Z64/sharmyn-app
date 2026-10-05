// Sends email through Resend. Emails go out from orders@sharmyn.co.za once that
// domain is verified in Resend (see docs/email-setup.md); until then Resend
// refuses it ("domain is not verified"), so we fall back ONCE to Resend's shared
// test sender, which only ever reaches the Resend account owner. Every failure is
// logged (it used to be silent), so a missing email can be traced in the Render logs.
import { BUSINESS } from "../../src/config/business";

const SANDBOX_FROM = "Sharmyn Store <onboarding@resend.dev>";
const DEFAULT_FROM = "Sharmyn <orders@sharmyn.co.za>";

export interface EmailAttachment {
  filename: string;
  content: string; // base64
}

/** The From address: EMAIL_FROM if set (e.g. a different verified address), otherwise orders@sharmyn.co.za. */
export function senderAddress(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

async function post(apiKey: string, payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, text: res.ok ? "" : await res.text().catch(() => "") };
}

/** Fire-and-forget: never throws, never blocks an order. */
export function sendEmail(
  apiKey: string,
  to: string[],
  subject: string,
  text: string,
  attachment?: EmailAttachment | EmailAttachment[]
): void {
  void deliver(apiKey, to, subject, text, attachment).catch((e) => console.error("[email] send failed:", e));
}

/** Exported for tests; resolves once the email has been accepted or definitively failed. */
export async function deliver(
  apiKey: string,
  to: string[],
  subject: string,
  text: string,
  attachment?: EmailAttachment | EmailAttachment[]
): Promise<boolean> {
  const base: Record<string, unknown> = { to, subject, text, reply_to: BUSINESS.email };
  if (attachment) base.attachments = Array.isArray(attachment) ? attachment : [attachment];

  const from = senderAddress();
  const first = await post(apiKey, { ...base, from });
  if (first.ok) return true;

  const domainNotVerified = first.status === 403 && /not verified|verify (a|your) domain/i.test(first.text);
  if (domainNotVerified && from !== SANDBOX_FROM) {
    console.warn(`[email] ${from} is not verified in Resend yet — using the Resend test sender, which only reaches the Resend account owner`);
    const second = await post(apiKey, { ...base, from: SANDBOX_FROM });
    if (second.ok) return true;
    console.error(`[email] failed (${second.status}) to ${to.length} recipient(s): ${second.text.slice(0, 200)}`);
    return false;
  }
  console.error(`[email] failed (${first.status}) to ${to.length} recipient(s): ${first.text.slice(0, 200)}`);
  return false;
}
