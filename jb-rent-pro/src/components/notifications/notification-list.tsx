"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertOctagon, AlertTriangle, BellRing, CheckCheck, Info, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { alertHref } from "@/components/dashboard/alerts-panel";
import { markNotificationsReadAction } from "@/app/(app)/notifications/actions";
import type { NotificationRow } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";

const ICON = { critical: AlertOctagon, high: AlertTriangle, medium: BellRing, low: Info, info: Info } as const;
const TONE = { critical: "text-danger", high: "text-warning", medium: "text-gold", low: "text-info", info: "text-muted" } as const;
const VARIANT = { critical: "danger", high: "warning", medium: "neutral", low: "info", info: "neutral" } as const;

export function NotificationList({ rows, resolved = false }: { rows: NotificationRow[]; resolved?: boolean }) {
  const { t } = useI18n();
  const n = t.notifications;
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = rows.filter((r) => !r.read).length;
  const kinds = t.dashboard.alerts.kinds as Record<string, string>;

  const mark = (ids: string[] | null) =>
    start(async () => {
      const res = await markNotificationsReadAction(ids);
      if (res.ok) router.refresh();
      else toast.error(errorText(t, res.error));
    });

  if (rows.length === 0)
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted">
        <Inbox className="size-6 text-gold" aria-hidden />
        {resolved ? n.emptyResolved : n.empty}
      </Card>
    );

  return (
    <div className="space-y-3">
      {!resolved && unread > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => mark(null)} loading={pending}>
            <CheckCheck /> {n.markAll}
          </Button>
        </div>
      )}
      <Card className="divide-y divide-border overflow-hidden">
        {rows.map((r) => {
          const Icon = ICON[r.severity];
          const href = alertHref({ kind: r.kind as never, entity: r.entity ?? "", entity_id: r.entity_id ?? "" });
          const body = (
            <>
              <Icon className={cn("mt-0.5 size-5 shrink-0", resolved ? "text-subtle" : TONE[r.severity])} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {!r.read && !resolved && <span className="size-2 shrink-0 rounded-full bg-gold" aria-label={n.unread} />}
                  <span className={cn("text-sm", !r.read && !resolved ? "font-semibold" : "font-medium text-muted")}>{kinds[r.kind] ?? n.kinds[r.kind as keyof typeof n.kinds] ?? r.kind}</span>
                  <Badge variant={resolved ? "neutral" : VARIANT[r.severity]}>{t.dashboard.alerts.severity[r.severity]}</Badge>
                </div>
                <p className="mt-0.5 truncate text-sm">{r.title}</p>
                <p className="mt-0.5 text-xs text-subtle tabular">
                  {r.due_date && `${t.dashboard.alerts.dueOn.replace("{date}", formatDate(r.due_date))} · `}
                  {resolved && r.resolved_at ? `${n.resolvedAt} ${formatDateTime(r.resolved_at)}` : formatDateTime(r.created_at)}
                </p>
              </div>
            </>
          );
          return (
            <div key={r.id} className={cn("flex items-start gap-3 p-4 sm:px-5", !r.read && !resolved && "bg-gold/[0.03]")}>
              {href ? (
                <Link href={href} onClick={() => !r.read && !resolved && mark([r.id])} className="flex min-w-0 flex-1 items-start gap-3 hover:opacity-90">
                  {body}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>
              )}
              {!r.read && !resolved && (
                <button
                  type="button"
                  onClick={() => mark([r.id])}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
                  aria-label={n.markRead}
                  title={n.markRead}
                >
                  <CheckCheck className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
