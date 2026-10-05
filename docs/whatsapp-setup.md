# Automatic WhatsApp messages (Meta WhatsApp Business Cloud API)

The site can send these WhatsApp messages by itself, to the number the customer
types at checkout, with no one tapping anything:

| When | Template name | Attached | 
|---|---|---|
| Customer places an EFT order | `sharmyn_order_payment` | Invoice PDF (with the banking details) |
| Owner confirms the EFT payment | `sharmyn_payment_received` | PAID invoice PDF |
| Order marked shipped / waybill added | `sharmyn_order_shipped` | — (tracking number in the text) |
| Owner rejects a payment / proof | `sharmyn_payment_issue` | — (reason + how to resend) |

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
Hi {{1}}, thank you for your Sharmyn order {{2}} 💛 Your total is {{3}}. Please pay by EFT to {{4}} - Account name: {{5}}, Account number: {{6}}, Account type: {{7}}, Branch code: {{8}}. Use your order number as the payment reference. Your invoice is attached. Once you have paid, reply here with your proof of payment and we will confirm your order.
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` R850 · `{{4}}` FNB · `{{5}}` Sharmyn · `{{6}}` 62000000000 · `{{7}}` Cheque · `{{8}}` 250655

Header sample: any PDF (e.g. a sample invoice).

### sharmyn_payment_received — Header: **Document (PDF)**

```
Hi {{1}}, we have received your payment for order {{2}} - thank you! 💛 Your invoice is attached. We will order your items now and send your tracking number as soon as your parcel ships. You can also track your order here: {{3}}
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` https://sharmyn.co.za/track?order=K7M3QXA2

### sharmyn_order_shipped — no header

```
Hi {{1}}, your Sharmyn order {{2}} is on its way 📦 Courier tracking number: {{3}}. Track your parcel here: {{4}}
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` TCG123456789 · `{{4}}` https://sharmyn.co.za/track?order=K7M3QXA2

### sharmyn_payment_issue — no header

```
Hi {{1}}, we could not confirm your payment for order {{2}}: {{3}}. Please check it and send your proof of payment again on the Track Order page at sharmyn.co.za, or reply here. Your order is still being held for you. Need help? WhatsApp {{4}}
```

Examples: `{{1}}` Thandi · `{{2}}` K7M3QXA2 · `{{3}}` The money is not showing in our account yet · `{{4}}` +27616455670

## 3. Switch it on (Zane)

Set on Render, then trigger a manual deploy (env changes do not auto-deploy):

| Variable | Value |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | the permanent token |
| `WHATSAPP_TEMPLATE_LANG` | optional, default `en` (use `en_US` / `en_GB` if the templates were created that way) |

The banking details come from `BANK` in `src/config/business.ts` (account name,
number and type must be filled in, otherwise the banking message is skipped rather
than sent with blanks).

## 4. Notes

- Each message the system sends is billed by Meta per conversation/message
  (utility templates are cheap; see Meta's current WhatsApp pricing for South Africa).
- A customer who replies with a proof of payment opens a 24-hour window in which
  the owner can reply freely from the WhatsApp Business app / WhatsApp Manager.
- Failures (wrong number, template not yet approved) are logged on the server as
  `[whatsapp] ... failed`. The customer still sees the banking details on the
  confirmation page, and the owner can use the manual WhatsApp buttons on the order.
