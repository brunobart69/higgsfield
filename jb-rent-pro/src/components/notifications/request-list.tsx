"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Mail, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { formatDateTime } from "@/lib/format";
import { isoToMadridLocal } from "@/lib/rentals/datetime";
import { updateRequestAction } from "@/app/(app)/notifications/actions";
import type { RentalRequest } from "@/lib/notifications/queries";

export function RequestList({ rows }: { rows: RentalRequest[] }) {
  const { t } = useI18n();
  const r = t.notifications.requests;
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (id: string, status: string, msg: string) =>
    start(async () => {
      const res = await updateRequestAction(id, status);
      if (res.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(errorText(t, res.error));
    });
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {rows.map((x) => {
        const p = isoToMadridLocal(x.pickup_at);
        const d = isoToMadridLocal(x.return_at);
        const href = `/rentals/new?${new URLSearchParams({ customer: x.customer_id, date: p.date, until: d.date, pt: p.time, rt: d.time })}`;
        return (
          <div key={x.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/customers/${x.customer_id}`} className="text-sm font-semibold hover:underline">
                  {x.customer}
                </Link>
                <Badge variant={x.status === "new" ? "warning" : "info"}>{r.statuses[x.status]}</Badge>
              </div>
              <p className="mt-1 text-sm tabular">
                {formatDateTime(x.pickup_at)} → {formatDateTime(x.return_at)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {[x.vehicle_preference, x.notes].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 flex flex-wrap gap-x-4 text-xs">
                {x.phone && (
                  <a href={`tel:${x.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-gold-light hover:underline">
                    <Phone className="size-3.5" /> {x.phone}
                  </a>
                )}
                {x.email && (
                  <a href={`mailto:${x.email}`} className="inline-flex items-center gap-1 text-gold-light hover:underline">
                    <Mail className="size-3.5" /> {x.email}
                  </a>
                )}
                <span className="text-subtle">{r.received} {formatDateTime(x.created_at)}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={href}>
                  <CalendarPlus /> {r.createRental}
                </Link>
              </Button>
              {x.status === "new" && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => set(x.id, "contacted", r.updated)}>
                  <Phone /> {r.markContacted}
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => set(x.id, "converted", r.updated)}>
                <Check /> {r.statuses.converted}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => set(x.id, "declined", r.updated)} aria-label={r.markDeclined}>
                <X />
              </Button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
