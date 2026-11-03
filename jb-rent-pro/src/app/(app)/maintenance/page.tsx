import type { Metadata } from "next";
import { CalendarClock, Euro, Gauge, Wrench, AlertTriangle } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getMaintenanceFormOptions, getMaintenanceOverview, listMaintenance, listPlans, MAINTENANCE_PAGE_SIZE } from "@/lib/maintenance/queries";
import { parsePage } from "@/lib/search";
import { todayInMadrid } from "@/lib/periods";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RecordList } from "@/components/maintenance/record-list";
import { PlanList } from "@/components/maintenance/plan-list";
import { MaintenanceDialog } from "@/components/maintenance/maintenance-dialog";
import { PlanDialog } from "@/components/maintenance/plan-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.maintenance.title };
}

const TABS = ["agenda", "history", "plans"] as const;

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "agenda";
  const m = t.maintenance;
  const today = todayInMadrid();
  const page = parsePage(sp.page);
  const [overview, opts] = await Promise.all([getMaintenanceOverview(), getMaintenanceFormOptions()]);
  const records = tab === "plans" ? null : await listMaintenance({ view: tab, q: sp.q, page });
  const plans = tab === "plans" ? await listPlans() : null;
  const totalPages = records ? Math.max(1, Math.ceil(records.total / MAINTENANCE_PAGE_SIZE)) : 1;
  const href = (p: number) => `/maintenance?${new URLSearchParams({ tab, ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.fleet}
        title={m.title}
        description={m.subtitle}
        actions={
          <>
            <PlanDialog values={{}} vehicles={opts.vehicles} />
            <MaintenanceDialog values={{}} vehicles={opts.vehicles} plans={opts.plans} />
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={m.overview.inProgress} value={formatNumber(overview.inProgress, locale)} icon={Wrench} tone={overview.inProgress ? "warning" : "neutral"} />
        <KpiCard label={m.overview.scheduled} value={formatNumber(overview.scheduled, locale)} icon={CalendarClock} tone="info" />
        <KpiCard label={m.overview.overdue} value={formatNumber(overview.overdue, locale)} icon={AlertTriangle} tone={overview.overdue ? "danger" : "neutral"} />
        <KpiCard label={m.overview.dueSoon} value={formatNumber(overview.dueSoon, locale)} icon={Gauge} tone={overview.dueSoon ? "warning" : "neutral"} />
        <KpiCard label={m.overview.costYear} value={formatCurrency(overview.costYear, locale)} icon={Euro} tone="gold" className="col-span-2 lg:col-span-1" />
      </div>
      <TabsNav active={tab} tabs={TABS.map((k) => ({ key: k, label: m.tabs[k], href: k === "agenda" ? "/maintenance" : `/maintenance?tab=${k}` }))} />

      {plans ? (
        plans.length === 0 ? (
          <EmptyState icon={Gauge} title={m.plans.empty}>
            <PlanDialog values={{}} vehicles={opts.vehicles} size="sm" variant="default" />
          </EmptyState>
        ) : (
          <>
            <p className="text-xs text-subtle">{m.plans.dueHint}</p>
            <PlanList rows={plans} />
          </>
        )
      ) : (
        <>
          <ListToolbar action="/maintenance" q={sp.q} placeholder={t.common.search} searchLabel={t.common.search} hidden={{ tab: tab !== "agenda" ? tab : undefined }} />
          {records!.items.length === 0 ? (
            <EmptyState icon={Wrench} title={tab === "agenda" ? m.empty : m.historyEmpty} />
          ) : (
            <>
              <RecordList rows={records!.items} t={t} locale={locale} today={today} />
              <Pagination
                page={page}
                totalPages={totalPages}
                hrefFor={href}
                labels={{ previous: t.common.previous, next: t.common.next, page: interpolate(t.common.page, { page, total: totalPages }) }}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
