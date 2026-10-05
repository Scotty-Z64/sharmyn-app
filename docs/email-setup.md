# Email setup — send from orders@sharmyn.co.za (Resend)

The site sends order emails (order received, invoice, tracking, "we could not
confirm your payment") and the owner emails (new order, proof of payment). They
go through **Resend**. Until the domain is verified, Resend only lets us send a
test email to the Resend account owner, so customers do not receive anything.
Verifying `sharmyn.co.za` fixes that. The code already tries
`Sharmyn <orders@sharmyn.co.za>` and falls back safely, so **once the domain
shows "Verified" in Resend, emails start working with no code change.**

Your domain's DNS is managed at **registerdomain.net.za** (name servers
`ns1.s57.registerdomain.net.za` / `ns2.s57.registerdomain.net.za`).

## 1. Add the domain in Resend

1. Log in at https://resend.com/domains
2. **Add Domain** → enter `sharmyn.co.za` → choose a region (Ireland / `eu-west-1`
   is the closest to South Africa) → **Add**.
3. Resend now shows a table of DNS records (usually 2–4: an MX and a TXT for SPF on
   the `send` sub-domain, a long TXT for DKIM at `resend._domainkey`, and an
   optional DMARC TXT). **Keep this page open** and copy the records exactly.

## 2. Add the records at registerdomain.net.za

1. Log in to your registerdomain.net.za client area → your domain → **Manage DNS**
   (sometimes called "DNS zone" or "Name server / DNS records").
2. **Add** each record Resend lists (type, host/name, value, priority).
   - Type the host as Resend shows it, e.g. `send` or `resend._domainkey` —
     **not** `send.sharmyn.co.za` (most panels add `.sharmyn.co.za` themselves).
   - Paste TXT values exactly, with no extra spaces or line breaks.
3. **Do not change or delete the records that are already there.** Your existing
   mailboxes (info@sharmyn.co.za) depend on them:
   - the MX records pointing at `mx1/mx2/mx3.rdsa-mail.com`
   - the existing root `TXT` record starting `v=spf1 +a +mx +ip4:...`
   Resend's records live on the `send` sub-domain and `resend._domainkey`, so
   they sit alongside these without touching them.

## 3. Verify

Back in Resend click **Verify DNS records**. It usually turns green within minutes
(occasionally a few hours while DNS spreads). Status must read **Verified**.

## 4. Check the settings on Render

Render → the Sharmyn service → **Environment**. These must exist:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | your Resend API key (Resend → API Keys) |
| `OWNER_EMAIL` | Ben's email — new-order and proof-of-payment emails go here |
| `EMAIL_FROM` | *optional* — only if you want a different sender than `Sharmyn <orders@sharmyn.co.za>` |

Customers' replies go to `info@sharmyn.co.za`.

## 5. Check it works

Place a test order with an email address you can read. You should get the order
email from `orders@sharmyn.co.za`. If not, look in the Render logs for lines
starting `[email]` — they say why Resend refused it (for example "domain is not
verified"). Emails that fail are logged, never silently dropped.
