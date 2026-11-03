import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";
import { getFine, getRentalOptions } from "@/lib/fines/queries";
import { listLinkedDocuments } from "@/lib/documents/queries";
import { listEntityHistory } from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { daysUntil, FINE_STATUS_VARIANT } from "@/lib/fines/constants";
import { todayInMadrid } from "@/lib/periods";
import { uuidSchema } from "@/lib/validation/common";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoGrid } from "@/components/ui/info-grid";
import { ArchiveButton } from "@/components/ui/archive-button";
import { ActivityList } from "@/components/activity/activity-list";
import { FineDialog } from "@/components/fines/fine-dialog";
import { LinkedDocuments } from "@/components/documents/linked-documents";
import { archiveFineAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.fines.tabs.fines };
}

export default async function FinePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }, session] = await Promise.all([getI18n(), params, getSession()]);
  if (!uuidSchema.safeParse(id).success) notFound();
  const r = await getFine(id);
  if (!r || session.status !== "ok") notFound();
  const [docs, history, users, rentals] = await Promise.all([
    listLinkedDocuments({ fineId: id }),
    listEntityHistory(["traffic_fines"], id, 30),
    listCompanyUsers(),
    getRentalOptions(),
  ]);
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const fi = t.fines;
  const f = fi.fields;
  const today = todayInMadrid();
  const vehicleLabel = `${r.vehicle.brand} ${r.vehicle.model} · ${r.vehicle.plate}`;
  const dl = (d: string | null) => {
    const n = daysUntil(d, today);
    if (!d || n === null) return null;
    return (
      <span className={n < 0 ? "text-danger" : n <= 7 ? "text-warning" : undefined}>
        {formatDate(d)}
        {r.status === "pending" && ` · ${n < 0 ? fi.overdue : interpolate(fi.daysLeft, { n })}`}
      </span>
    );
  };
  const archived = !!r.archived_at;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/fines" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {fi.title}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={FINE_STATUS_VARIANT[r.status]}>{fi.statuses[r.status]}</Badge>
            {r.status !== "cancelled" && r.recharge_amount && !r.recharge_paid_at ? <Badge variant="warning">{fi.toRecover}</Badge> : null}
          </div>
          <h1 className="mt-1.5 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">{r.infraction}</h1>
          <p className="text-sm text-muted">
            {r.authority}
            {r.reference && <span className="font-mono"> · {r.reference}</span>} · {formatCurrency(r.amount, locale)}
          </p>
        </div>
        {!archived && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <FineDialog values={r} rentals={rentals} />
            <ArchiveButton action={archiveFineAction.bind(null, r.id)} title={fi.confirmArchive} description={fi.confirmArchiveBody} success={fi.archivedOk} redirectTo="/fines" />
          </div>
        )}
      </div>

      {!r.rental_id && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-4 text-sm text-muted">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {fi.noRental}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{fi.sections.infraction}</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              { label: f.vehicle, value: <Link className="hover:underline" href={`/vehicles/${r.vehicle_id}`}>{vehicleLabel}</Link> },
              { label: f.infraction_date, value: formatDateTime(r.infraction_at) },
              { label: f.location, value: r.location },
              { label: f.points, value: r.points },
              { label: f.rental, value: r.rental_id && <Link className="hover:underline" href={`/rentals/${r.rental_id}`}>{r.contract}</Link> },
              { label: f.customer, value: r.customer_id && <Link className="hover:underline" href={`/customers/${r.customer_id}?tab=fines`}>{r.customer}</Link> },
              { label: f.notified_at, value: r.notified_at && formatDate(r.notified_at) },
              { label: f.identification_deadline, value: dl(r.identification_deadline) },
              { label: f.payment_deadline, value: dl(r.payment_deadline) },
              { label: f.identified_at, value: r.identified_at && formatDate(r.identified_at) },
            ]}
          />
          <p className="mt-4 text-xs text-subtle">{fi.deadlineNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{fi.sections.payment}</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              { label: f.paid_at, value: r.paid_at && formatDate(r.paid_at) },
              { label: f.paid_amount, value: r.paid_amount !== null && formatCurrency(r.paid_amount, locale) },
              { label: f.payment_method, value: r.payment_method && t.paymentMethods[r.payment_method as keyof typeof t.paymentMethods] },
              { label: f.recharge_amount, value: r.recharge_amount !== null && formatCurrency(r.recharge_amount, locale) },
              { label: f.recharge_paid_at, value: r.recharge_paid_at && formatDate(r.recharge_paid_at) },
              { label: f.notes, value: r.notes, wide: true },
            ]}
          />
          <p className="mt-4 text-xs text-subtle">{fi.financeNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{fi.sections.documents}</CardTitle>
        </CardHeader>
        <CardContent>
          <LinkedDocuments
            companyId={session.profile.companyId}
            target={{ kind: "fine", id: r.id, vehicleId: r.vehicle_id }}
            today={today}
            readOnly={archived}
            categories={["fine_notice", "receipt", "other"]}
            buttonLabel={fi.uploadNotice}
            emptyText={fi.docsEmpty}
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
