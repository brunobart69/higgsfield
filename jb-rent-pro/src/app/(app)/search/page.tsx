import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CarFront, Search, User } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { VehicleStatusBadge } from "@/components/vehicles/status-badge";
import type { VehicleStatus } from "@/lib/vehicles/constants";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.search.title };
}

type Row = { kind: "vehicle" | "customer"; id: string; title: string; subtitle: string | null; status: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim().slice(0, 80);
  let rows: Row[] = [];
  if (q.length >= 2) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("global_search", { p_query: q, p_limit: 20 });
    if (error) console.error("[search] failed", error.code, error.message);
    rows = (data ?? []) as Row[];
  }
  const vehicles = rows.filter((r) => r.kind === "vehicle");
  const customers = rows.filter((r) => r.kind === "customer");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t.search.title} />
      <ListToolbar action="/search" q={q} placeholder={t.search.placeholder} searchLabel={t.nav.search} />
      {q.length < 2 ? (
        <p className="text-sm text-muted">{t.search.hint}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title={interpolate(t.search.empty, { q })} />
      ) : (
        <div className="space-y-6">
          {vehicles.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{t.search.vehicles}</h2>
              <Card className="divide-y divide-border overflow-hidden">
                {vehicles.map((r) => (
                  <Link key={r.id} href={`/vehicles/${r.id}`} className="flex items-center gap-3 p-4 transition hover:bg-surface-2/60">
                    <CarFront className="size-5 shrink-0 text-gold" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
                    <span className="font-mono text-xs">{r.subtitle}</span>
                    <VehicleStatusBadge status={r.status as VehicleStatus} />
                  </Link>
                ))}
              </Card>
            </section>
          )}
          {customers.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">{t.search.customers}</h2>
              <Card className="divide-y divide-border overflow-hidden">
                {customers.map((r) => {
                  const Icon = r.status === "company" ? Building2 : User;
                  return (
                    <Link key={r.id} href={`/customers/${r.id}`} className="flex items-center gap-3 p-4 transition hover:bg-surface-2/60">
                      <Icon className="size-5 shrink-0 text-gold" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        {r.subtitle && <p className="truncate text-xs text-muted">{r.subtitle}</p>}
                      </div>
                    </Link>
                  );
                })}
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
