import Link from "next/link";
import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { MAINTENANCE_STATUS_VARIANT } from "@/lib/maintenance/constants";
import type { MaintenanceRow } from "@/lib/maintenance/queries";

export function RecordList({ rows, t, locale, today, showVehicle = true }: { rows: MaintenanceRow[]; t: Dictionary; locale: Locale; today: string; showVehicle?: boolean }) {
  const m = t.maintenance;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {rows.map((r) => {
        const late = r.status === "scheduled" && r.scheduled_date !== null && r.scheduled_date < today;
        const date = r.status === "completed" ? r.completed_date : r.status === "in_progress" ? r.started_at : r.scheduled_date;
        return (
          <Link key={r.id} href={`/maintenance/${r.id}`} className="grid gap-2 p-4 transition hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <Wrench className={`mt-0.5 size-5 shrink-0 ${r.status === "in_progress" ? "text-warning" : "text-gold"}`} aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.title}</span>
                  <Badge variant={MAINTENANCE_STATUS_VARIANT[r.status]}>{m.statuses[r.status]}</Badge>
                  {late && <Badge variant="danger">{m.overdueDate}</Badge>}
                  {r.status === "completed" && r.cost && !r.paid_at ? <Badge variant="warning">{m.unpaid}</Badge> : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {showVehicle && (
                    <>
                      <span className="font-mono">{r.vehicle.plate}</span> · {r.vehicle.brand} {r.vehicle.model} ·{" "}
                    </>
                  )}
                  {m.types[r.maintenance_type]}
                  {r.workshop && ` · ${r.workshop}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-xs tabular sm:justify-end sm:pl-0">
              {date && <span className="text-muted">{formatDate(date)}</span>}
              {r.mileage !== null && <span className="text-subtle">{formatNumber(r.mileage, locale)} km</span>}
              {r.cost !== null && <span className="text-sm font-medium">{formatCurrency(r.cost, locale)}</span>}
            </div>
          </Link>
        );
      })}
    </Card>
  );
}
