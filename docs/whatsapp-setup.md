# Automatic WhatsApp messages (Meta WhatsApp Business Cloud API)

The site can send these WhatsApp messages by itself, to the number the customer
types at checkout, with no one tapping anything:

| When | Template name | Attached | 
|---|---|---|
| Customer places an EFT order | `sharmyn_order_payment` | Invoice PDF (with the banking details) |
| Owner confirms the EFT payment | `sharmyn_payment_received` | PAID invoice PDF |
| Order marked shipped / waybill added | `sharmyn_order_shipped` | — (tracking number in the text) |
| Owner rejects a payment / proof | `sharmyn_payment_issue` | — (reason + how to resend) |
| Customer uploads proof of payment on the site | `sharmyn_owner_proof_alert` | — (sent to the OWNER: "check the bank for this reference") |

A business may only *start* a WhatsApp conversation with a message template that
Meta has approved, so the wording below must be submitted to Meta first. Until
`WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` are set on Render the code
does nothing, and the owner portal's manual WhatsApp buttons keep working.

## 1. One-time setup in Meta (owner does this)

1. Create / open a **Meta Business account** (business.facebook.com) and complete
   **Business Verification** (needed for sending to customers; takes a few days).
2. In **WhatsApp Manager**, create a **WhatsApp Business Account** and **add a phone number**.
   - The number must not already be registered on a regular WhatsApp account, *or*
     use Meta's "coexistence" option to keep the WhatsApp Business **app** on the
     same number. Check which applies to +27 61 645 5670 before starting.
3. Create the four templates below (category **Utility**, language **English**).
   Meta asks for an example value for every `{{n}}` variable; use the examples shown.
4. Create a **System User** (Business Settings → Users → System users), give it the
   WhatsApp Business account, and generate a **permanent access token** with the
   `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
5. Note the **Phone number ID** (WhatsApp Manager → API setup).

Send Zane the **Phone number ID** and the **access token** (the token is a secret —
don't post it anywhere public).

## 2. Templates to submit

Do not use line breaks inside a variable, and keep each `{{n}}` once per template.

### sharmyn_order_payment — Header: **Document (PDF)**

```
Hi {{1}}, thank you for your Sharmyn order {{2}} 💛 Your total is {{3}}. Please pay by EFT to {{4}} - Account name: {{5}}, Account number: {{6}}, Account type: {{7}}, Branch code: {{8}}. IMPORTANT: please use your order number as your payment reference so we can match your payment. Your invoice is attached. Once you have paid, upload your proof of payment on the Track Order page at sharmyn.co.za or WhatsApp us on +27 61 645 5670 and we will confirm your order.
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` R850 · `{{4}}` FNB · `{{5}}` Sharmyn · `{{6}}` 62000000000 · `{{7}}` Cheque · `{{8}}` 250655

Header sample: any PDF (e.g. a sample invoice).

### sharmyn_payment_received — Header: **Document (PDF)**

```
Hi {{1}}, we have received your payment for order {{2}} - thank you! 💛 Your invoice is attached. We will order your items now and send your tracking number as soon as your parcel ships. You can also track your order here: {{3}} Thank you for shopping with Sharmyn 💛
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` https://sharmyn.co.za/track?order=K7M3QXA2

### sharmyn_order_shipped — no header

```
Hi {{1}}, your Sharmyn order {{2}} is on its way 📦 Courier tracking number: {{3}}. Track your parcel here: {{4}} Thank you for shopping with Sharmyn 💛
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` TCG123456789 · `{{4}}` https://sharmyn.co.za/track?order=K7M3QXA2

### sharmyn_payment_issue — no header

```
Hi {{1}}, we could not confirm your payment for order {{2}}: {{3}}. Please check it and send your proof of payment again on the Track Order page at sharmyn.co.za. Your order is still being held for you. Need help? WhatsApp {{4}} and we will gladly assist.
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` The money is not showing in our account yet · `{{4}}` +27616455670

### sharmyn_owner_proof_alert — no header (sent to the owner, not the customer)

```
Sharmyn team: a customer has sent proof of payment for order {{1}}. Customer: {{2}}. Amount: {{3}}. Please check the FNB account for a payment that uses that order number as the reference. Once the money is showing, confirm or reject the order here: {{4}} Thank you.
```

Examples: `{{1}}` K7M3QXA2 · `{{2}}` Thandi Mokoena · `{{3}}` R1250 · `{{4}}` https://sharmyn.co.za/manage

It goes to `OWNER_WHATSAPP`
(any number, "082…" or "+27…") and falls back to the business number. WhatsApp cannot message
itself, so once the business number is also the sending number, set `OWNER_WHATSAPP` to the
phone Ben actually carries. While you are still on Meta's test number, add that phone as a
verified recipient in API Setup first.

## 3. Switch it on (Zane)

Set on Render, then trigger a manual deploy (env changes do not auto-deploy):

| Variable | Value |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | the permanent token |
| `OWNER_WHATSAPP` | optional: the phone that gets the "check the bank" alerts (default: the business number) |
| `WHATSAPP_TEMPLATE_LANG` | optional, default `en` (use `en_US` / `en_GB` if the templates were created that way) |

The banking details come from `BANK` in `src/config/business.ts` (account name,
number and type must be filled in, otherwise the banking message is skipped rather
than sent with blanks).

## 3b. A token that does not expire (do this before relying on it)

A token generated in API Setup is a 24-hour test token. For real use make a **System User token**:

1. Meta Business Settings → **Users → System users → Add** (a plain name such as "Orders"; Meta
   rejects names containing the business name). Role: Admin.
2. Select it → **Assign assets**: the app (full control) and the WhatsApp account (full control).
3. **Generate token** → pick the app → expiry **Never** → tick `whatsapp_business_management`
   and `whatsapp_business_messaging` → copy it once.
4. Put it in Render as `WHATSAPP_ACCESS_TOKEN`. Check `/manage → Overview → Automatic WhatsApp`.

Production number: register a real sending number (a separate SIM is simplest, because the number on
the WhatsApp Business app cannot also be the API number unless Meta's coexistence option is offered),
recreate the five templates on that account as **Utility**, add the payment method to that account,
complete Business Verification, and publish the app.

## 3c. Receiving customers' messages (the webhook)

Once the Sharmyn number runs on Meta's Cloud API, the WhatsApp phone app no longer shows its chats. Meta instead
sends every incoming message, and a receipt for every message we send, to the site:

- A **photo or PDF with the order number** (SH-XXXXXXXX), or from a number that has exactly one open order, is filed
  on that order as proof of payment. The owner gets the same alerts as for a website upload, and the customer gets a
  thank-you.
- **Every other message** is kept in `/manage → Messages`, with a bell notification and an email. The customer gets
  one short automatic reply (at most once every 6 hours).
- **Receipts** (sent, delivered, read, or why it failed) show next to each automatic message on the order.

Set up (once the number is registered):

1. In Render add two settings: `WHATSAPP_VERIFY_TOKEN` (any long random text you invent) and `WHATSAPP_APP_SECRET`
   (Meta developer app → **App settings → Basic → App secret** → Show). Save and wait for the deploy to go Live.
2. Meta developer app → **WhatsApp → Configuration** (under Use cases → Customize) → **Webhook** → Edit:
   - Callback URL: `https://sharmyn.co.za/api/webhooks/whatsapp`
   - Verify token: the same text as `WHATSAPP_VERIFY_TOKEN`
   - Click **Verify and save**.
3. Under **Webhook fields** turn on **messages** (Subscribe).
4. Send a WhatsApp from a phone to the Sharmyn number. It should appear under `/manage → Messages` within seconds.

Meta only delivers real customers' messages once the app is **published**; until then only test messages from the
developer dashboard arrive.

## 4. Notes

- Every send is logged per order and failures raise a bell notification (see `environment.md`).

- Each message the system sends is billed by Meta per conversation/message
  (utility templates are cheap; see Meta's current WhatsApp pricing for South Africa).
- A customer who replies with a proof of payment opens a 24-hour window in which
  the owner can reply freely from the WhatsApp Business app / WhatsApp Manager.
- Failures (wrong number, template not yet approved) are logged on the server as
  `[whatsapp] ... failed`. The customer still sees the banking details on the
  confirmation page, and the owner can use the manual WhatsApp buttons on the order.
