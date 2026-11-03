import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { getDamage } from "@/lib/inspections/queries";
import { listEntityHistory } from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { DAMAGE_STATUS_VARIANT, SEVERITY_VARIANT, type InspectionArea } from "@/lib/inspections/constants";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoGrid } from "@/components/ui/info-grid";
import { ActivityList } from "@/components/activity/activity-list";
import { DamageDialog } from "@/components/inspections/damage-dialog";
import { DamagePhotos } from "@/components/inspections/damage-photos";
import { MaintenanceDialog } from "@/components/maintenance/maintenance-dialog";
import { RecordList } from "@/components/maintenance/record-list";
import { listMaintenance } from "@/lib/maintenance/queries";
import { todayInMadrid } from "@/lib/periods";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.damages.title };
}

export default async function DamagePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }, session] = await Promise.all([getI18n(), params, getSession()]);
  const d = await getDamage(id);
  if (!d || session.status !== "ok") notFound();
  const [history, users, repairs] = await Promise.all([listEntityHistory(["damages"], id, 30), listCompanyUsers(), listMaintenance({ view: "all", damageId: id })]);
  const today = todayInMadrid();
  const openRepair = repairs.items.some((x) => x.status === "scheduled" || x.status === "in_progress");
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const dt = t.damages;
  const f = dt.fields;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/vehicles/${d.vehicle_id}?tab=damages`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {d.vehicle} · {d.plate}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[d.severity]}>{dt.severities[d.severity]}</Badge>
            <Badge variant={DAMAGE_STATUS_VARIANT[d.status]}>{dt.statuses[d.status]}</Badge>
          </div>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {dt.categories[d.category]}
            {d.area ? ` · ${t.inspections.areas[d.area as InspectionArea]}` : ""}
          </h1>
          <p className="text-sm text-muted">{d.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <DamageDialog trigger="edit" values={{ ...d, vehicle_id: d.vehicle_id }} />
          {d.status !== "resolved" && !openRepair && (
            <MaintenanceDialog
              label={t.maintenance.scheduleRepair}
              values={{
                vehicle_id: d.vehicle_id,
                damage_id: d.id,
                maintenance_type: d.category === "mechanical" || d.category === "electrical" ? "repair" : d.category === "tyres" ? "tyres" : "bodywork",
                title: `${dt.categories[d.category]}${d.area ? ` · ${t.inspections.areas[d.area as InspectionArea]}` : ""}`,
                cost: d.estimated_cost,
                workshop: d.repair_shop,
              }}
            />
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <InfoGrid
            items={[
              { label: f.vehicle, value: <Link className="hover:underline" href={`/vehicles/${d.vehicle_id}`}>{`${d.vehicle} · ${d.plate}`}</Link> },
              { label: f.detected_at, value: formatDate(d.detected_at) },
              { label: f.mileage, value: d.mileage !== null && formatNumber(d.mileage, locale) },
              { label: f.rental, value: d.rental_id && <Link className="hover:underline" href={`/rentals/${d.rental_id}`}>{d.contract}</Link> },
              { label: f.customer, value: d.customer_id && <Link className="hover:underline" href={`/customers/${d.customer_id}`}>{d.customer}</Link> },
              { label: t.fines.tabs.accidents, value: d.accident_id && <Link className="hover:underline" href={`/fines/accidents/${d.accident_id}`}>{t.common.view}</Link> },
              { label: f.inspection, value: d.inspection_id && <Link className="hover:underline" href={`/inspections/${d.inspection_id}`}>{t.common.view}</Link> },
              { label: f.estimated_cost, value: d.estimated_cost !== null && formatCurrency(d.estimated_cost, locale) },
              { label: f.actual_cost, value: d.actual_cost !== null && formatCurrency(d.actual_cost, locale) },
              { label: f.repair_shop, value: d.repair_shop },
              { label: f.resolved_at, value: d.resolved_at && formatDate(d.resolved_at) },
              { label: f.notes, value: d.notes, wide: true },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{dt.photos}</CardTitle>
        </CardHeader>
        <CardContent>
          <DamagePhotos damageId={d.id} vehicleId={d.vehicle_id} companyId={session.profile.companyId} photos={d.photos} />
        </CardContent>
      </Card>

      {repairs.items.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold text-gold-light">{t.maintenance.linkedDamage}</h2>
          <RecordList rows={repairs.items} t={t} locale={locale} today={today} showVehicle={false} />
        </section>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t.vehicles.tabs.history}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ActivityList rows={history} names={names} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
