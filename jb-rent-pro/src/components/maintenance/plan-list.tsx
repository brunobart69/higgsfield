"use client";
import Link from "next/link";
import { CalendarClock, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ArchiveButton } from "@/components/ui/archive-button";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { formatDate, formatNumber } from "@/lib/format";
import { DUE_VARIANT, type DueStatus, type MaintenanceType } from "@/lib/maintenance/constants";
import { archivePlanAction } from "@/app/(app)/maintenance/actions";
import { PlanDialog } from "./plan-dialog";
import { MaintenanceDialog } from "./maintenance-dialog";

export type PlanItem = {
  id: string;
  vehicle_id: string;
  vehicle: string;
  name: string;
  maintenance_type: MaintenanceType;
  interval_km: number | null;
  interval_months: number | null;
  last_done_date: string | null;
  last_done_mileage: number | null;
  notes: string | null;
  next_date: string | null;
  next_km: number | null;
  days_left: number | null;
  km_left: number | null;
  due_status: DueStatus;
  open_record_id: string | null;
};

export function PlanList({ rows, showVehicle = true, readOnly = false }: { rows: PlanItem[]; showVehicle?: boolean; readOnly?: boolean }) {
  const { t, locale } = useI18n();
  const p = t.maintenance.plans;
  const every = (r: PlanItem) =>
    [r.interval_km ? `${formatNumber(r.interval_km, locale)} km` : null, r.interval_months ? interpolate(p.months, { n: r.interval_months }) : null]
      .filter(Boolean)
      .join(" / ");
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {rows.map((r) => (
        <div key={r.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{r.name}</span>
              <Badge variant={DUE_VARIANT[r.due_status]}>{p.due[r.due_status]}</Badge>
              <span className="text-xs text-subtle">{interpolate(p.every, { value: every(r) })}</span>
            </div>
            {showVehicle && (
              <Link href={`/vehicles/${r.vehicle_id}?tab=maintenance`} className="mt-0.5 block truncate text-xs text-muted hover:underline">
                {r.vehicle}
              </Link>
            )}
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular">
              {r.next_date && (
                <span className={r.days_left !== null && r.days_left < 0 ? "text-danger" : "text-muted"}>
                  <CalendarClock className="mr-1 inline size-3.5" aria-hidden />
                  {p.next}: {formatDate(r.next_date)} ·{" "}
                  {r.days_left !== null && (r.days_left < 0 ? interpolate(p.daysOver, { n: -r.days_left }) : interpolate(p.daysLeft, { n: r.days_left }))}
                </span>
              )}
              {r.next_km !== null && (
                <span className={r.km_left !== null && r.km_left <= 0 ? "text-danger" : "text-muted"}>
                  <Gauge className="mr-1 inline size-3.5" aria-hidden />
                  {p.next}: {formatNumber(r.next_km, locale)} km ·{" "}
                  {r.km_left !== null &&
                    (r.km_left <= 0 ? interpolate(p.kmOver, { n: formatNumber(-r.km_left, locale) }) : interpolate(p.kmLeft, { n: formatNumber(r.km_left, locale) }))}
                </span>
              )}
            </div>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5">
              {r.open_record_id ? (
                <Link href={`/maintenance/${r.open_record_id}`} className="text-xs text-gold-light hover:underline">
                  {t.maintenance.statuses.scheduled} →
                </Link>
              ) : (
                <MaintenanceDialog
                  size="sm"
                  variant={r.due_status === "ok" ? "secondary" : "default"}
                  label={p.schedule}
                  values={{ vehicle_id: r.vehicle_id, plan_id: r.id, maintenance_type: r.maintenance_type, title: r.name }}
                  plans={[{ value: r.id, vehicle_id: r.vehicle_id, label: r.name, type: r.maintenance_type }]}
                />
              )}
              <PlanDialog values={r} size="sm" />
              <ArchiveButton size="sm" iconOnly action={() => archivePlanAction(r.id)} title={p.confirmArchive} success={p.archivedOk} />
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
