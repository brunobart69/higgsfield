import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CalendarClock,
  Car,
  CarFront,
  CircleCheck,
  FileClock,
  FileSignature,
  KeyRound,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wrench,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/queries";
import { chartWindow, isPeriodKey, resolvePeriod } from "@/lib/periods";
import { formatCurrency, formatNumber } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { AssetsChart, FinanceChart, OccupancyChart, VehicleChart } from "@/components/dashboard/charts";
import { PasswordUpdatedToast } from "@/components/dashboard/password-toast";
import { Card, CardContent } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.dashboard.title };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; password?: string }>;
}) {
  const [{ t, locale }, session, params] = await Promise.all([getI18n(), getSession(), searchParams]);
  const period = resolvePeriod(isPeriodKey(params.period) ? params.period : "thisMonth", {
    from: params.from,
    to: params.to,
  });
  const data = await loadDashboard(period, chartWindow(period));
  const k = t.dashboard.kpis;
  const firstName =
    session.status === "ok"
      ? (session.profile.fullName?.split(" ")[0] ?? session.profile.email.split("@")[0] ?? "")
      : "";

  return (
    <div className="space-y-6">
      {params.password === "updated" && <PasswordUpdatedToast />}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="animate-fade-up">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gold">{t.dashboard.title}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {interpolate(t.dashboard.greeting, { name: firstName })}
          </h1>
          <p className="mt-1 text-sm text-muted">{t.dashboard.subtitle}</p>
        </div>
        <PeriodFilter value={period.key} from={period.from} to={period.to} />
      </div>

      {!data.ok ? (
        <Card className="border-danger/30">
          <CardContent className="flex items-start gap-3 p-5 text-sm">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div>
              <p className="font-medium">{t.errors.loadFailed}</p>
              <p className="mt-1 text-muted">{t.errors[data.error]}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {data.kpis.vehicles_total === 0 && (
            <Card className="border-gold/25 bg-[linear-gradient(135deg,rgba(201,162,75,0.10),transparent_60%)]">
              <CardContent className="flex items-start gap-4 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-gold/15 text-gold">
                  <Sparkles className="size-5" />
                </span>
                <div className="space-y-3">
                  <div>
                    <p className="font-medium">{t.dashboard.empty.title}</p>
                    <p className="mt-1 text-sm text-muted">{t.dashboard.empty.body}</p>
                  </div>
                  <Button asChild size="sm">
                    <Link href="/vehicles/new">
                      <Plus /> {t.vehicles.new}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Financeiro do período */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label={k.revenue} value={formatCurrency(data.kpis.revenue, locale)} hint={k.periodHint} icon={TrendingUp} tone="gold" emphasis />
            <KpiCard label={k.expenses} value={formatCurrency(data.kpis.expenses, locale)} hint={k.periodHint} icon={TrendingDown} tone="info" />
            <KpiCard
              label={k.profit}
              value={formatCurrency(data.kpis.operating_profit, locale)}
              hint={k.periodHint}
              icon={Wallet}
              tone={data.kpis.operating_profit < 0 ? "danger" : "success"}
            />
          </section>

          {/* Frota */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label={k.totalVehicles} value={formatNumber(data.kpis.vehicles_total, locale)} icon={Car} tone="gold" />
            <KpiCard label={k.available} value={formatNumber(data.kpis.vehicles_available, locale)} icon={CircleCheck} tone="success" />
            <KpiCard label={k.rented} value={formatNumber(data.kpis.vehicles_rented, locale)} icon={KeyRound} tone="info" />
            <KpiCard label={k.reserved} value={formatNumber(data.kpis.vehicles_reserved, locale)} icon={CarFront} tone="warning" />
            <KpiCard label={k.maintenance} value={formatNumber(data.kpis.vehicles_maintenance, locale)} icon={Wrench} tone="danger" className="col-span-2 md:col-span-1" />
          </section>

          {/* Operação e vencimentos */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label={k.activeContracts} value={formatNumber(data.kpis.active_contracts, locale)} icon={FileSignature} tone="gold" />
            <KpiCard label={k.upcomingReturns} value={formatNumber(data.kpis.upcoming_returns, locale)} hint={k.upcomingReturnsHint} icon={CalendarClock} tone="info" />
            <KpiCard
              label={k.insuranceExpiring}
              value={formatNumber(data.kpis.insurance_expiring, locale)}
              hint={k.expiringHint}
              icon={ShieldAlert}
              tone={data.kpis.insurance_expiring > 0 ? "warning" : "neutral"}
            />
            <KpiCard
              label={k.documentsExpiring}
              value={formatNumber(data.kpis.documents_expiring, locale)}
              hint={k.expiringHint}
              icon={FileClock}
              tone={data.kpis.documents_expiring > 0 ? "warning" : "neutral"}
            />
            <KpiCard
              label={k.depositsHeld}
              value={formatNumber(data.kpis.deposits_held, locale)}
              hint={formatCurrency(data.kpis.deposits_held_amount, locale)}
              icon={ShieldAlert}
              tone={data.kpis.deposits_held > 0 ? "info" : "neutral"}
              className="col-span-2 md:col-span-1"
            />
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <FinanceChart data={data.monthly} />
            <AlertsPanel alerts={data.alerts} t={t} />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <VehicleChart data={data.vehicles} />
            <OccupancyChart data={data.monthly} />
            <AssetsChart data={data.monthly} />
          </section>
        </>
      )}
    </div>
  );
}
