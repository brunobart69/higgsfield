import type { Metadata } from "next";
import { CarFront, Euro, Siren, UserCheck } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { finesOverview } from "@/lib/fines/overview";
import { getRentalOptions, getVehicleOptions, listAccidents, listFines } from "@/lib/fines/queries";
import { todayInMadrid } from "@/lib/periods";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AccidentList, FineList } from "@/components/fines/lists";
import { FineDialog } from "@/components/fines/fine-dialog";
import { AccidentDialog } from "@/components/fines/accident-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.fines.title };
}

export default async function FinesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; all?: string }> }) {
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const tab = sp.tab === "accidents" ? "accidents" : "fines";
  const all = sp.all === "1";
  const today = todayInMadrid();
  const fi = t.fines;
  const [vehicles, rentals, allFines, rows] = await Promise.all([
    getVehicleOptions(),
    getRentalOptions(),
    listFines(),
    tab === "fines" ? listFines({ open: !all, q: sp.q }) : listAccidents({ open: !all, q: sp.q }),
  ]);
  const ov = finesOverview(allFines, today);
  const base = tab === "accidents" ? "/fines?tab=accidents" : "/fines";
  const sep = base.includes("?") ? "&" : "?";
  const q = sp.q ? `${sep}q=${encodeURIComponent(sp.q)}` : "";
  const filters = tab === "fines" ? fi.filters : t.accidents.filters;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.fleet}
        title={fi.title}
        description={fi.subtitle}
        actions={tab === "fines" ? <FineDialog values={{}} vehicles={vehicles} rentals={rentals} /> : <AccidentDialog values={{}} vehicles={vehicles} rentals={rentals} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={fi.overview.open} value={formatNumber(ov.open, locale)} icon={Siren} tone={ov.open ? "warning" : "neutral"} />
        <KpiCard label={fi.overview.identifyDue} value={formatNumber(ov.identifyDue, locale)} icon={UserCheck} tone={ov.identifyDue ? "danger" : "neutral"} />
        <KpiCard label={fi.overview.toRecover} value={formatCurrency(ov.toRecover, locale)} icon={Euro} tone={ov.toRecover ? "info" : "neutral"} />
        <KpiCard label={fi.overview.paidYear} value={formatCurrency(ov.paidYear, locale)} icon={Euro} tone="gold" />
      </div>
      <TabsNav
        active={tab}
        tabs={[
          { key: "fines", label: fi.tabs.fines, href: "/fines" },
          { key: "accidents", label: fi.tabs.accidents, href: "/fines?tab=accidents" },
        ]}
      />
      <ListToolbar
        action="/fines"
        q={sp.q}
        placeholder={tab === "fines" ? fi.searchPlaceholder : t.common.search}
        searchLabel={t.common.search}
        hidden={{ tab: tab === "accidents" ? "accidents" : undefined, all: all ? "1" : undefined }}
        chips={[
          { label: filters.open, href: `${base}${q}`, active: !all },
          { label: filters.all, href: `${base}${sep}all=1${q ? q.replace("?", "&") : ""}`, active: all },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={tab === "fines" ? Siren : CarFront} title={tab === "fines" ? (all ? fi.empty : fi.noResults) : all ? t.accidents.empty : t.accidents.noResults} />
      ) : tab === "fines" ? (
        <FineList rows={rows as Awaited<ReturnType<typeof listFines>>} t={t} locale={locale} today={today} />
      ) : (
        <AccidentList rows={rows as Awaited<ReturnType<typeof listAccidents>>} t={t} locale={locale} />
      )}
    </div>
  );
}
