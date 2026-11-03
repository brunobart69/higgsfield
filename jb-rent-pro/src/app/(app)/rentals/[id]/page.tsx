import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CarFront, User } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getRental, getRentalFormOptions } from "@/lib/rentals/queries";
import { listEntityHistory } from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlashToast } from "@/components/ui/flash-toast";
import { InfoGrid } from "@/components/ui/info-grid";
import { ActivityList } from "@/components/activity/activity-list";
import { RentalStatusBadge } from "@/components/rentals/rental-status-badge";
import { RentalActions } from "@/components/rentals/rental-actions";
import { PaymentsPanel } from "@/components/rentals/payments-panel";
import { DepositPanel } from "@/components/rentals/deposit-panel";
import { RentalInspectionsCard } from "@/components/inspections/rental-inspections-card";
import { Badge } from "@/components/ui/badge";
import { LinkedDocuments } from "@/components/documents/linked-documents";
import { listAccidents, listFines } from "@/lib/fines/queries";
import { AccidentList, FineList } from "@/components/fines/lists";
import { FineDialog } from "@/components/fines/fine-dialog";
import { AccidentDialog } from "@/components/fines/accident-dialog";
import { getSession } from "@/lib/auth/session";
import { listLinkedDocuments } from "@/lib/documents/queries";
import { todayInMadrid } from "@/lib/periods";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await getRental((await params).id);
  return { title: r?.contract_number ?? "—" };
}

export default async function RentalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ t, locale }, { id }, sp] = await Promise.all([getI18n(), params, searchParams]);
  const r = await getRental(id);
  if (!r) notFound();
  const [opts, history, users, session, docs] = await Promise.all([
    getRentalFormOptions(),
    listEntityHistory(["rentals"], id, 30),
    listCompanyUsers(),
    getSession(),
    listLinkedDocuments({ rentalId: id }),
  ]);
  const [fines, accidents] = r.status === "reservation" || r.status === "confirmed" ? [[], []] : await Promise.all([listFines({ rentalId: id }), listAccidents({ rentalId: id })]);
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const rt = t.rentals;
  const c = r.customer;
  const customerName = (c.customer_type === "company" ? c.company_name : c.full_name) ?? "—";
  const rentalOpt = [{ value: r.id, vehicle_id: r.vehicle_id, label: `${r.contract_number} · ${customerName}` }];
  const driven = r.end_mileage !== null && r.start_mileage !== null ? r.end_mileage - r.start_mileage : null;
  const pct = (n: number | null) => (n === null ? null : `${n} %`);

  const lines: Array<[string, number]> = [
    [`${rt.summary.base} · ${rt.modes[r.pricing_mode]} · ${r.rental_days} ${t.common.days}`, r.base_amount],
    ...(r.extras_amount ? ([[rt.summary.extras, r.extras_amount]] as Array<[string, number]>) : []),
    ...(r.extra_fees_amount ? ([[rt.summary.fees, r.extra_fees_amount]] as Array<[string, number]>) : []),
    ...(r.discount_amount ? ([[rt.summary.discount, -r.discount_amount]] as Array<[string, number]>) : []),
    ...(r.excess_mileage_amount ? ([[`${rt.summary.excess} · ${formatNumber(r.excess_km, locale)} ${t.common.km}`, r.excess_mileage_amount]] as Array<[string, number]>) : []),
  ];

  return (
    <div className="space-y-6">
      {sp.saved && <FlashToast message={rt.saved} param="saved" />}
      <Link href="/rentals" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {rt.title}
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <RentalStatusBadge status={r.status} returnAt={r.return_at} />
            <Badge variant="neutral">{rt.info.signatureStatus[r.signature_status]}</Badge>
          </div>
          <h1 className="mt-1.5 font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{r.contract_number}</h1>
          <p className="text-sm text-muted tabular">
            {formatDateTime(r.pickup_at)} → {formatDateTime(r.return_at)} · {r.rental_days} {t.common.days}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RentalActions
            id={r.id}
            contractNumber={r.contract_number}
            status={r.status}
            pickupAt={r.pickup_at}
            returnAt={r.return_at}
            startMileage={r.start_mileage}
            vehicleMileage={r.vehicle.current_mileage}
            vehicleDailyPrice={r.vehicle.daily_price === null ? null : Number(r.vehicle.daily_price)}
            allowedKm={r.allowed_km}
            excessKmPrice={r.excess_km_price}
            graceMinutes={opts.defaults.grace_minutes}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Link href={`/customers/${c.id}`} className="block min-w-0">
              <Card className="h-full transition hover:border-gold/40">
                <CardContent className="flex items-start gap-3 p-5">
                  {c.customer_type === "company" ? <Building2 className="mt-0.5 size-5 text-gold" /> : <User className="mt-0.5 size-5 text-gold" />}
                  <div className="min-w-0">
                    <p className="text-xs text-subtle">{rt.sections.customer}</p>
                    <p className="truncate font-medium">{customerName}</p>
                    <p className="truncate text-xs text-muted">{[c.id_document_number ?? c.tax_id, c.phone, c.email].filter(Boolean).join(" · ")}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href={`/vehicles/${r.vehicle.id}`} className="block min-w-0">
              <Card className="h-full transition hover:border-gold/40">
                <CardContent className="flex items-start gap-3 p-5">
                  <CarFront className="mt-0.5 size-5 text-gold" />
                  <div className="min-w-0">
                    <p className="text-xs text-subtle">{rt.sections.vehicle}</p>
                    <p className="truncate font-medium">
                      {r.vehicle.brand} {r.vehicle.model}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">{r.vehicle.plate}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{rt.sections.price}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm tabular">
                {lines.map(([label, v]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted">{label}</dt>
                    <dd>{formatCurrency(v, locale)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
                  <dt>{rt.summary.total}</dt>
                  <dd className="text-gold-light">{formatCurrency(r.total_amount, locale)}</dd>
                </div>
              </dl>
              {r.extras.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted">
                  {r.extras.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3 tabular">
                      <span>
                        {e.quantity > 1 ? `${e.quantity} × ` : ""}
                        {e.name}
                      </span>
                      <span>
                        {formatCurrency(e.amount, locale)} {e.charge_type === "per_day" ? t.vehicles.perDay : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{rt.sections.mileage}</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid
                items={[
                  { label: rt.fields.mileage_policy, value: t.settings.mileage[r.mileage_policy] },
                  { label: rt.summary.included, value: r.allowed_km === null ? rt.summary.unlimited : `${formatNumber(r.allowed_km, locale)} ${t.common.km}` },
                  { label: rt.fields.excess_km_price, value: r.excess_km_price !== null && formatCurrency(r.excess_km_price, locale) },
                  { label: rt.info.startMileage, value: r.start_mileage !== null && formatNumber(r.start_mileage, locale) },
                  { label: rt.info.endMileage, value: r.end_mileage !== null && formatNumber(r.end_mileage, locale) },
                  { label: rt.info.driven, value: driven !== null && formatNumber(driven, locale) },
                  { label: rt.info.fuelStart, value: pct(r.start_fuel_level) },
                  { label: rt.info.fuelEnd, value: pct(r.end_fuel_level) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{rt.sections.contract}</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid
                items={[
                  { label: rt.fields.pickup_location, value: r.pickup_location },
                  { label: rt.fields.return_location, value: r.return_location },
                  { label: rt.fields.payment_method, value: r.payment_method && t.paymentMethods[r.payment_method as keyof typeof t.paymentMethods] },
                  { label: rt.fields.contract_locale, value: r.contract_locale === "es-ES" ? "Español" : "Português" },
                  { label: rt.info.created, value: formatDateTime(r.created_at) },
                  { label: rt.info.pickedUp, value: r.picked_up_at && formatDateTime(r.picked_up_at) },
                  { label: rt.info.returned, value: r.actual_return_at && formatDateTime(r.actual_return_at) },
                  { label: rt.info.cancelledReason, value: r.cancelled_reason, wide: true },
                  { label: rt.fields.notes, value: r.notes, wide: true },
                  { label: rt.returnDialog.notes, value: r.return_notes, wide: true },
                ].filter((i) => i.value)}
              />
            </CardContent>
          </Card>

          {(r.status === "in_progress" || r.status === "late" || r.status === "completed" || fines.length > 0 || accidents.length > 0) && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle>{t.fines.title}</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <FineDialog size="sm" values={{ vehicle_id: r.vehicle_id, rental_id: r.id }} rentals={rentalOpt} />
                  <AccidentDialog size="sm" values={{ vehicle_id: r.vehicle_id, rental_id: r.id }} rentals={rentalOpt} />
                </div>
              </CardHeader>
              {(fines.length > 0 || accidents.length > 0) && (
                <CardContent className="space-y-3">
                  {fines.length > 0 && <FineList rows={fines} t={t} locale={locale} today={todayInMadrid()} showVehicle={false} />}
                  {accidents.length > 0 && <AccidentList rows={accidents} t={t} locale={locale} showVehicle={false} />}
                </CardContent>
              )}
            </Card>
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

        <div className="space-y-6">
          <PaymentsPanel
            rentalId={r.id}
            payments={r.payments}
            total={r.total_amount}
            paid={r.paid}
            balance={r.balance}
            defaultMethod={r.payment_method}
            canAdd={r.status !== "reservation"}
          />
          {r.status !== "cancelled" && <RentalInspectionsCard rentalId={r.id} vehicleId={r.vehicle_id} status={r.status} />}
          {session.status === "ok" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {t.docsCenter.rentalDocs}
                  {r.signature_status === "signed" && <Badge variant="success">{t.docsCenter.signedOk}</Badge>}
                </CardTitle>
                <p className="text-xs text-muted">{t.docsCenter.signedContractHint}</p>
              </CardHeader>
              <CardContent>
                <LinkedDocuments
                  companyId={session.profile.companyId}
                  target={{ kind: "rental", rentalId: r.id }}
                  today={todayInMadrid()}
                  categories={["contract", "receipt", "invoice", "other"]}
                  buttonLabel={r.signature_status === "signed" ? t.docsCenter.upload : t.docsCenter.uploadSigned}
                  emptyText={t.docsCenter.empty}
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
          )}
          <DepositPanel rentalId={r.id} agreed={r.deposit_amount} deposit={r.deposit} canEdit={r.status !== "cancelled" || (r.deposit?.status === "held")} />
        </div>
      </div>
    </div>
  );
}
