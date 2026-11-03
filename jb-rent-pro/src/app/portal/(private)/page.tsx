import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarPlus, ChevronRight, CarFront, Lock, Phone, Mail } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getPortalFines, getPortalMe, getPortalRentals } from "@/lib/portal/queries";
import { addDays, todayInMadrid } from "@/lib/periods";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RentalStatusBadge } from "@/components/rentals/rental-status-badge";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.portal.title };
}

export default async function PortalHome() {
  const [{ t, locale }, me, rentals, fines] = await Promise.all([getI18n(), getPortalMe(), getPortalRentals(), getPortalFines()]);
  if (!me) return null;
  const p = t.portal;
  const today = todayInMadrid();
  const current = rentals.find((r) => r.status === "in_progress" || r.status === "late");
  const next = rentals
    .filter((r) => (r.status === "reservation" || r.status === "confirmed") && r.return_at >= new Date().toISOString())
    .sort((a, b) => a.pickup_at.localeCompare(b.pickup_at))[0];
  const balance = rentals.filter((r) => r.status !== "cancelled" && r.status !== "reservation").reduce((a, r) => a + Math.round(r.balance * 100), 0) / 100;
  const deposits = rentals.reduce((a, r) => a + Math.round((r.deposit_status === "held" ? (r.deposit_balance ?? 0) : 0) * 100), 0) / 100;
  const finesDue = fines.filter((f) => f.charged && !f.charged_paid_at).reduce((a, f) => a + Math.round((f.charged ?? 0) * 100), 0) / 100;
  const lic = me.driving_licence_expiry;
  const highlight = current ?? next;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="animate-fade-up">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gold">{p.title}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{interpolate(p.home.greeting, { name: me.name.split(" ")[0] ?? me.name })}</h1>
        </div>
        <Button asChild>
          <Link href="/portal/request">
            <CalendarPlus /> {p.home.newRequest}
          </Link>
        </Button>
      </div>

      {lic && lic <= addDays(today, 30) && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {lic < today ? p.home.licenceExpired : interpolate(p.home.licenceSoon, { date: formatDate(lic) })}
        </p>
      )}

      {highlight ? (
        <Link href={`/portal/rentals/${highlight.id}`} className="block">
          <Card className="border-gold/40 transition hover:border-gold/70">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
                <CarFront className="size-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wider text-gold">{current ? p.home.current : p.home.next}</p>
                <p className="mt-0.5 text-lg font-semibold">
                  {highlight.vehicle} <span className="font-mono text-sm text-muted">{highlight.plate}</span>
                </p>
                <p className="text-sm text-muted tabular">
                  {formatDateTime(highlight.pickup_at)} → {formatDateTime(highlight.return_at)}
                </p>
                {highlight.pickup_location && <p className="text-xs text-subtle">{highlight.pickup_location}</p>}
              </div>
              <ChevronRight className="hidden size-5 text-muted sm:block" aria-hidden />
            </CardContent>
          </Card>
        </Link>
      ) : (
        <Card className="p-5 text-sm text-muted">{p.home.none}</Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label={p.home.balance} value={formatCurrency(balance, locale)} icon={CalendarPlus} tone={balance > 0 ? "warning" : "success"} />
        <KpiCard label={p.home.deposits} value={formatCurrency(deposits, locale)} icon={Lock} tone="info" />
        <KpiCard label={p.home.fines} value={formatCurrency(finesDue, locale)} icon={AlertTriangle} tone={finesDue > 0 ? "danger" : "neutral"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{p.rentals.title}</CardTitle>
        </CardHeader>
        <CardContent className={rentals.length ? "p-0" : undefined}>
          {rentals.length === 0 ? (
            <p className="text-sm text-muted">{p.rentals.empty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rentals.map((r) => (
                <li key={r.id}>
                  <Link href={`/portal/rentals/${r.id}`} className="grid gap-1 px-5 py-3.5 transition hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{r.contract_number}</span>
                        <RentalStatusBadge status={r.status} returnAt={r.return_at} />
                        {r.balance > 0 && r.status !== "cancelled" && r.status !== "reservation" && <Badge variant="warning">{`${p.rentals.balance}: ${formatCurrency(r.balance, locale)}`}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-sm">
                        {r.vehicle} · <span className="font-mono text-xs text-muted">{r.plate}</span>
                      </p>
                    </div>
                    <div className="text-xs text-muted tabular sm:text-right">
                      {formatDateTime(r.pickup_at)} → {formatDateTime(r.actual_return_at ?? r.return_at)}
                      <span className="block text-sm font-medium text-foreground">{formatCurrency(r.total_amount, locale)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {fines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{p.fines.title}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {fines.map((f) => (
                <li key={`${f.kind}-${f.id}`} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={f.kind === "fine" ? "warning" : "info"}>{p.fines.kinds[f.kind]}</Badge>
                      <span className="text-xs text-muted tabular">{formatDateTime(f.occurred_at)}</span>
                      {f.contract_number && <span className="font-mono text-xs text-subtle">{f.contract_number}</span>}
                    </div>
                    <p className="mt-0.5 text-sm">{f.description}</p>
                    {f.kind === "fine" && f.status === "driver_identified" && <p className="text-xs text-subtle">{p.fines.identified}</p>}
                  </div>
                  {f.charged ? (
                    <div className="text-sm tabular sm:text-right">
                      <span className="block text-xs text-subtle">{p.fines.charged}</span>
                      <span className="font-semibold">{formatCurrency(f.charged, locale)}</span>
                      <span className={f.charged_paid_at ? "block text-xs text-success" : "block text-xs text-warning"}>
                        {f.charged_paid_at ? interpolate(p.fines.paidOn, { date: formatDate(f.charged_paid_at) }) : p.fines.pending}
                      </span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{p.home.contact}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{me.company.legal_name ?? me.company.name}</p>
            {me.company.address && <p className="text-muted">{[me.company.address, me.company.city].filter(Boolean).join(", ")}</p>}
            {me.company.phone && (
              <a href={`tel:${me.company.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 text-gold-light hover:underline">
                <Phone className="size-4" /> {me.company.phone}
              </a>
            )}
            {me.company.email && (
              <a href={`mailto:${me.company.email}`} className="flex items-center gap-2 text-gold-light hover:underline">
                <Mail className="size-4" /> {me.company.email}
              </a>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{p.privacy.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">{interpolate(p.privacy.body, { company: me.company.legal_name ?? me.company.name })}</CardContent>
        </Card>
      </div>
    </div>
  );
}
