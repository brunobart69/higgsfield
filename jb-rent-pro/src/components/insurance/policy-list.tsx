import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { interpolate } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { formatCurrency, formatDate } from "@/lib/format";
import { daysLeft, policyStatus, STATUS_VARIANT } from "@/lib/insurance/status";
import type { Policy } from "@/lib/insurance/queries";

/** Texto do prazo: "faltam N dias", "vencida há N dias", "começa em N dias". */
export function remainingText(t: Dictionary, p: Pick<Policy, "start_date" | "end_date">, today: string) {
  if (p.start_date > today) return interpolate(t.insurance.startsIn, { n: daysLeft(p.start_date, today) });
  const d = daysLeft(p.end_date, today);
  if (d < 0) return interpolate(t.insurance.expiredDays, { n: -d });
  if (d === 0) return t.insurance.endsToday;
  return interpolate(t.insurance.daysLeft, { n: d });
}

export function PolicyList({ rows, t, locale, today, showVehicle = true }: { rows: Policy[]; t: Dictionary; locale: Locale; today: string; showVehicle?: boolean }) {
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {rows.map((p) => {
        const st = policyStatus(p, today);
        const dl = daysLeft(p.end_date, today);
        const urgent = st === "expiring" && dl <= 7;
        return (
          <Link key={p.id} href={`/insurance/${p.id}`} className="grid gap-2 p-4 transition hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <ShieldCheck className={`mt-0.5 size-5 shrink-0 ${st === "expired" ? "text-danger" : st === "expiring" ? "text-warning" : "text-gold"}`} aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{p.insurer}</span>
                  <span className="font-mono text-xs text-muted">{p.policy_number}</span>
                  <Badge variant={urgent ? "danger" : STATUS_VARIANT[st]}>{t.insurance.statuses[st]}</Badge>
                  {p.premium_amount && !p.paid_at && st !== "archived" ? <Badge variant="warning">{t.insurance.unpaid}</Badge> : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {showVehicle && (
                    <>
                      <span className="font-mono">{p.vehicle.plate}</span> · {p.vehicle.brand} {p.vehicle.model} ·{" "}
                    </>
                  )}
                  {p.coverage_type ?? "—"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-xs tabular sm:justify-end sm:pl-0 sm:text-right">
              <span className="text-muted">
                {formatDate(p.start_date)} → {formatDate(p.end_date)}
              </span>
              {st !== "renewed" && st !== "archived" && (
                <span className={st === "expired" || urgent ? "text-danger" : st === "expiring" ? "text-warning" : "text-subtle"}>{remainingText(t, p, today)}</span>
              )}
              {p.premium_amount !== null && <span className="text-sm font-medium">{formatCurrency(p.premium_amount, locale)}</span>}
            </div>
          </Link>
        );
      })}
    </Card>
  );
}
