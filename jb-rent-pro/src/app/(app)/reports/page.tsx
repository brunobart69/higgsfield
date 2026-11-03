import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, FileSpreadsheet, Info } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { buildReport } from "@/lib/reports/definitions";
import { FINANCE_REPORTS, REPORT_KEYS, SNAPSHOT_REPORTS, type ReportKey } from "@/lib/reports/keys";
import { isReportKey, parseReportParams } from "@/lib/reports/params";
import { displayCell } from "@/lib/reports/pdf";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.reports.title };
}

const PREVIEW_ROWS = 50;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ report?: string; period?: string; from?: string; to?: string; basis?: string }> }) {
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const r = t.reports;
  const key: ReportKey = isReportKey(sp.report) ? sp.report : "pnl";
  const { period, basis } = parseReportParams(sp);
  const doc = await buildReport(key, { from: period.from, to: period.to, basis }, t);
  const qs = new URLSearchParams({ period: period.key, ...(period.key === "custom" ? { from: period.from, to: period.to } : {}), ...(basis === "cash" ? { basis } : {}) });
  const hrefFor = (k: ReportKey) => `/reports?${new URLSearchParams({ report: k, ...Object.fromEntries(qs) })}`;
  const snapshot = SNAPSHOT_REPORTS.includes(key);
  const chip = (active: boolean) =>
    cn(
      "flex flex-col gap-0.5 rounded-lg border p-3 text-left transition",
      active ? "border-gold/60 bg-gold/10" : "border-border bg-surface-2/50 hover:border-border-strong",
    );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.finance} title={r.title} description={r.subtitle} />
      <div className="space-y-4">
        {(["finance", "operations"] as const).map((g) => (
          <div key={g}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-subtle">{r.groups[g]}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {REPORT_KEYS.filter((k) => (g === "finance") === FINANCE_REPORTS.includes(k)).map((k) => (
                <Link key={k} href={hrefFor(k)} aria-current={k === key ? "true" : undefined} className={chip(k === key)} scroll={false}>
                  <span className={cn("text-sm font-medium", k === key && "text-gold-light")}>{r.catalog[k].title}</span>
                  <span className="text-xs text-muted">{r.catalog[k].desc}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!snapshot && <PeriodFilter value={period.key} from={period.from} to={period.to} keep={{ report: key, basis: basis === "cash" ? "cash" : undefined }} />}
      {key === "pnl" && (
        <div className="flex gap-1.5">
          {(["accrual", "cash"] as const).map((b) => {
            const q = new URLSearchParams({ report: key, period: period.key, ...(period.key === "custom" ? { from: period.from, to: period.to } : {}), ...(b === "cash" ? { basis: b } : {}) });
            return (
              <Link
                key={b}
                href={`/reports?${q}`}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium",
                  basis === b ? "border-gold/50 bg-gold/15 text-gold-light" : "border-border bg-surface-2 text-muted hover:text-foreground",
                )}
              >
                {t.financial.basis[b]}
              </Link>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{doc.title}</CardTitle>
            <p className="mt-1 text-xs text-muted">
              {doc.subtitle} · {doc.period}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/reports/${key}?${qs}&format=csv`}>
                <FileSpreadsheet /> {r.csv}
              </a>
            </Button>
            <Button asChild size="sm">
              <a href={`/api/reports/${key}?${qs}&format=pdf`} target="_blank" rel="noopener noreferrer">
                <FileDown /> {r.pdf}
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {doc.sections.map((sec) => (
            <section key={sec.title} className="space-y-2">
              {doc.sections.length > 1 && <h3 className="text-xs font-semibold uppercase tracking-wider text-gold-light">{sec.title}</h3>}
              <div className="scrollbar-thin -mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-max text-xs">
                  <thead className="text-subtle">
                    <tr className="border-b border-border">
                      {sec.columns.map((c) => (
                        <th key={c.key} className={cn("whitespace-nowrap px-2 py-2 font-medium", c.type === "text" || c.type === "date" || c.type === "datetime" ? "text-left" : "text-right")}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular">
                    {sec.rows.length === 0 && (
                      <tr>
                        <td colSpan={sec.columns.length} className="px-2 py-4 text-center text-muted">
                          {sec.empty ?? r.empty}
                        </td>
                      </tr>
                    )}
                    {sec.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                      <tr key={i}>
                        {sec.columns.map((c) => (
                          <td key={c.key} className={cn("max-w-72 truncate whitespace-nowrap px-2 py-1.5", c.type === "text" || c.type === "date" || c.type === "datetime" ? "text-left" : "text-right")}>
                            {displayCell(row[c.key] ?? null, c.type, locale)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {sec.totals && (
                      <tr className="border-t-2 border-gold/40 font-semibold">
                        {sec.columns.map((c) => (
                          <td key={c.key} className={cn("whitespace-nowrap px-2 py-2", c.type === "text" || c.type === "date" || c.type === "datetime" ? "text-left" : "text-right")}>
                            {sec.totals![c.key] === undefined || sec.totals![c.key] === null ? "" : displayCell(sec.totals![c.key]!, c.type, locale)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {sec.rows.length > PREVIEW_ROWS && <p className="text-xs text-subtle">{interpolate(r.rowsLimit, { n: PREVIEW_ROWS })}</p>}
            </section>
          ))}
          {doc.notes.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-4 text-xs text-subtle">
              {doc.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="flex items-start gap-2 text-xs text-subtle">
        <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /> {r.exportHint}
      </p>
    </div>
  );
}
