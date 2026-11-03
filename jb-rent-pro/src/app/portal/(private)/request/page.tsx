import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { getPortalRequests } from "@/lib/portal/queries";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestForm } from "./request-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.portal.request.title };
}

const VARIANT = { new: "info", contacted: "warning", converted: "success", declined: "neutral" } as const;

export default async function PortalRequest() {
  const [{ t }, rows] = await Promise.all([getI18n(), getPortalRequests()]);
  const r = t.portal.request;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{r.title}</h1>
        <p className="mt-1 text-sm text-muted">{r.subtitle}</p>
      </div>
      <Card>
        <CardContent className="p-5">
          <RequestForm />
          <p className="mt-3 text-xs text-subtle">{r.note}</p>
        </CardContent>
      </Card>
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{r.list}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  <span className="tabular">
                    {formatDateTime(x.pickup_at)} → {formatDateTime(x.return_at)}
                  </span>
                  {x.vehicle_preference && <span className="text-muted">· {x.vehicle_preference}</span>}
                  <Badge variant={VARIANT[x.status]} className="ml-auto">
                    {r.statuses[x.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
