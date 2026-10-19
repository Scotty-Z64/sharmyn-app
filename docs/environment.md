# Environment settings (Render → sharmyn-app → Environment)

Everything the running site reads from its environment. Nothing here is stored in the code
or the repository. **Secrets (marked 🔒) must never be pasted into chat, email or screenshots.**
Changing a value in Render redeploys the site (about 3 minutes).

| Setting | Required? | What it does |
|---|---|---|
| `DATABASE_URL` 🔒 | Yes | The TiDB Cloud database holding products, orders, payments and logs. |
| `APP_ID`, `APP_SECRET` 🔒 | Yes | Internal app identity and signing secret. |
| `NODE_ENV` | Yes | Must be `production` on Render. |
| `ADMIN_PASSWORD` 🔒 | Yes | The owner password for `/manage`. Keep it private; change it if anyone who should not have it has seen it. |
| `OWNER_EMAIL` | Recommended | Where order, proof-of-payment, low-stock and weekly-report emails go. |
| `RESEND_API_KEY` 🔒 | Recommended | Sends emails (invoices, order updates). Without it, emails are skipped. See `email-setup.md`. |
| `EMAIL_FROM` | Optional | Sender shown on emails (needs the domain verified in Resend). |
| `WHATSAPP_PHONE_NUMBER_ID` | For automatic WhatsApp | The sending number's ID from Meta (API Setup). |
| `WHATSAPP_ACCESS_TOKEN` 🔒 | For automatic WhatsApp | A **permanent System User token** (see `whatsapp-setup.md`). A token copied from API Setup expires after 24 hours. |
| `OWNER_WHATSAPP` | For the "check the bank" alert | The phone that gets the proof-of-payment alert. Must be a verified recipient while on Meta's test number. |
| `WHATSAPP_TEMPLATE_PAYMENT` / `_RECEIVED` / `_SHIPPED` / `_ISSUE` / `_OWNER_ALERT` | Optional | Use a different Meta template name for that message (for example `sharmyn_payment_received_v2`). Defaults are the `sharmyn_…` names in `docs/whatsapp-setup.md`. |
| `PAYMENT_NOTICE_DEADLINE` | Optional | An ISO date-time (e.g. `2026-10-15T23:59:59+02:00`). While set, the owner portal shows a payment countdown banner. Delete it to remove the banner. `PAYMENT_NOTICE_AMOUNT` (default 7500) sets the amount shown. |
| `WHATSAPP_VERIFY_TOKEN` | For incoming messages | Any long random text; Meta sends it back once when the webhook is saved (see `whatsapp-setup.md` 3c). |
| `WHATSAPP_APP_SECRET` 🔒 | For incoming messages | The Meta app secret (App settings → Basic). Used to check every incoming webhook really came from Meta. |
| `WHATSAPP_TEMPLATE_LANG` | Optional | Template language code, default `en`. |
| `CRON_SECRET` 🔒 | Optional | Lets an outside scheduler trigger the weekly report (`/api/cron/weekly-report`). |
| `PHOTOROOM_API_KEY` 🔒 | Optional | Paid AI photo polish in the Studio. The free in-browser tool works without it. |
| `META_ACCESS_TOKEN`, `META_IG_USER_ID` 🔒 | Optional | Lets Studio publish a post straight to the Sharmyn Instagram account. |
| `PORT` | Set by Render | The port the site listens on. |

Removed with the online payment gateways (safe to delete from Render if still present):
`YOCO_SECRET_KEY`, `STITCH_*`, `PAYFAST_*`, `OZOW_*`, `PAYMENT_GATEWAY`, `REMOVE_BG_API_KEY`.

## Quick health checks

- `/manage → Overview → Automatic WhatsApp` — shows **Connected** or the exact reason it is not,
  and can send a test message to any number.
- Every automatic WhatsApp is logged on its order (`/manage → Orders → open an order`), and a
  failure raises a bell notification with the reason.
- The Opening Special has an on/off switch on the same Overview page.
