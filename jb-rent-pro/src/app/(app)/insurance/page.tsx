import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Car, Euro, ShieldCheck, ShieldX } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { getInsuranceOverview, listPolicies, listUninsuredVehicles } from "@/lib/insurance/queries";
import { getDocumentLinkOptions } from "@/lib/documents/queries";
import { policyStatus, type PolicyStatus } from "@/lib/insurance/status";
import { sanitizeSearch } from "@/lib/search";
import { todayInMadrid } from "@/lib/periods";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PolicyList } from "@/components/insurance/policy-list";
import { InsuranceDialog } from "@/components/insurance/insurance-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.insurance.title };
}

const FILTERS = ["all", "active", "expiring", "expired", "upcoming"] as const;
type Filter = (typeof FILTERS)[number];

function matches(f: Filter, st: PolicyStatus) {
  if (f === "all") return st !== "renewed";
  if (f === "active") return st === "active" || st === "expiring";
  return st === f;
}

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const [{ t, locale }, sp, session] = await Promise.all([getI18n(), searchParams, getSession()]);
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as Filter) : "all";
  const q = sanitizeSearch(sp.q).toLowerCase();
  const today = todayInMadrid();
  const [all, overview, uninsured, opts] = await Promise.all([listPolicies(), getInsuranceOverview(), listUninsuredVehicles(), getDocumentLinkOptions()]);
  const it = t.insurance;
  const withStatus = all.map((p) => ({ p, st: policyStatus(p, today) }));
  const searched = q
    ? withStatus.filter(({ p }) => `${p.insurer} ${p.policy_number} ${p.vehicle.plate} ${p.vehicle.brand} ${p.vehicle.model}`.toLowerCase().includes(q))
    : withStatus;
  const rows = searched.filter(({ st }) => matches(filter, st)).map(({ p }) => p);
  const count = (f: Filter) => searched.filter(({ st }) => matches(f, st)).length;
  const href = (f: Filter) => `/insurance?${new URLSearchParams({ ...(f !== "all" ? { f } : {}), ...(sp.q ? { q: sp.q } : {}) })}`;
  const canEdit = session.status === "ok";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.fleet}
        title={it.title}
        description={it.subtitle}
        actions={canEdit && <InsuranceDialog values={{}} vehicles={opts.vehicles} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={it.overview.active} value={formatNumber(overview.active, locale)} icon={ShieldCheck} tone="success" />
        <KpiCard label={it.overview.expiring} value={formatNumber(overview.expiring, locale)} icon={CalendarClock} tone={overview.expiring ? "warning" : "neutral"} />
        <KpiCard label={it.overview.expired} value={formatNumber(overview.expired, locale)} icon={ShieldX} tone={overview.expired ? "danger" : "neutral"} />
        <KpiCard label={it.overview.uninsured} value={formatNumber(overview.uninsured, locale)} icon={Car} tone={overview.uninsured ? "danger" : "neutral"} />
        <KpiCard label={it.overview.premiumsYear} value={formatCurrency(overview.premiumsYear, locale)} icon={Euro} tone="gold" className="col-span-2 lg:col-span-1" />
      </div>

      {uninsured.length > 0 && (
        <Card className="border-danger/40">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div>
                <p className="text-sm font-medium">{it.uninsuredTitle}</p>
                <p className="text-xs text-muted">{it.uninsuredHint}</p>
              </div>
            </div>
            <ul className="flex flex-wrap gap-2">
              {uninsured.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/vehicles/${v.id}?tab=insurance`}
                    className="inline-flex h-9 max-w-full items-center truncate rounded-full border border-border bg-surface-2 px-3.5 text-xs hover:border-gold/50"
                  >
                    {v.label}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ListToolbar
        action="/insurance"
        q={sp.q}
        placeholder={it.searchPlaceholder}
        searchLabel={t.common.search}
        hidden={{ f: filter !== "all" ? filter : undefined }}
        chips={FILTERS.map((f) => ({ label: it.filters[f], href: href(f), active: filter === f, count: count(f) }))}
      />
      {all.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={it.empty}>
          {canEdit && <InsuranceDialog values={{}} vehicles={opts.vehicles} size="sm" />}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={it.noResults} />
      ) : (
        <PolicyList rows={rows} t={t} locale={locale} today={today} />
      )}
    </div>
  );
}
