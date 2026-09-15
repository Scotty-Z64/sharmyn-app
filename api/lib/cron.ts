// Scheduled jobs, triggered by an external cron service hitting these over
// HTTP (Render's free tier sleeps — an in-process setInterval would silently
// miss its trigger time whenever the app is asleep; an inbound HTTP request
// wakes it reliably). Protected by CRON_SECRET, not the admin token — this
// isn't a browser session, it's a server-to-server call.
import { getSalesReport, listProducts, listOrders, listNotifications } from "../queries/shop";
import { listStudioPosts } from "../queries/studio";

export function cronConfigured(): boolean {
  return !!process.env.CRON_SECRET;
}

export function cronAuthorized(providedSecret: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && !!providedSecret && providedSecret === secret;
}

function resendConfigured(): { apiKey: string; ownerEmail: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!apiKey || !ownerEmail) return null;
  return { apiKey, ownerEmail };
}

async function sendEmail(opts: {
  apiKey: string;
  to: string[];
  subject: string;
  text: string;
  attachment?: { filename: string; content: string }; // content: base64
}): Promise<void> {
  const body: Record<string, unknown> = {
    from: "Sharmyn Store <orders@sharmyn.co.za>",
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  };
  if (opts.attachment) body.attachments = [opts.attachment];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RESEND_FAILED:${res.status}:${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/** Runs the last 7 days' sales report and emails it to the owner. Returns a status object for the HTTP response. */
export async function runWeeklyReportJob(): Promise<{ ran: boolean; reason?: string }> {
  const cfg = resendConfigured();
  if (!cfg) return { ran: false, reason: "RESEND_NOT_CONFIGURED" };

  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const report = await getSalesReport(from, to);

  const top = report.topProducts
    .slice(0, 5)
    .map((p, i) => `  ${i + 1}. ${p.name} — ${p.qtySold} sold, R${p.revenue}`)
    .join("\n");
  const byCat = report.byCategory.map((c) => `  ${c.category}: R${c.revenue} (${c.qtySold} items)`).join("\n");

  const text = [
    `Sharmyn — weekly report`,
    `${from.toDateString()} to ${to.toDateString()}`,
    ``,
    `Orders: ${report.orderCount}`,
    `Revenue: R${report.revenue}`,
    `Paid so far: R${report.paidRevenue}`,
    `Average order: R${report.avgOrderValue}`,
    ``,
    `By status:`,
    ...Object.entries(report.byStatus).map(([s, n]) => `  ${s}: ${n}`),
    ``,
    `Top products:`,
    top || "  (no sales this week)",
    ``,
    `By category:`,
    byCat || "  (no sales this week)",
  ].join("\n");

  await sendEmail({
    apiKey: cfg.apiKey,
    to: [cfg.ownerEmail],
    subject: `Sharmyn weekly report — R${report.revenue} across ${report.orderCount} orders`,
    text,
  });
  return { ran: true };
}

/** Dumps products/orders/notifications/studio_posts as JSON and emails it as an attachment — a lightweight safety net alongside TiDB's own backups. */
export async function runBackupJob(): Promise<{ ran: boolean; reason?: string }> {
  const cfg = resendConfigured();
  if (!cfg) return { ran: false, reason: "RESEND_NOT_CONFIGURED" };

  const [products, orders, notifications, studioPosts] = await Promise.all([
    listProducts(),
    listOrders(),
    listNotifications(),
    listStudioPosts(),
  ]);
  const dump = JSON.stringify({ exportedAt: new Date().toISOString(), products, orders, notifications, studioPosts }, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);

  await sendEmail({
    apiKey: cfg.apiKey,
    to: [cfg.ownerEmail],
    subject: `Sharmyn backup — ${dateStr}`,
    text: `Automated backup attached — ${products.length} products, ${orders.length} orders. Keep this somewhere safe; it's a plain JSON export, not something to reply to.`,
    attachment: { filename: `sharmyn-backup-${dateStr}.json`, content: Buffer.from(dump, "utf-8").toString("base64") },
  });
  return { ran: true };
}
