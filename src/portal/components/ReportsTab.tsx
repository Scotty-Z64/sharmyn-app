import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, TrendingUp } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import { formatPrice, CATEGORIES } from '@/portal/lib/utils-shop';

type RangeKey = '7d' | '30d' | '90d' | 'month' | 'custom';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];

function toDayStart(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function toDayEnd(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function isoDateInput(d: Date): string { return d.toISOString().slice(0, 10); }

function computeRange(key: RangeKey, customFrom: string, customTo: string): { from: Date; to: Date } {
  const now = new Date();
  if (key === '7d') return { from: toDayStart(new Date(now.getTime() - 6 * 86400000)), to: toDayEnd(now) };
  if (key === '30d') return { from: toDayStart(new Date(now.getTime() - 29 * 86400000)), to: toDayEnd(now) };
  if (key === '90d') return { from: toDayStart(new Date(now.getTime() - 89 * 86400000)), to: toDayEnd(now) };
  if (key === 'month') return { from: toDayStart(new Date(now.getFullYear(), now.getMonth(), 1)), to: toDayEnd(now) };
  return { from: toDayStart(new Date(customFrom || now)), to: toDayEnd(new Date(customTo || now)) };
}

function catLabel(c: string): string { return CATEGORIES.find((x) => x.key === c)?.label ?? c; }

function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','))
    .join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsTab() {
  const { token, toast } = usePortal();
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d');
  const [customFrom, setCustomFrom] = useState(isoDateInput(new Date(Date.now() - 29 * 86400000)));
  const [customTo, setCustomTo] = useState(isoDateInput(new Date()));

  const { from, to } = useMemo(() => computeRange(rangeKey, customFrom, customTo), [rangeKey, customFrom, customTo]);

  const reportQuery = trpc.shop.salesReport.useQuery({ token, from: from.toISOString(), to: to.toISOString() });
  const report = reportQuery.data;

  const exportCsv = () => {
    if (!report) return;
    const rows: (string | number)[][] = [
      ['Sharmyn sales report'],
      ['From', from.toDateString()],
      ['To', to.toDateString()],
      [],
      ['Orders', report.orderCount],
      ['Revenue', report.revenue],
      ['Paid revenue', report.paidRevenue],
      ['Average order value', report.avgOrderValue],
      [],
      ['By status'],
      ...Object.entries(report.byStatus).map(([s, n]) => [s, n]),
      [],
      ['Top products', 'Qty sold', 'Revenue'],
      ...report.topProducts.map((p) => [p.name, p.qtySold, p.revenue]),
      [],
      ['Category', 'Qty sold', 'Revenue'],
      ...report.byCategory.map((c) => [catLabel(c.category), c.qtySold, c.revenue]),
    ];
    downloadCsv(`sharmyn-report-${isoDateInput(from)}-to-${isoDateInput(to)}.csv`, toCsv(rows));
    toast('Report downloaded');
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 rounded-full bg-blush-100 overflow-x-auto no-scrollbar">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRangeKey(r.key)}
              className={`h-10 px-3.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap transition-all ${
                rangeKey === r.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}>
              {r.label}
            </button>
          ))}
        </div>
        <button onClick={exportCsv} disabled={!report}
          className="ml-auto h-10 px-4 rounded-full border border-gold-500 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.08em] flex items-center gap-1.5 hover:bg-[#FBF3E2] active:scale-[0.97] transition disabled:opacity-40">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {rangeKey === 'custom' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="h-10 px-3 rounded-full border border-blush-100 bg-white text-sm" />
          <span className="text-ink-500 text-sm">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="h-10 px-3 rounded-full border border-blush-100 bg-white text-sm" />
        </div>
      )}

      {reportQuery.isLoading ? (
        <p className="mt-8 text-sm text-ink-500 text-center">Crunching the numbers…</p>
      ) : !report ? (
        <p className="mt-8 text-sm text-ink-500 text-center">Could not load the report — try again.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Orders', value: report.orderCount },
              { label: 'Revenue', value: formatPrice(report.revenue) },
              { label: 'Paid so far', value: formatPrice(report.paidRevenue) },
              { label: 'Avg order', value: formatPrice(report.avgOrderValue) },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl p-4 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500">{s.label}</p>
                <p className="font-display text-2xl font-semibold text-ink-900 mt-1">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
              <h3 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
                <TrendingUp size={17} className="text-rose-500" /> Top products
              </h3>
              {report.topProducts.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">No sales in this range yet.</p>
              ) : (
                <div className="mt-3 divide-y divide-blush-100">
                  {report.topProducts.slice(0, 8).map((p, i) => (
                    <div key={p.productId} className="py-2.5 flex items-center gap-3">
                      <span className="w-6 text-center text-[11px] font-semibold text-ink-500">{i + 1}</span>
                      <span className="flex-1 min-w-0 text-sm text-ink-900 truncate">{p.name}</span>
                      <span className="text-[11px] text-ink-500 shrink-0">{p.qtySold} sold</span>
                      <span className="font-display text-sm font-semibold text-ink-900 shrink-0 w-20 text-right">{formatPrice(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
              <h3 className="font-display text-lg font-semibold text-ink-900">By category</h3>
              {report.byCategory.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">No sales in this range yet.</p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {report.byCategory.map((c) => {
                    const pct = report.revenue > 0 ? Math.round((c.revenue / report.revenue) * 100) : 0;
                    return (
                      <div key={c.category}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-ink-900">{catLabel(c.category)}</span>
                          <span className="text-ink-500 text-[11px]">{formatPrice(c.revenue)} · {pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-blush-100 overflow-hidden">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                            className="h-full rounded-full bg-gold-400" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 bg-white rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
            <h3 className="font-display text-lg font-semibold text-ink-900">Orders by status</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(report.byStatus).map(([s, n]) => (
                <span key={s} className="h-9 px-3.5 rounded-full bg-blush-50 border border-blush-100 text-[12px] text-ink-900 flex items-center gap-1.5">
                  <span className="capitalize">{s}</span>
                  <span className="font-semibold text-gold-500">{n}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
