import Link from "next/link";
import { CarFront, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate, type Locale } from "@/lib/i18n/config";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { ACCIDENT_STATUS_VARIANT, daysUntil, FINE_STATUS_VARIANT } from "@/lib/fines/constants";
import type { Accident, Fine } from "@/lib/fines/queries";

function Deadline({ label, date, today, t }: { label: string; date: string | null; today: string; t: Dictionary }) {
  const d = daysUntil(date, today);
  if (d === null || !date) return null;
  const cls = d < 0 ? "text-danger" : d <= 7 ? "text-warning" : "text-subtle";
  return (
    <span className={cls}>
      {label}: {formatDate(date)} · {d < 0 ? t.fines.overdue : interpolate(t.fines.daysLeft, { n: d })}
    </span>
  );
}

export function FineList({ rows, t, locale, today, showVehicle = true }: { rows: Fine[]; t: Dictionary; locale: Locale; today: string; showVehicle?: boolean }) {
  const fi = t.fines;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {rows.map((r) => {
        const open = r.status === "pending" || r.status === "appealed";
        return (
          <Link key={r.id} href={`/fines/${r.id}`} className="grid gap-2 p-4 transition hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <Siren className={`mt-0.5 size-5 shrink-0 ${open ? "text-warning" : "text-gold"}`} aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.infraction}</span>
                  <Badge variant={FINE_STATUS_VARIANT[r.status]}>{fi.statuses[r.status]}</Badge>
                  {r.status !== "cancelled" && r.recharge_amount && !r.recharge_paid_at ? <Badge variant="warning">{fi.toRecover}</Badge> : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {r.authority}
                  {r.reference && <span className="font-mono"> · {r.reference}</span>}
                  {showVehicle && <span className="font-mono"> · {r.vehicle.plate}</span>}
                  {r.customer && ` · ${r.customer}`}
                </p>
                {r.status === "pending" && (
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs tabular">
                    <Deadline label={fi.fields.identification_deadline} date={r.identification_deadline} today={today} t={t} />
                    <Deadline label={fi.fields.payment_deadline} date={r.payment_deadline} today={today} t={t} />
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-xs tabular sm:justify-end sm:pl-0">
              <span className="text-muted">{formatDateTime(r.infraction_at)}</span>
              <span className="text-sm font-medium">{formatCurrency(r.amount, locale)}</span>
            </div>
          </Link>
        );
      })}
    </Card>
  );
}

export function AccidentList({ rows, t, locale, showVehicle = true }: { rows: Accident[]; t: Dictionary; locale: Locale; showVehicle?: boolean }) {
  const a = t.accidents;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {rows.map((r) => (
        <Link key={r.id} href={`/fines/accidents/${r.id}`} className="grid gap-2 p-4 transition hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <CarFront className={`mt-0.5 size-5 shrink-0 ${r.status === "closed" ? "text-gold" : "text-warning"}`} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{r.description}</span>
                <Badge variant={ACCIDENT_STATUS_VARIANT[r.status]}>{a.statuses[r.status]}</Badge>
                {(r.status === "reported" || r.status === "under_review") && !r.reported_to_insurer_at && <Badge variant="danger">{a.unreported}</Badge>}
              </div>
              <p className="mt-1 truncate text-xs text-muted">
                {showVehicle && <span className="font-mono">{r.vehicle.plate} · </span>}
                {a.faults[r.fault]}
                {r.location && ` · ${r.location}`}
                {r.customer && ` · ${r.customer}`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-xs tabular sm:justify-end sm:pl-0">
            <span className="text-muted">{formatDateTime(r.occurred_at)}</span>
            {r.estimated_cost !== null && <span className="text-sm font-medium">{formatCurrency(r.estimated_cost, locale)}</span>}
          </div>
        </Link>
      ))}
    </Card>
  );
}
