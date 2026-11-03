import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { getMaintenance, getMaintenanceFormOptions } from "@/lib/maintenance/queries";
import { listLinkedDocuments } from "@/lib/documents/queries";
import { listEntityHistory } from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { MAINTENANCE_STATUS_VARIANT } from "@/lib/maintenance/constants";
import { todayInMadrid } from "@/lib/periods";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoGrid } from "@/components/ui/info-grid";
import { ActivityList } from "@/components/activity/activity-list";
import { MaintenanceDialog } from "@/components/maintenance/maintenance-dialog";
import { MaintenanceActions } from "@/components/maintenance/maintenance-actions";
import { LinkedDocuments } from "@/components/documents/linked-documents";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.maintenance.title };
}

export default async function MaintenanceRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }, session] = await Promise.all([getI18n(), params, getSession()]);
  const r = await getMaintenance(id);
  if (!r || session.status !== "ok") notFound();
  const [docs, history, users, opts] = await Promise.all([
    listLinkedDocuments({ maintenanceId: id }),
    listEntityHistory(["maintenance_records"], id, 30),
    listCompanyUsers(),
    getMaintenanceFormOptions(),
  ]);
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const m = t.maintenance;
  const f = m.fields;
  const today = todayInMadrid();
  const late = r.status === "scheduled" && r.scheduled_date !== null && r.scheduled_date < today;
  const vehicleLabel = `${r.vehicle.brand} ${r.vehicle.model} · ${r.vehicle.plate}`;
  const open = r.status === "scheduled" || r.status === "in_progress";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/maintenance" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {m.title}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={MAINTENANCE_STATUS_VARIANT[r.status]}>{m.statuses[r.status]}</Badge>
            {late && <Badge variant="danger">{m.overdueDate}</Badge>}
            {r.status === "completed" && r.cost && !r.paid_at ? <Badge variant="warning">{m.unpaid}</Badge> : null}
          </div>
          <h1 className="mt-1.5 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">{r.title}</h1>
          <p className="text-sm text-muted">
            {m.types[r.maintenance_type]} ·{" "}
            <Link href={`/vehicles/${r.vehicle_id}?tab=maintenance`} className="hover:underline">
              {vehicleLabel}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {open && <MaintenanceDialog values={r} plans={opts.plans} />}
          <MaintenanceActions r={{ ...r, currentKm: r.vehicle.current_mileage }} />
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <InfoGrid
            items={[
              { label: f.vehicle, value: <Link className="hover:underline" href={`/vehicles/${r.vehicle_id}`}>{vehicleLabel}</Link> },
              { label: f.scheduled_date, value: r.scheduled_date && formatDate(r.scheduled_date) },
              { label: f.started_at, value: r.started_at && formatDate(r.started_at) },
              { label: f.completed_date, value: r.completed_date && formatDate(r.completed_date) },
              { label: f.mileage, value: r.mileage !== null && `${formatNumber(r.mileage, locale)} km` },
              { label: f.workshop, value: r.workshop },
              { label: f.cost, value: r.cost !== null && formatCurrency(r.cost, locale) },
              { label: f.invoice_number, value: r.invoice_number },
              { label: f.paid_at, value: r.paid_at && formatDate(r.paid_at) },
              { label: f.payment_method, value: r.payment_method && t.paymentMethods[r.payment_method as keyof typeof t.paymentMethods] },
              { label: f.plan, value: r.plan && <Link className="hover:underline" href="/maintenance?tab=plans">{r.plan.name}</Link> },
              {
                label: f.damage,
                value: r.damage_id && r.damage && (
                  <Link className="hover:underline" href={`/damages/${r.damage_id}`}>
                    {r.damage.description}
                  </Link>
                ),
              },
              { label: f.blocks_vehicle, value: r.blocks_vehicle ? t.common.yes : t.common.no },
              { label: f.description, value: r.description, wide: true },
              { label: f.cancel_reason, value: r.cancel_reason, wide: !!r.cancel_reason },
              { label: f.notes, value: r.notes, wide: true },
            ].filter((i) => i.label !== f.cancel_reason || r.status === "cancelled")}
          />
          <p className="mt-4 text-xs text-subtle">{m.financeNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.docs}</CardTitle>
        </CardHeader>
        <CardContent>
          <LinkedDocuments
            companyId={session.profile.companyId}
            target={{ kind: "maintenance", id: r.id, vehicleId: r.vehicle_id }}
            today={today}
            categories={["maintenance_invoice", "receipt", "invoice", "other"]}
            buttonLabel={m.uploadInvoice}
            emptyText={m.docsEmpty}
            docs={docs.map((d) => ({
              id: d.id,
              label: d.title,
              typeLabel: t.docsCenter.categories[d.category as keyof typeof t.docsCenter.categories] ?? d.category,
              mime_type: d.mime_type,
              size_bytes: d.size_bytes,
              expires_at: d.expires_at,
              created_at: d.created_at,
            }))}
          />
        </CardContent>
      </Card>

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
