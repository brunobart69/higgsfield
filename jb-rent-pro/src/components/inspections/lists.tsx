"use client";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { DAMAGE_STATUS_VARIANT, SEVERITY_VARIANT, type InspectionArea } from "@/lib/inspections/constants";
import type { DamageListItem, InspectionListItem } from "@/lib/inspections/queries";

export function InspectionList({ items, showVehicle = true }: { items: InspectionListItem[]; showVehicle?: boolean }) {
  const { t, locale } = useI18n();
  const it = t.inspections;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {items.map((i) => (
        <Link key={i.id} href={`/inspections/${i.id}`} className="flex items-center gap-3 p-4 transition hover:bg-surface-2/60 sm:px-5">
          <ClipboardCheck className="size-5 shrink-0 text-gold" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{it.types[i.inspection_type]}</span>
              <Badge variant={i.status === "completed" ? "success" : "warning"}>{it.status[i.status]}</Badge>
              {i.issues > 0 && (
                <Badge variant="danger">
                  {i.issues} × {it.conditions.damaged}
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted">
              {showVehicle && (
                <>
                  {i.vehicle} · <span className="font-mono">{i.plate}</span>
                </>
              )}
              {i.contract && ` · ${i.contract}`}
              {i.mileage !== null && ` · ${formatNumber(i.mileage, locale)} ${t.common.km}`}
            </p>
          </div>
          <time className="shrink-0 text-xs text-subtle tabular">{formatDateTime(i.performed_at)}</time>
        </Link>
      ))}
    </Card>
  );
}

export function DamageList({ items, showVehicle = true }: { items: DamageListItem[]; showVehicle?: boolean }) {
  const { t, locale } = useI18n();
  const d = t.damages;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {items.map((x) => (
        <Link key={x.id} href={`/damages/${x.id}`} className="flex items-start gap-3 p-4 transition hover:bg-surface-2/60 sm:px-5">
          <AlertTriangle className={x.status === "resolved" ? "mt-0.5 size-5 shrink-0 text-success" : "mt-0.5 size-5 shrink-0 text-warning"} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{d.categories[x.category]}</span>
              {x.area && <span className="text-xs text-muted">{t.inspections.areas[x.area as InspectionArea]}</span>}
              <Badge variant={SEVERITY_VARIANT[x.severity]}>{d.severities[x.severity]}</Badge>
              <Badge variant={DAMAGE_STATUS_VARIANT[x.status]}>{d.statuses[x.status]}</Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">{x.description}</p>
            <p className="truncate text-xs text-subtle">
              {showVehicle && (
                <>
                  {x.vehicle} · <span className="font-mono">{x.plate}</span> ·{" "}
                </>
              )}
              {formatDate(x.detected_at)}
              {x.contract && ` · ${x.contract}`}
            </p>
          </div>
          {(x.actual_cost ?? x.estimated_cost) !== null && (
            <span className="shrink-0 text-sm tabular">{formatCurrency((x.actual_cost ?? x.estimated_cost)!, locale)}</span>
          )}
        </Link>
      ))}
    </Card>
  );
}
