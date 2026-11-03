import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, FileText, Plus, ShieldCheck, User, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listCustomerDeposits } from "@/lib/rentals/queries";
import { listDamages } from "@/lib/inspections/queries";
import { DamageList } from "@/components/inspections/lists";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";
import {
  customerName,
  getCustomer,
  getCustomerSummary,
  listCustomerDocuments,
  listCustomerPayments,
  listCustomerRentals,
} from "@/lib/customers/queries";
import { listEntityHistory } from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { CUSTOMER_DOC_TYPES } from "@/lib/customers/constants";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { addDays, todayInMadrid } from "@/lib/periods";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashToast } from "@/components/ui/flash-toast";
import { InfoGrid } from "@/components/ui/info-grid";
import { PhaseNotice } from "@/components/ui/phase-notice";
import { TabsNav } from "@/components/ui/tabs-nav";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ActivityList } from "@/components/activity/activity-list";
import { AnonymizeButton, CustomerHeaderActions } from "@/components/customers/customer-actions";
import { CustomerDocuments } from "@/components/customers/customer-documents";

const TABS = ["data", "rentals", "payments", "deposits", "fines", "damages", "documents", "history"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const c = await getCustomer((await params).id);
  return { title: c ? customerName(c) : "—" };
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; created?: string; saved?: string }>;
}) {
  const [{ t, locale }, { id }, sp, session] = await Promise.all([getI18n(), params, searchParams, getSession()]);
  const c = await getCustomer(id);
  if (!c || session.status !== "ok") notFound();
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "data";
  const ct = t.customers;
  const f = ct.fields;
  const today = todayInMadrid();
  const name = customerName(c);
  const isOwner = session.profile.role === "owner";
  const Icon = c.customer_type === "company" ? Building2 : User;
  const summary = await getCustomerSummary(id);
  const licenceExpired = c.driving_licence_expiry !== null && c.driving_licence_expiry < today;
  const licenceSoon = !licenceExpired && c.driving_licence_expiry !== null && c.driving_licence_expiry <= addDays(today, 30);
  const billing = c.billing_details ?? {};

  return (
    <div className="space-y-6">
      {sp.created && <FlashToast message={ct.saved} param="created" />}
      {sp.saved && <FlashToast message={ct.saved} param="saved" />}
      <Link href="/customers" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {ct.title}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 animate-fade-up">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{ct.types[c.customer_type]}</Badge>
              {c.archived_at && !c.anonymized_at && <Badge variant="neutral">{t.common.archived}</Badge>}
              {c.anonymized_at && <Badge variant="neutral">{interpolate(ct.gdpr.anonymized, { date: formatDate(c.anonymized_at) })}</Badge>}
              {licenceExpired && <Badge variant="danger">{ct.licenceExpired}</Badge>}
              {licenceSoon && <Badge variant="warning">{ct.licenceExpiresSoon}</Badge>}
            </div>
            <h1 className="mt-1.5 truncate font-display text-2xl font-semibold tracking-tight sm:text-3xl">{name}</h1>
            <p className="truncate text-sm text-muted">{[c.id_document_number ?? c.tax_id, c.phone, c.email].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!c.archived_at && (
            <Button asChild variant="outline">
              <Link href={`/rentals/new?customer=${id}`}>
                <Plus /> {t.rentals.new}
              </Link>
            </Button>
          )}
          <CustomerHeaderActions id={id} name={name} archived={!!c.archived_at} anonymized={!!c.anonymized_at} />
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={ct.summary.rentals} value={formatNumber(summary.rentals, locale)} icon={FileText} tone="gold" />
          <KpiCard label={ct.summary.active} value={formatNumber(summary.active, locale)} icon={FileText} tone="info" />
          <KpiCard label={ct.summary.billed} value={formatCurrency(summary.billed, locale)} icon={Wallet} />
          <KpiCard label={ct.summary.paid} value={formatCurrency(summary.paid, locale)} icon={Wallet} tone="success" />
        </div>
      )}

      <TabsNav active={tab} tabs={TABS.map((k) => ({ key: k, label: ct.tabs[k], href: `/customers/${id}?tab=${k}` }))} />

      {tab === "data" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
          <div className="space-y-6">
            {c.customer_type === "individual" ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{ct.sections.identity}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <InfoGrid
                      items={[
                        { label: f.full_name, value: c.full_name, wide: true },
                        { label: f.birth_date, value: c.birth_date && formatDate(c.birth_date) },
                        { label: f.id_document_type, value: c.id_document_type && ct.idTypes[c.id_document_type as keyof typeof ct.idTypes] },
                        { label: f.id_document_number, value: c.id_document_number },
                        { label: f.nationality, value: c.nationality },
                      ]}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{ct.sections.licence}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <InfoGrid
                      items={[
                        { label: f.driving_licence_number, value: c.driving_licence_number },
                        {
                          label: f.driving_licence_expiry,
                          value: c.driving_licence_expiry && (
                            <span className={licenceExpired ? "text-danger" : licenceSoon ? "text-warning" : undefined}>
                              {formatDate(c.driving_licence_expiry)}
                            </span>
                          ),
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
              </>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{ct.sections.company}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <InfoGrid
                      items={[
                        { label: f.company_name, value: c.company_name },
                        { label: f.legal_name, value: c.legal_name },
                        { label: f.tax_id, value: c.tax_id },
                        { label: f.representative_name, value: c.representative_name },
                      ]}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{ct.sections.billing}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <InfoGrid
                      items={[
                        { label: f.billing_email, value: billing.email },
                        { label: f.billing_address, value: billing.address },
                        { label: f.billing_notes, value: billing.notes, wide: true },
                      ]}
                    />
                  </CardContent>
                </Card>
              </>
            )}
            <Card>
              <CardHeader>
                <CardTitle>{ct.sections.contact}</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid
                  items={[
                    { label: f.phone, value: c.phone },
                    { label: f.email, value: c.email },
                    { label: f.address, value: c.address, wide: true },
                    { label: f.postal_code, value: c.postal_code },
                    { label: f.city, value: c.city },
                    { label: f.country, value: c.country },
                  ]}
                />
                {c.notes && <p className="mt-4 whitespace-pre-line border-t border-border pt-4 text-sm text-muted">{c.notes}</p>}
              </CardContent>
            </Card>
          </div>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-gold" /> {ct.gdpr.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted">
                {c.gdpr_consent_at ? interpolate(ct.gdpr.consentAt, { date: formatDateTime(c.gdpr_consent_at) }) : "—"}
              </p>
              <p className="text-muted">
                {ct.gdpr.marketing}: {c.marketing_consent ? t.common.yes : t.common.no}
              </p>
              {isOwner && !c.anonymized_at && (
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-xs text-subtle">{ct.gdpr.body}</p>
                  <AnonymizeButton id={id} name={name} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "rentals" && <RentalsTab id={id} />}
      {tab === "payments" && <PaymentsTab id={id} />}
      {tab === "deposits" && <DepositsTab id={id} />}
      {tab === "fines" && <PhaseNotice text={interpolate(t.common.availableInPhase, { n: 7 })} />}
      {tab === "damages" && <DamagesTab id={id} />}
      {tab === "documents" && (
        <CustomerDocuments
          customerId={id}
          companyId={session.profile.companyId}
          today={today}
          canDelete={isOwner}
          readOnly={!!c.archived_at}
          docs={(await listCustomerDocuments(id)).map((d) => ({
            id: d.id,
            label: d.title,
            typeLabel: ct.docs.types[d.doc_type as (typeof CUSTOMER_DOC_TYPES)[number]] ?? d.doc_type,
            mime_type: d.mime_type,
            size_bytes: d.size_bytes,
            expires_at: d.expires_at,
            created_at: d.created_at,
          }))}
        />
      )}
      {tab === "history" && <HistoryTab id={id} />}
    </div>
  );
}

async function RentalsTab({ id }: { id: string }) {
  const [{ t, locale }, rows] = await Promise.all([getI18n(), listCustomerRentals(id)]);
  if (rows.length === 0)
    return (
      <EmptyState icon={FileText} title={t.customers.rentalsEmpty}>
        <Button asChild size="sm">
          <Link href={`/rentals/new?customer=${id}`}>
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
            <span className="min-w-0 flex-1 truncate text-sm">{r.vehicle}</span>
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

async function DepositsTab({ id }: { id: string }) {
  const [{ t, locale }, rows] = await Promise.all([getI18n(), listCustomerDeposits(id)]);
  if (rows.length === 0) return <EmptyState icon={Wallet} title={t.deposits.empty} />;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {rows.map((d) => (
          <li key={d.id}>
            <Link href={`/rentals/${d.rental_id}`} className="flex flex-wrap items-center gap-3 p-4 text-sm transition hover:bg-surface-2/60">
              <span className="font-mono text-xs">{d.contract_number}</span>
              <Badge variant={d.status === "held" ? "info" : d.status === "settled" ? "success" : "warning"}>{t.deposits.status[d.status]}</Badge>
              <span className="flex-1 text-xs text-muted tabular">
                {t.deposits.received} {formatCurrency(d.received, locale)} · {t.deposits.returned} {formatCurrency(d.returned, locale)}
                {d.retained ? ` · ${t.deposits.retained} ${formatCurrency(d.retained, locale)}` : ""}
              </span>
              <span className="font-medium tabular">{formatCurrency(d.balance, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function DamagesTab({ id }: { id: string }) {
  const [{ t }, res] = await Promise.all([getI18n(), listDamages({ customerId: id, limit: 100 })]);
  if (res.items.length === 0) return <EmptyState icon={FileText} title={t.damages.empty} />;
  return <DamageList items={res.items} />;
}

async function PaymentsTab({ id }: { id: string }) {
  const [{ t, locale }, rows] = await Promise.all([getI18n(), listCustomerPayments(id)]);
  if (rows.length === 0) return <EmptyState icon={Wallet} title={t.customers.paymentsEmpty} />;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="min-w-0 flex-1 truncate">{p.description}</span>
            <span className="text-xs text-muted">{t.financeCategories[p.category as keyof typeof t.financeCategories] ?? p.category}</span>
            <span className="text-xs text-muted tabular">{formatDate(p.paid_at ?? p.competence_date)}</span>
            <span className="font-medium tabular">{formatCurrency(Number(p.amount), locale)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function HistoryTab({ id }: { id: string }) {
  const [{ t }, rows, users] = await Promise.all([getI18n(), listEntityHistory(["customers"], id), listCompanyUsers()]);
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
