import Link from "next/link";
import { AlertOctagon, AlertTriangle, BellRing, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/format";
import type { AlertSeverity, DashboardAlert } from "@/lib/dashboard/queries";

const severityStyle: Record<AlertSeverity, { variant: "danger" | "warning" | "info" | "neutral"; icon: typeof Info }> = {
  critical: { variant: "danger", icon: AlertOctagon },
  high: { variant: "warning", icon: AlertTriangle },
  medium: { variant: "warning", icon: AlertTriangle },
  low: { variant: "neutral", icon: Info },
  info: { variant: "info", icon: BellRing },
};

function alertHref(a: DashboardAlert): string | null {
  switch (a.entity) {
    case "rentals":
      return `/rentals/${a.entity_id}`;
    case "vehicles":
      if (a.kind === "vehicle_uninsured") return `/vehicles/${a.entity_id}?tab=insurance`;
      if (a.kind === "maintenance_due" || a.kind === "maintenance_overdue") return `/vehicles/${a.entity_id}?tab=maintenance`;
      return `/vehicles/${a.entity_id}`;
    case "maintenance_records":
      return `/maintenance/${a.entity_id}`;
    case "traffic_fines":
      return `/fines/${a.entity_id}`;
    case "accidents":
      return `/fines/accidents/${a.entity_id}`;
    case "insurance_policies":
      return `/insurance/${a.entity_id}`;
    case "documents":
      return "/documents?status=expiring";
    case "customer_documents":
      return `/customers/${a.entity_id}?tab=documents`;
    case "deposits":
      return "/deposits";
    case "damages":
      return `/damages/${a.entity_id}`;
    default:
      return null;
  }
}

function AlertRow({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "-mx-2 flex items-start gap-3 rounded-md px-2 py-1";
  return href ? (
    <Link href={href} className={`${cls} transition hover:bg-surface-2/60`}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function AlertsPanel({ alerts, t }: { alerts: DashboardAlert[]; t: Dictionary }) {
  return (
    <Card id="alerts" className="scroll-mt-24">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4 text-gold" /> {t.dashboard.alerts.title}
        </CardTitle>
        {alerts.length > 0 && <Badge>{alerts.length}</Badge>}
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
            <CheckCircle2 className="size-6 text-success" />
            {t.dashboard.alerts.empty}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a) => {
              const s = severityStyle[a.severity] ?? severityStyle.info;
              const Icon = s.icon;
              const href =
                alertHref(a);
              return (
                <li key={`${a.kind}-${a.entity_id}`} className="py-3 first:pt-0 last:pb-0">
                  <AlertRow href={href}>
                  <span className="mt-0.5">
                    <Icon
                      className={
                        s.variant === "danger" ? "size-4 text-danger" : s.variant === "warning" ? "size-4 text-warning" : "size-4 text-info"
                      }
                      aria-hidden
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{t.dashboard.alerts.kinds[a.kind] ?? a.kind}</p>
                      <Badge variant={s.variant}>{t.dashboard.alerts.severity[a.severity]}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted">{a.title}</p>
                  </div>
                  {a.due_date && (
                    <time dateTime={a.due_date} className="shrink-0 text-xs text-subtle tabular">
                      {formatDate(a.due_date)}
                    </time>
                  )}
                  </AlertRow>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
