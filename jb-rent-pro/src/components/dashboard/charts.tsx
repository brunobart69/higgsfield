"use client";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency, formatMonthShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthlyPoint, VehiclePerformance } from "@/lib/dashboard/queries";

const C1 = "var(--chart-1)";
const C2 = "var(--chart-2)";
const C3 = "var(--chart-3)";
const AXIS = { stroke: "var(--subtle)", fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = { stroke: "var(--border)", strokeDasharray: "0", vertical: false } as const;

type Column<T> = { label: string; render: (row: T) => string; align?: "right" };

function ChartCard<T>({
  title,
  subtitle,
  isEmpty,
  rows,
  columns,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  rows: T[];
  columns: Column<T>[];
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [table, setTable] = useState(false);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </div>
        {!isEmpty && (
          <button
            type="button"
            onClick={() => setTable((v) => !v)}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-2 hover:text-foreground"
            aria-label={table ? t.common.showChart : t.common.showTable}
            title={table ? t.common.showChart : t.common.showTable}
          >
            {table ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
          </button>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        {isEmpty ? (
          <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-border text-sm text-subtle">
            {t.common.noData}
          </div>
        ) : table ? (
          <div className="scrollbar-thin max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-subtle">
                <tr>
                  {columns.map((c) => (
                    <th key={c.label} className={cn("py-2 font-medium", c.align === "right" ? "text-right" : "text-left")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.label} className={cn("py-2 tabular", c.align === "right" ? "text-right" : "text-left")}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-64 w-full">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function TooltipBox({
  active,
  label,
  payload,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string | number }>;
  labelFormatter: (l: string) => string;
  valueFormatter: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-md border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-2xl backdrop-blur">
      <p className="mb-1.5 font-medium text-foreground">{labelFormatter(String(label ?? ""))}</p>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-medium text-foreground tabular">{valueFormatter(Number(p.value ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function legendText(value: string) {
  return <span className="text-xs text-muted">{value}</span>;
}

/** 1–3: faturamento, despesas e lucro mensais (mesma unidade → um único eixo). */
export function FinanceChart({ data }: { data: MonthlyPoint[] }) {
  const { t, locale } = useI18n();
  const c = t.dashboard.charts;
  const money = (v: number) => formatCurrency(v, locale);
  const isEmpty = data.every((d) => d.revenue === 0 && d.expenses === 0);
  return (
    <ChartCard
      title={c.financeTitle}
      subtitle={c.financeSubtitle}
      isEmpty={isEmpty}
      rows={data}
      className="xl:col-span-2"
      columns={[
        { label: c.month, render: (r) => formatMonthShort(r.month, locale) },
        { label: c.revenue, render: (r) => money(r.revenue), align: "right" },
        { label: c.expenses, render: (r) => money(r.expenses), align: "right" },
        { label: c.profit, render: (r) => money(r.profit), align: "right" },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid {...GRID} />
          <XAxis dataKey="month" {...AXIS} tickFormatter={(v: string) => formatMonthShort(v, locale)} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...AXIS} width={64} tickFormatter={(v: number) => formatCurrency(v, locale, { compact: true })} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={<TooltipBox labelFormatter={(l) => formatMonthShort(l, locale)} valueFormatter={money} />}
          />
          <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8} itemSorter={null} formatter={legendText} />
          <Bar dataKey="revenue" name={c.revenue} fill={C1} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expenses" name={c.expenses} fill={C2} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line
            dataKey="profit"
            name={c.profit}
            stroke={C3}
            strokeWidth={2}
            type="monotone"
            dot={{ r: 4, fill: C3, stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** 4–5: receita e lucro (rentabilidade) por veículo no período. */
export function VehicleChart({ data }: { data: VehiclePerformance[] }) {
  const { t, locale } = useI18n();
  const c = t.dashboard.charts;
  const money = (v: number) => formatCurrency(v, locale);
  const rows = data.slice(0, 12).map((v) => ({ ...v, name: `${v.label} · ${v.plate}` }));
  const isEmpty = rows.length === 0 || rows.every((r) => r.revenue === 0 && r.expenses === 0);
  return (
    <ChartCard
      title={c.vehicleTitle}
      subtitle={c.vehicleSubtitle}
      isEmpty={isEmpty}
      rows={rows}
      columns={[
        { label: c.vehicle, render: (r) => r.name },
        { label: c.vehicleRevenue, render: (r) => money(r.revenue), align: "right" },
        { label: c.vehicleProfit, render: (r) => money(r.profit), align: "right" },
        { label: c.occupancy, render: (r) => formatPercent(r.occupancy_pct, locale), align: "right" },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(v: number) => formatCurrency(v, locale, { compact: true })} />
          <YAxis type="category" dataKey="plate" {...AXIS} width={76} tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={
              <TooltipBox
                labelFormatter={(plate) => rows.find((r) => r.plate === plate)?.name ?? plate}
                valueFormatter={money}
              />
            }
          />
          <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8} itemSorter={null} formatter={legendText} />
          <Bar dataKey="revenue" name={c.vehicleRevenue} fill={C1} radius={[0, 4, 4, 0]} maxBarSize={14} />
          <Bar dataKey="profit" name={c.vehicleProfit} fill={C3} radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** 6: taxa de ocupação mensal da frota. */
export function OccupancyChart({ data }: { data: MonthlyPoint[] }) {
  const { t, locale } = useI18n();
  const c = t.dashboard.charts;
  const isEmpty = data.every((d) => d.occupancy_pct === 0);
  return (
    <ChartCard
      title={c.occupancyTitle}
      subtitle={c.occupancySubtitle}
      isEmpty={isEmpty}
      rows={data}
      columns={[
        { label: c.month, render: (r) => formatMonthShort(r.month, locale) },
        { label: c.occupancy, render: (r) => formatPercent(r.occupancy_pct, locale), align: "right" },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="occ" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C2} stopOpacity={0.35} />
              <stop offset="100%" stopColor={C2} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="month" {...AXIS} tickFormatter={(v: string) => formatMonthShort(v, locale)} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...AXIS} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={<TooltipBox labelFormatter={(l) => formatMonthShort(l, locale)} valueFormatter={(v) => formatPercent(v, locale)} />}
          />
          <Area dataKey="occupancy_pct" name={c.occupancy} stroke={C2} strokeWidth={2} fill="url(#occ)" type="monotone" activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** 7: evolução do patrimônio (valor estimado da frota). */
export function AssetsChart({ data }: { data: MonthlyPoint[] }) {
  const { t, locale } = useI18n();
  const c = t.dashboard.charts;
  const money = (v: number) => formatCurrency(v, locale);
  const isEmpty = data.every((d) => d.fleet_value === 0);
  return (
    <ChartCard
      title={c.assetsTitle}
      subtitle={c.assetsSubtitle}
      isEmpty={isEmpty}
      rows={data}
      columns={[
        { label: c.month, render: (r) => formatMonthShort(r.month, locale) },
        { label: c.fleetValue, render: (r) => money(r.fleet_value), align: "right" },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="assets" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C1} stopOpacity={0.4} />
              <stop offset="100%" stopColor={C1} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="month" {...AXIS} tickFormatter={(v: string) => formatMonthShort(v, locale)} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...AXIS} width={64} tickFormatter={(v: number) => formatCurrency(v, locale, { compact: true })} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={<TooltipBox labelFormatter={(l) => formatMonthShort(l, locale)} valueFormatter={money} />}
          />
          <Area dataKey="fleet_value" name={c.fleetValue} stroke={C1} strokeWidth={2} fill="url(#assets)" type="monotone" activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
