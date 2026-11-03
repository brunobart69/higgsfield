import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Phone } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { getAccident, getRentalOptions } from "@/lib/fines/queries";
import { listLinkedDocuments } from "@/lib/documents/queries";
import { listEntityHistory } from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { ACCIDENT_STATUS_VARIANT } from "@/lib/fines/constants";
import { DAMAGE_STATUS_VARIANT, SEVERITY_VARIANT, type DamageCategory, type DamageSeverity, type DamageStatus } from "@/lib/inspections/constants";
import { todayInMadrid } from "@/lib/periods";
import { uuidSchema } from "@/lib/validation/common";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoGrid } from "@/components/ui/info-grid";
import { ArchiveButton } from "@/components/ui/archive-button";
import { ActivityList } from "@/components/activity/activity-list";
import { AccidentDialog } from "@/components/fines/accident-dialog";
import { AccidentPhotos } from "@/components/fines/accident-photos";
import { DamageDialog } from "@/components/inspections/damage-dialog";
import { LinkedDocuments } from "@/components/documents/linked-documents";
import { archiveAccidentAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.fines.tabs.accidents };
}

export default async function AccidentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }, session] = await Promise.all([getI18n(), params, getSession()]);
  if (!uuidSchema.safeParse(id).success) notFound();
  const a = await getAccident(id);
  if (!a || session.status !== "ok") notFound();
  const [docs, history, users, rentals] = await Promise.all([
    listLinkedDocuments({ accidentId: id }),
    listEntityHistory(["accidents"], id, 30),
    listCompanyUsers(),
    getRentalOptions(),
  ]);
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const ac = t.accidents;
  const f = ac.fields;
  const today = todayInMadrid();
  const vehicleLabel = `${a.vehicle.brand} ${a.vehicle.model} · ${a.vehicle.plate}`;
  const archived = !!a.archived_at;
  const open = a.status !== "closed" && a.status !== "rejected";
  const yes = (b: boolean) => (b ? t.common.yes : t.common.no);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/fines?tab=accidents" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {t.fines.tabs.accidents}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ACCIDENT_STATUS_VARIANT[a.status]}>{ac.statuses[a.status]}</Badge>
            <Badge variant="neutral">{ac.faults[a.fault]}</Badge>
            {a.injuries && <Badge variant="danger">{f.injuries}</Badge>}
          </div>
          <h1 className="mt-1.5 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">{a.description}</h1>
          <p className="text-sm text-muted">
            {formatDateTime(a.occurred_at)}
            {a.location && ` · ${a.location}`}
          </p>
        </div>
        {!archived && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <AccidentDialog values={a} rentals={rentals} />
            <ArchiveButton action={archiveAccidentAction.bind(null, a.id)} title={ac.confirmArchive} success={ac.archivedOk} redirectTo="/fines?tab=accidents" />
          </div>
        )}
      </div>

      {open && !a.reported_to_insurer_at && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <p>
            <span className="font-medium">{ac.unreported}</span>
            {a.policy && (
              <>
                {" "}
                · {a.policy.insurer} <span className="font-mono">{a.policy.policy_number}</span>
                {a.policy.assistance_phone && (
                  <a href={`tel:${a.policy.assistance_phone.replace(/\s/g, "")}`} className="ml-2 inline-flex items-center gap-1 text-gold-light hover:underline">
                    <Phone className="size-3.5" /> {a.policy.assistance_phone}
                  </a>
                )}
              </>
            )}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{ac.sections.event}</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              { label: f.vehicle, value: <Link className="hover:underline" href={`/vehicles/${a.vehicle_id}`}>{vehicleLabel}</Link> },
              { label: f.rental, value: a.rental_id && <Link className="hover:underline" href={`/rentals/${a.rental_id}`}>{a.contract}</Link> },
              { label: f.customer, value: a.customer_id && <Link className="hover:underline" href={`/customers/${a.customer_id}?tab=fines`}>{a.customer}</Link> },
              { label: f.third_party, value: yes(a.third_party) },
              { label: f.amicable_report, value: yes(a.amicable_report) },
              { label: f.police_report, value: a.police_report ? (a.police_report_number ?? t.common.yes) : t.common.no },
              { label: f.third_party_details, value: a.third_party_details, wide: true },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {ac.sections.insurance} · {ac.sections.values}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              {
                label: f.insurance_policy,
                value: a.insurance_policy_id && a.policy ? (
                  <Link className="hover:underline" href={`/insurance/${a.insurance_policy_id}`}>{`${a.policy.insurer} · ${a.policy.policy_number}`}</Link>
                ) : (
                  <span className="text-danger">{ac.noPolicy}</span>
                ),
              },
              { label: f.insurer_claim_number, value: a.insurer_claim_number },
              { label: f.reported_to_insurer_at, value: a.reported_to_insurer_at && formatDate(a.reported_to_insurer_at) },
              { label: f.estimated_cost, value: a.estimated_cost !== null && formatCurrency(a.estimated_cost, locale) },
              { label: f.deductible_amount, value: a.deductible_amount !== null && formatCurrency(a.deductible_amount, locale) },
              { label: f.deductible_paid_at, value: a.deductible_paid_at && formatDate(a.deductible_paid_at) },
              { label: f.insurer_payout, value: a.insurer_payout !== null && formatCurrency(a.insurer_payout, locale) },
              { label: f.insurer_payout_at, value: a.insurer_payout_at && formatDate(a.insurer_payout_at) },
              { label: f.closed_at, value: a.closed_at && formatDate(a.closed_at) },
              { label: f.notes, value: a.notes, wide: true },
            ]}
          />
          <p className="mt-4 text-xs text-subtle">{ac.financeNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{ac.sections.photos}</CardTitle>
        </CardHeader>
        <CardContent>
          <AccidentPhotos accidentId={a.id} vehicleId={a.vehicle_id} companyId={session.profile.companyId} photos={a.photos} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{ac.sections.damages}</CardTitle>
          {!archived && (
            <DamageDialog
              size="sm"
              label={ac.addDamage}
              values={{ vehicle_id: a.vehicle_id, rental_id: a.rental_id, accident_id: a.id, detected_at: a.occurred_at.slice(0, 10), category: "dent", severity: "medium" }}
            />
          )}
        </CardHeader>
        <CardContent className={a.damages.length ? "p-0" : undefined}>
          {a.damages.length === 0 ? (
            <p className="text-sm text-muted">{ac.damagesEmpty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {a.damages.map((d) => (
                <li key={d.id}>
                  <Link href={`/damages/${d.id}`} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm transition hover:bg-surface-2/60">
                    <span className="font-medium">{t.damages.categories[d.category as DamageCategory]}</span>
                    <Badge variant={SEVERITY_VARIANT[d.severity as DamageSeverity]}>{t.damages.severities[d.severity as DamageSeverity]}</Badge>
                    <Badge variant={DAMAGE_STATUS_VARIANT[d.status as DamageStatus]}>{t.damages.statuses[d.status as DamageStatus]}</Badge>
                    <span className="min-w-0 flex-1 truncate text-muted">{d.description}</span>
                    {(d.actual_cost ?? d.estimated_cost) !== null && <span className="tabular">{formatCurrency((d.actual_cost ?? d.estimated_cost)!, locale)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{ac.sections.documents}</CardTitle>
        </CardHeader>
        <CardContent>
          <LinkedDocuments
            companyId={session.profile.companyId}
            target={{ kind: "accident", id: a.id, vehicleId: a.vehicle_id }}
            today={today}
            readOnly={archived}
            categories={["accident_report", "invoice", "receipt", "other"]}
            buttonLabel={ac.uploadReport}
            emptyText={ac.docsEmpty}
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
