import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CarFront, ClipboardCheck, FileText, Plus, Receipt, ShieldCheck } from "lucide-react";
import { listDamages, listInspections } from "@/lib/inspections/queries";
import { DamageDialog } from "@/components/inspections/damage-dialog";
import { DamageList, InspectionList } from "@/components/inspections/lists";
import { StartInspection } from "@/components/inspections/start-inspection";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { listPolicies } from "@/lib/insurance/queries";
import { getMaintenanceFormOptions, listMaintenance, listPlans } from "@/lib/maintenance/queries";
import { getRentalOptions, listAccidents, listFines } from "@/lib/fines/queries";
import { RecordList } from "@/components/maintenance/record-list";
import { PlanList } from "@/components/maintenance/plan-list";
import { PlanDialog } from "@/components/maintenance/plan-dialog";
import { MaintenanceDialog } from "@/components/maintenance/maintenance-dialog";
import { AccidentList, FineList } from "@/components/fines/lists";
import { FineDialog } from "@/components/fines/fine-dialog";
import { AccidentDialog } from "@/components/fines/accident-dialog";
import { PolicyList } from "@/components/insurance/policy-list";
import { InsuranceDialog } from "@/components/insurance/insurance-dialog";
import { getSession } from "@/lib/auth/session";
import {
  getVehicle,
  getVehicleFinancials,
  listEntityHistory,
  listVehicleDocuments,
  listVehiclePhotos,
  listVehicleRentals,
} from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { VEHICLE_DOC_CATEGORIES, type VehicleStatus } from "@/lib/vehicles/constants";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { todayInMadrid } from "@/lib/periods";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashToast } from "@/components/ui/flash-toast";
import { InfoGrid } from "@/components/ui/info-grid";
import { TabsNav } from "@/components/ui/tabs-nav";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ActivityList } from "@/components/activity/activity-list";
import { VehicleStatusBadge } from "@/components/vehicles/status-badge";
import { VehicleHeaderActions } from "@/components/vehicles/vehicle-header-actions";
import { PhotoGallery } from "@/components/vehicles/photo-gallery";
import { VehicleDocuments } from "@/components/vehicles/vehicle-documents";
import { VehicleSale } from "@/components/assets/vehicle-sale";

const TABS = ["general", "rentals", "damages", "inspections", "maintenance", "fines", "insurance", "documents", "financial", "history"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const v = await getVehicle((await params).id);
  return { title: v ? `${v.brand} ${v.model} · ${v.plate}` : "—" };
}

export default async function VehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; created?: string; saved?: string }>;
}) {
  const [{ t, locale }, { id }, sp, session] = await Promise.all([getI18n(), params, searchParams, getSession()]);
  const v = await getVehicle(id);
  if (!v || session.status !== "ok") notFound();
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "general";
  const today = todayInMadrid();
  const vt = t.vehicles;
  const name = `${v.brand} ${v.model}`;

  return (
    <div className="space-y-6">
      {sp.created && <FlashToast message={vt.saved} param="created" />}
      {sp.saved && <FlashToast message={vt.saved} param="saved" />}

      <Link href="/vehicles" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {vt.title}
      </Link>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2 sm:size-24">
            {v.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária
              <img src={v.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-subtle">
                <CarFront className="size-8" />
              </div>
            )}
          </div>
          <div className="min-w-0 animate-fade-up">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-border-strong bg-background px-2 py-0.5 font-mono text-xs tracking-wider">{v.plate}</span>
              <VehicleStatusBadge status={v.status as VehicleStatus} />
              {v.archived_at && <Badge variant="neutral">{t.common.archived}</Badge>}
            </div>
            <h1 className="mt-1.5 truncate font-display text-2xl font-semibold tracking-tight sm:text-3xl">{name}</h1>
            <p className="text-sm text-muted">{[v.version, v.year, v.color].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!v.archived_at && (
            <Button asChild variant="outline">
              <Link href={`/rentals/new?vehicle=${v.id}`}>
                <Plus /> {t.rentals.new}
              </Link>
            </Button>
          )}
          {session.profile.role === "owner" && !v.archived_at && (
            <VehicleSale vehicleId={v.id} sold={!!v.sold_at} suggested={v.market_value === null ? null : Number(v.market_value)} />
          )}
          <VehicleHeaderActions id={v.id} name={`${name} · ${v.plate}`} status={v.status as VehicleStatus} archived={!!v.archived_at} />
        </div>
      </div>

      <TabsNav active={tab} tabs={TABS.map((k) => ({ key: k, label: vt.tabs[k], href: `/vehicles/${id}?tab=${k}` }))} />

      {tab === "general" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_24rem]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{vt.sections.identification}</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid
                  items={[
                    { label: vt.fields.brand, value: v.brand },
                    { label: vt.fields.model, value: v.model },
                    { label: vt.fields.version, value: v.version },
                    { label: vt.fields.year, value: v.year },
                    { label: vt.fields.plate, value: v.plate },
                    { label: vt.fields.vin, value: v.vin && <span className="font-mono text-xs">{v.vin}</span> },
                    { label: vt.fields.color, value: v.color },
                    { label: vt.fields.vehicle_type, value: v.vehicle_type && vt.types[v.vehicle_type as keyof typeof vt.types] },
                    { label: vt.fields.fuel, value: v.fuel && vt.fuel[v.fuel as keyof typeof vt.fuel] },
                    { label: vt.fields.transmission, value: v.transmission && vt.transmission[v.transmission as keyof typeof vt.transmission] },
                    { label: vt.fields.doors, value: v.doors },
                    { label: vt.fields.seats, value: v.seats },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{vt.photos.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <PhotoGallery photos={await listVehiclePhotos(id)} vehicleId={id} companyId={session.profile.companyId} readOnly={!!v.archived_at} />
              </CardContent>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{vt.sections.operational}</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid
                  className="sm:grid-cols-2 lg:grid-cols-2"
                  items={[
                    { label: vt.fields.current_mileage.replace(" (km)", ""), value: `${formatNumber(v.current_mileage, locale)} ${t.common.km}` },
                    { label: vt.fields.category, value: v.category },
                    { label: vt.fields.acquisition_date, value: v.acquisition_date && formatDate(v.acquisition_date) },
                    { label: vt.fields.fleet_entry_date, value: v.fleet_entry_date && formatDate(v.fleet_entry_date) },
                    { label: vt.fields.purchase_price.replace(" (€)", ""), value: v.purchase_price !== null && formatCurrency(v.purchase_price, locale) },
                    { label: vt.fields.market_value.replace(" (€)", ""), value: v.market_value !== null && formatCurrency(v.market_value, locale) },
                    ...(v.sold_at && v.sale_price !== null
                      ? [{ label: t.assets.sale.title, value: interpolate(t.assets.sale.soldOn, { date: formatDate(v.sold_at), amount: formatCurrency(Number(v.sale_price), locale) }) }]
                      : []),
                    {
                      label: vt.fields.itv_due_date,
                      value: v.itv_due_date && (
                        <span className={v.itv_due_date < today ? "text-danger" : undefined}>{formatDate(v.itv_due_date)}</span>
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{vt.sections.prices}</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid
                  className="grid-cols-3 sm:grid-cols-3 lg:grid-cols-3"
                  items={[
                    { label: vt.fields.daily_price.replace(" (€)", ""), value: v.daily_price !== null && formatCurrency(v.daily_price, locale) },
                    { label: vt.fields.weekly_price.replace(" (€)", ""), value: v.weekly_price !== null && formatCurrency(v.weekly_price, locale) },
                    { label: vt.fields.monthly_price.replace(" (€)", ""), value: v.monthly_price !== null && formatCurrency(v.monthly_price, locale) },
                  ]}
                />
              </CardContent>
            </Card>
            {v.notes && (
              <Card>
                <CardHeader>
                  <CardTitle>{vt.fields.notes}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-line text-sm text-muted">{v.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "rentals" && <RentalsTab id={id} />}
      {tab === "damages" && <DamagesTab id={id} mileage={v.current_mileage} archived={!!v.archived_at} />}
      {tab === "inspections" && <InspectionsTab id={id} archived={!!v.archived_at} />}
      {tab === "maintenance" && <MaintenanceTab id={id} archived={!!v.archived_at} />}
      {tab === "fines" && <FinesTab id={id} archived={!!v.archived_at} />}
      {tab === "insurance" && <InsuranceTab id={id} archived={!!v.archived_at} />}
      {tab === "documents" && (
        <VehicleDocuments
          vehicleId={id}
          companyId={session.profile.companyId}
          today={today}
          readOnly={!!v.archived_at}
          docs={(await listVehicleDocuments(id)).map((d) => ({
            id: d.id,
            label: d.title,
            typeLabel: vt.docs.categories[d.category as (typeof VEHICLE_DOC_CATEGORIES)[number]] ?? d.category,
            mime_type: d.mime_type,
            size_bytes: d.size_bytes,
            expires_at: d.expires_at,
            created_at: d.created_at,
          }))}
        />
      )}
      {tab === "financial" && <FinancialTab id={id} />}
      {tab === "history" && <HistoryTab id={id} />}
    </div>
  );
}

async function RentalsTab({ id }: { id: string }) {
  const [{ t, locale }, rows] = await Promise.all([getI18n(), listVehicleRentals(id)]);
  if (rows.length === 0)
    return (
      <EmptyState icon={FileText} title={t.vehicles.rentalsEmpty}>
        <Button asChild size="sm">
          <Link href={`/rentals/new?vehicle=${id}`}>
            <Plus /> {t.rentals.new}
          </Link>
        </Button>
      </EmptyState>
    );
  return (
    <Card>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/rentals/${r.id}`} className="flex flex-wrap items-center gap-3 p-4 transition hover:bg-surface-2/60">
            <span className="font-mono text-xs">{r.contract_number}</span>
            <Badge variant="neutral">{t.rentalStatus[r.status as keyof typeof t.rentalStatus] ?? r.status}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm">{r.customer}</span>
            <span className="text-xs text-muted tabular">
              {formatDateTime(r.pickup_at)} → {formatDateTime(r.return_at)}
            </span>
            <span className="text-sm font-medium tabular">{formatCurrency(r.total_amount, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function DamagesTab({ id, mileage, archived }: { id: string; mileage: number; archived: boolean }) {
  const [{ t }, res] = await Promise.all([getI18n(), listDamages({ vehicleId: id, limit: 100 })]);
  return (
    <div className="space-y-4">
      {!archived && (
        <div className="flex justify-end">
          <DamageDialog values={{ vehicle_id: id, mileage }} />
        </div>
      )}
      {res.items.length === 0 ? <EmptyState icon={AlertTriangle} title={t.damages.empty} /> : <DamageList items={res.items} showVehicle={false} />}
    </div>
  );
}

async function InspectionsTab({ id, archived }: { id: string; archived: boolean }) {
  const [{ t }, res] = await Promise.all([getI18n(), listInspections({ vehicleId: id, limit: 100 })]);
  return (
    <div className="space-y-4">
      {!archived && (
        <div className="flex justify-end">
          <StartInspection vehicleId={id} type="periodic" label={t.inspections.newPeriodic} />
        </div>
      )}
      {res.items.length === 0 ? <EmptyState icon={ClipboardCheck} title={t.inspections.empty} /> : <InspectionList items={res.items} showVehicle={false} />}
    </div>
  );
}

async function MaintenanceTab({ id, archived }: { id: string; archived: boolean }) {
  const [{ t, locale }, agenda, history, plans, opts] = await Promise.all([
    getI18n(),
    listMaintenance({ view: "agenda", vehicleId: id }),
    listMaintenance({ view: "history", vehicleId: id }),
    listPlans(id),
    getMaintenanceFormOptions(),
  ]);
  const today = todayInMadrid();
  const m = t.maintenance;
  const vPlans = opts.plans.filter((p) => p.vehicle_id === id);
  const vehicle = opts.vehicles.filter((x) => x.value === id);
  return (
    <div className="space-y-6">
      {!archived && (
        <div className="flex flex-wrap justify-end gap-2">
          <PlanDialog values={{ vehicle_id: id, last_done_mileage: vehicle[0]?.mileage }} />
          <MaintenanceDialog values={{ vehicle_id: id }} plans={vPlans} />
        </div>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold text-gold-light">{m.tabs.plans}</h2>
        {plans.length === 0 ? <p className="text-sm text-muted">{m.plans.empty}</p> : <PlanList rows={plans} showVehicle={false} readOnly={archived} />}
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold text-gold-light">{m.tabs.agenda}</h2>
        {agenda.items.length === 0 ? <p className="text-sm text-muted">{m.empty}</p> : <RecordList rows={agenda.items} t={t} locale={locale} today={today} showVehicle={false} />}
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold text-gold-light">{m.tabs.history}</h2>
        {history.items.length === 0 ? (
          <p className="text-sm text-muted">{m.historyEmpty}</p>
        ) : (
          <RecordList rows={history.items} t={t} locale={locale} today={today} showVehicle={false} />
        )}
      </section>
    </div>
  );
}

async function FinesTab({ id, archived }: { id: string; archived: boolean }) {
  const [{ t, locale }, fines, accidents, rentals] = await Promise.all([getI18n(), listFines({ vehicleId: id }), listAccidents({ vehicleId: id }), getRentalOptions()]);
  const today = todayInMadrid();
  return (
    <div className="space-y-6">
      {!archived && (
        <div className="flex flex-wrap justify-end gap-2">
          <AccidentDialog values={{ vehicle_id: id }} rentals={rentals} />
          <FineDialog values={{ vehicle_id: id }} rentals={rentals} />
        </div>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold text-gold-light">{t.fines.tabs.fines}</h2>
        {fines.length === 0 ? <p className="text-sm text-muted">{t.fines.empty}</p> : <FineList rows={fines} t={t} locale={locale} today={today} showVehicle={false} />}
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold text-gold-light">{t.fines.tabs.accidents}</h2>
        {accidents.length === 0 ? <p className="text-sm text-muted">{t.accidents.empty}</p> : <AccidentList rows={accidents} t={t} locale={locale} showVehicle={false} />}
      </section>
    </div>
  );
}

async function InsuranceTab({ id, archived }: { id: string; archived: boolean }) {
  const [{ t, locale }, rows] = await Promise.all([getI18n(), listPolicies({ vehicleId: id })]);
  const today = todayInMadrid();
  return (
    <div className="space-y-4">
      {!archived && (
        <div className="flex justify-end">
          <InsuranceDialog values={{ vehicle_id: id }} />
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t.vehicles.insuranceEmpty} />
      ) : (
        <PolicyList rows={rows} t={t} locale={locale} today={today} showVehicle={false} />
      )}
    </div>
  );
}

async function FinancialTab({ id }: { id: string }) {
  const [{ t, locale }, f] = await Promise.all([getI18n(), getVehicleFinancials(id)]);
  const vf = t.vehicles.financial;
  if (!f) return <EmptyState icon={Receipt} title={t.errors.loadFailed} />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={vf.revenue} value={formatCurrency(f.revenue, locale)} icon={Receipt} tone="gold" emphasis />
        <KpiCard label={vf.expenses} value={formatCurrency(f.expenses, locale)} icon={Receipt} tone="info" />
        <KpiCard label={vf.profit} value={formatCurrency(f.profit, locale)} icon={Receipt} tone={f.profit < 0 ? "danger" : "success"} />
        <KpiCard label={vf.investment} value={formatCurrency(f.investment, locale)} icon={Receipt} />
        <KpiCard label={vf.rentals} value={formatNumber(f.rentals, locale)} icon={FileText} />
        <KpiCard label={vf.rentedDays} value={formatNumber(f.rented_days, locale)} icon={FileText} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{vf.byCategory}</CardTitle>
        </CardHeader>
        <CardContent>
          {f.by_category.length === 0 ? (
            <p className="text-sm text-muted">{vf.empty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {f.by_category.map((c) => (
                <li key={`${c.type}-${c.category}`} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted">{t.financeCategories[c.category as keyof typeof t.financeCategories] ?? c.category}</span>
                  <span className={c.type === "income" ? "text-success tabular" : "tabular"}>
                    {c.type === "income" ? "+" : "−"} {formatCurrency(c.total, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function HistoryTab({ id }: { id: string }) {
  const [{ t }, rows, users] = await Promise.all([getI18n(), listEntityHistory(["vehicles"], id), listCompanyUsers()]);
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  if (rows.length === 0) return <EmptyState icon={FileText} title={t.activity.empty} />;
  return (
    <Card>
      <CardContent className="p-0">
        <ActivityList rows={rows} names={names} />
      </CardContent>
    </Card>
  );
}
