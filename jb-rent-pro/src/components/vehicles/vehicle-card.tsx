"use client";
import Link from "next/link";
import { CalendarClock, CarFront, Gauge } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { addDays } from "@/lib/periods";
import type { VehicleListItem } from "@/lib/vehicles/queries";
import { VehicleStatusBadge } from "./status-badge";

export function VehicleCard({ v, today }: { v: VehicleListItem; today: string }) {
  const { t, locale } = useI18n();
  const itvSoon = v.itv_due_date !== null && v.itv_due_date <= addDays(today, 30);
  const itvExpired = v.itv_due_date !== null && v.itv_due_date < today;
  return (
    <Link
      href={`/vehicles/${v.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface/80 transition hover:border-gold/40 focus-visible:border-gold"
    >
      <div className="relative aspect-[16/10] bg-surface-2">
        {v.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária do Storage privado
          <img src={v.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-subtle">
            <CarFront className="size-8" aria-hidden />
            <span className="text-xs">{t.vehicles.noPhoto}</span>
          </div>
        )}
        <div className="absolute left-3 top-3">
          <VehicleStatusBadge status={v.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {v.brand} {v.model}
            </p>
            <p className="truncate text-xs text-muted">{[v.version, v.year].filter(Boolean).join(" · ") || " "}</p>
          </div>
          <span className="shrink-0 rounded border border-border-strong bg-background px-2 py-0.5 font-mono text-xs tracking-wider">{v.plate}</span>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted tabular">
          <span className="inline-flex items-center gap-1">
            <Gauge className="size-3.5" aria-hidden /> {formatNumber(v.current_mileage, locale)} {t.common.km}
          </span>
          {v.itv_due_date && (
            <span className={itvExpired ? "inline-flex items-center gap-1 text-danger" : itvSoon ? "inline-flex items-center gap-1 text-warning" : "inline-flex items-center gap-1"}>
              <CalendarClock className="size-3.5" aria-hidden /> {t.vehicles.itvDue} {formatDate(v.itv_due_date)}
            </span>
          )}
          {v.daily_price !== null && (
            <span className="ml-auto font-medium text-gold-light">
              {formatCurrency(v.daily_price, locale)}
              <span className="font-normal text-subtle">{t.vehicles.perDay}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
