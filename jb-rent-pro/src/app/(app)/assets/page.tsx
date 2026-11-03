import type { Metadata } from "next";
import Link from "next/link";
import { Car, Info, PiggyBank, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getFleetRoi, getMonthlySeries, type RoiRow } from "@/lib/finance/queries";
import { vehicleReturns } from "@/lib/finance/constants";
import { addMonths, endOfMonth, todayInMadrid } from "@/lib/periods";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AssetsChart } from "@/components/dashboard/charts";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.assets.title };
}

const pct = (v: number | null, locale: Locale) => (v === null ? "—" : `${v.toLocaleString(locale, { maximumFractionDigits: 1 })} %`);
const sum = (rows: number[]) => rows.reduce((a, v) => a + Math.round(v * 100), 0) / 100;

function Table({ rows, t, locale, sold }: { rows: RoiRow[]; t: Dictionary; locale: Locale; sold: boolean }) {
  const a = t.assets;
  const h = a.table;
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="text-xs text-subtle">
          <tr className="border-b border-border">
            <th className="px-5 py-2.5 text-left font-medium">{h.vehicle}</th>
            <th className="px-3 py-2.5 text-right font-medium">{h.purchase}</th>
            <th className="px-3 py-2.5 text-right font-medium">{sold ? a.sale.sale_price.replace(" (€)", "") : h.value}</th>
            <th className="px-3 py-2.5 text-right font-medium">{h.revenue}</th>
            <th className="px-3 py-2.5 text-right font-medium">{h.expenses}</th>
            <th className="px-3 py-2.5 text-right font-medium">{h.profit}</th>
            <th className="px-3 py-2.5 text-right font-medium">{h.roi}</th>
            <th className="px-3 py-2.5 text-right font-medium">{h.totalReturn}</th>
            <th className="px-3 py-2.5 text-right font-medium">{sold ? a.soldGain : h.payback}</th>
            <th className="px-5 py-2.5 text-right font-medium">{h.occupancy}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular">
          {rows.map((r) => {
            const x = vehicleReturns(r);
            const occ = r.available_days > 0 ? Math.round((r.rented_days / r.available_days) * 1000) / 10 : null;
            const gain = r.sale_price !== null && r.purchase_price !== null ? r.sale_price - r.purchase_price : null;
            return (
              <tr key={r.vehicle_id} className="hover:bg-surface-2/50">
                <td className="px-5 py-3">
                  <Link href={`/vehicles/${r.vehicle_id}?tab=financial`} className="hover:underline">
                    <span className="block font-medium">{r.label}</span>
                    <span className="font-mono text-xs text-muted">{r.plate}</span>
                  </Link>
                  {sold && r.sold_at && <span className="block text-xs text-subtle">{formatDate(r.sold_at)}</span>}
                </td>
                <td className="px-3 py-3 text-right">{r.purchase_price !== null ? formatCurrency(r.purchase_price, locale) : <span className="text-xs text-subtle">{a.noPurchase}</span>}</td>
                <td className="px-3 py-3 text-right">
                  {formatCurrency(x.value, locale)}
                  {!sold && x.depreciation > 0 && <span className="block text-xs text-subtle">−{formatCurrency(x.depreciation, locale)}</span>}
                </td>
                <td className="px-3 py-3 text-right">{formatCurrency(r.revenue, locale)}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(r.expenses, locale)}</td>
                <td className={cn("px-3 py-3 text-right font-medium", r.profit < 0 ? "text-danger" : "text-success")}>
                  {formatCurrency(r.profit, locale)}
                  <span className="block text-xs font-normal text-subtle">
                    {formatCurrency(x.monthlyProfit, locale)} / {h.monthly.split("/")[1]?.trim() ?? "mês"}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">{pct(x.roi, locale)}</td>
                <td className={cn("px-3 py-3 text-right", (x.totalReturn ?? 0) < 0 && "text-danger")}>{pct(x.totalReturn, locale)}</td>
                <td className="px-3 py-3 text-right">
                  {sold
                    ? gain === null
                      ? "—"
                      : <span className={gain < 0 ? "text-danger" : "text-success"}>{formatCurrency(gain, locale)}</span>
                    : x.paybackMonths === 0
                      ? <span className="text-success">{a.paybackDone}</span>
                      : x.paybackMonths === null
                        ? a.paybackUnknown
                        : interpolate(a.paybackMonths, { n: x.paybackMonths })}
                </td>
                <td className="px-5 py-3 text-right">{occ === null ? "—" : `${occ.toLocaleString(locale)} %`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function AssetsPage() {
  const { t, locale } = await getI18n();
  const today = todayInMadrid();
  const [rows, monthly] = await Promise.all([getFleetRoi(), getMonthlySeries(addMonths(today, -11), endOfMonth(today))]);
  const a = t.assets;
  const active = rows.filter((r) => r.status !== "sold");
  const sold = rows.filter((r) => r.status === "sold");
  const value = sum(active.map((r) => r.current_value ?? 0));
  const invested = sum(active.map((r) => r.purchase_price ?? 0));
  const profit = sum(rows.map((r) => r.profit));
  const depreciation = sum(active.map((r) => (r.purchase_price ?? 0) - (r.current_value ?? r.purchase_price ?? 0)));
  const allInvested = sum(rows.map((r) => r.purchase_price ?? 0));
  const allValue = sum(rows.map((r) => r.current_value ?? 0));
  const totalReturn = allInvested > 0 ? Math.round(((profit + allValue - allInvested) / allInvested) * 1000) / 10 : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.finance} title={a.title} description={a.subtitle} />
      {rows.length === 0 ? (
        <EmptyState icon={Car} title={a.empty} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label={a.kpis.fleetValue} value={formatCurrency(value, locale)} icon={PiggyBank} tone="gold" emphasis />
            <KpiCard label={a.kpis.invested} value={formatCurrency(invested, locale)} icon={Wallet} tone="info" />
            <KpiCard label={a.kpis.depreciation} value={formatCurrency(depreciation, locale)} icon={TrendingDown} tone={depreciation > 0 ? "warning" : "neutral"} />
            <KpiCard label={a.kpis.profit} value={formatCurrency(profit, locale)} icon={TrendingUp} tone={profit < 0 ? "danger" : "success"} />
            <KpiCard label={a.kpis.totalReturn} value={pct(totalReturn, locale)} icon={TrendingUp} className="col-span-2 lg:col-span-1" />
          </div>
          <AssetsChart data={monthly} />
          <Card>
            <CardHeader>
              <CardTitle>{a.active}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <Table rows={active} t={t} locale={locale} sold={false} />
            </CardContent>
          </Card>
          {sold.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{a.sold}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <Table rows={sold} t={t} locale={locale} sold />
              </CardContent>
            </Card>
          )}
          <p className="flex items-start gap-2 text-xs text-subtle">
            <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /> {a.explain}
          </p>
        </>
      )}
    </div>
  );
}
