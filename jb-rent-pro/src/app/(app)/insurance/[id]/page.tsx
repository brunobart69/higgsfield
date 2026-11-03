import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BellRing, Phone } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";
import { getPolicy, getPolicyChain } from "@/lib/insurance/queries";
import { listLinkedDocuments } from "@/lib/documents/queries";
import { listEntityHistory } from "@/lib/vehicles/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { alertBand, policyStatus, renewalPeriod, STATUS_VARIANT } from "@/lib/insurance/status";
import { todayInMadrid } from "@/lib/periods";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoGrid } from "@/components/ui/info-grid";
import { ActivityList } from "@/components/activity/activity-list";
import { InsuranceDialog } from "@/components/insurance/insurance-dialog";
import { ArchivePolicyButton } from "@/components/insurance/archive-policy";
import { remainingText } from "@/components/insurance/policy-list";
import { LinkedDocuments } from "@/components/documents/linked-documents";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.insurance.title };
}

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }, session] = await Promise.all([getI18n(), params, getSession()]);
  const p = await getPolicy(id);
  if (!p || session.status !== "ok") notFound();
  const today = todayInMadrid();
  const [chain, docs, history, users] = await Promise.all([
    getPolicyChain(p),
    listLinkedDocuments({ insurancePolicyId: id }),
    listEntityHistory(["insurance_policies"], id, 30),
    listCompanyUsers(),
  ]);
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const it = t.insurance;
  const f = it.fields;
  const st = policyStatus(p, today);
  const band = st === "expiring" || st === "expired" ? alertBand(p.end_date, today) : null;
  const archived = !!p.archived_at;
  const prev = chain.find((c) => c.id === p.renewed_from_id);
  const next = chain.find((c) => c.id === p.renewal_id);
  const renew = renewalPeriod(p.start_date, p.end_date);
  const vehicleLabel = `${p.vehicle.brand} ${p.vehicle.model} · ${p.vehicle.plate}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/insurance" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {it.title}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[st]}>{it.statuses[st]}</Badge>
            {band !== null && band > 0 && <Badge variant={band === 7 ? "danger" : "warning"}>{interpolate(it.band, { n: band })}</Badge>}
            {p.premium_amount && !p.paid_at && !archived ? <Badge variant="warning">{it.unpaid}</Badge> : null}
          </div>
          <h1 className="mt-1.5 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">{p.insurer}</h1>
          <p className="text-sm text-muted">
            <span className="font-mono">{p.policy_number}</span> ·{" "}
            <Link href={`/vehicles/${p.vehicle_id}?tab=insurance`} className="hover:underline">
              {vehicleLabel}
            </Link>
          </p>
        </div>
        {!archived && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <InsuranceDialog mode="edit" values={p} />
            {!p.renewed && (
              <InsuranceDialog
                mode="renew"
                variant="default"
                values={{
                  vehicle_id: p.vehicle_id,
                  renewed_from_id: p.id,
                  insurer: p.insurer,
                  policy_number: p.policy_number,
                  coverage_type: p.coverage_type,
                  start_date: renew.start,
                  end_date: renew.end,
                  premium_amount: p.premium_amount,
                  deductible_amount: p.deductible_amount,
                  roadside_assistance: p.roadside_assistance,
                  assistance_phone: p.assistance_phone,
                  payment_method: p.payment_method,
                }}
              />
            )}
            <ArchivePolicyButton id={p.id} />
          </div>
        )}
      </div>

      {(st === "expiring" || st === "expired") && (
        <div className={cn("flex items-start gap-2 rounded-lg border p-4 text-sm", st === "expired" ? "border-danger/40 bg-danger/5" : "border-warning/40 bg-warning/5")}>
          <BellRing className={cn("mt-0.5 size-4 shrink-0", st === "expired" ? "text-danger" : "text-warning")} aria-hidden />
          <p>
            <span className="font-medium">{remainingText(t, p, today)}</span> · {formatDate(p.end_date)}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{it.sections.policy}</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid
            items={[
              { label: f.vehicle, value: <Link className="hover:underline" href={`/vehicles/${p.vehicle_id}`}>{vehicleLabel}</Link> },
              { label: f.start_date, value: formatDate(p.start_date) },
              { label: f.end_date, value: formatDate(p.end_date) },
              { label: f.coverage_type, value: p.coverage_type },
              { label: f.deductible_amount, value: p.deductible_amount !== null && formatCurrency(p.deductible_amount, locale) },
              { label: f.roadside_assistance, value: p.roadside_assistance ? t.common.yes : t.common.no },
              {
                label: f.assistance_phone,
                value: p.assistance_phone && (
                  <a href={`tel:${p.assistance_phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-gold-light hover:underline">
                    <Phone className="size-3.5" /> {p.assistance_phone}
                  </a>
                ),
              },
              { label: f.premium_amount, value: p.premium_amount !== null && formatCurrency(p.premium_amount, locale) },
              { label: f.paid_at, value: p.paid_at && formatDate(p.paid_at) },
              { label: f.payment_method, value: p.payment_method && t.paymentMethods[p.payment_method as keyof typeof t.paymentMethods] },
              { label: f.notes, value: p.notes, wide: true },
            ]}
          />
          <p className="mt-4 text-xs text-subtle">{it.premiumNote}</p>
        </CardContent>
      </Card>

      {chain.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{it.sections.history}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 pb-2">
            {(prev || next) && (
              <p className="px-5 text-xs text-muted">
                {prev && interpolate(it.renewalOf, { n: prev.policy_number })}
                {prev && next && " · "}
                {next && interpolate(it.renewedBy, { n: next.policy_number })}
              </p>
            )}
            <ul className="divide-y divide-border">
              {chain.map((c) => {
                const cs = policyStatus(c, today);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/insurance/${c.id}`}
                      aria-current={c.id === p.id ? "page" : undefined}
                      className={cn("flex flex-wrap items-center gap-3 px-5 py-3 text-sm transition hover:bg-surface-2/60", c.id === p.id && "bg-gold/5")}
                    >
                      <span className="tabular text-muted">
                        {formatDate(c.start_date)} → {formatDate(c.end_date)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {c.insurer} · <span className="font-mono text-xs">{c.policy_number}</span>
                      </span>
                      {c.id === p.id && <Badge variant="neutral">{it.current}</Badge>}
                      <Badge variant={STATUS_VARIANT[cs]}>{it.statuses[cs]}</Badge>
                      {c.premium_amount !== null && <span className="tabular">{formatCurrency(c.premium_amount, locale)}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{it.sections.documents}</CardTitle>
        </CardHeader>
        <CardContent>
          <LinkedDocuments
            companyId={session.profile.companyId}
            target={{ kind: "insurance", policyId: p.id, vehicleId: p.vehicle_id }}
            today={today}
            readOnly={archived}
            categories={["insurance_policy", "receipt", "invoice", "other"]}
            buttonLabel={it.uploadPolicy}
            emptyText={it.docsEmpty}
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
