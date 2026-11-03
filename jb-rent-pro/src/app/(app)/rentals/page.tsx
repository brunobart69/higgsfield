import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { countRentalsByStatus, listRentals } from "@/lib/rentals/queries";
import { RENTALS_PAGE_SIZE } from "@/lib/rentals/constants";
import { parsePage } from "@/lib/search";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Pagination } from "@/components/ui/pagination";
import { Forbidden } from "@/components/layout/forbidden";
import { RentalStatusBadge } from "@/components/rentals/rental-status-badge";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.rentals.title };
}

type SP = { q?: string; status?: string; page?: string };
const FILTERS = ["active", "reservation", "confirmed", "in_progress", "late", "completed", "cancelled"] as const;

function href(base: SP, patch: Partial<SP>) {
  const p = new URLSearchParams();
  Object.entries({ ...base, ...patch }).forEach(([k, v]) => v && p.set(k, v));
  const s = p.toString();
  return s ? `/rentals?${s}` : "/rentals";
}

export default async function RentalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const page = parsePage(sp.page);
  const status = (FILTERS as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const [result, counts] = await Promise.all([listRentals({ q: sp.q, status, page }), countRentalsByStatus()]);
  const totalPages = result.ok ? Math.max(1, Math.ceil(result.total / RENTALS_PAGE_SIZE)) : 1;
  const r = t.rentals;
  const count = (k: string) =>
    k === "active" ? (counts.confirmed ?? 0) + (counts.in_progress ?? 0) + (counts.late ?? 0) : k === "late" ? (counts.late_derived ?? 0) : (counts[k] ?? 0);
  const label = (k: string) => (k === "active" ? t.dashboard.kpis.activeContracts : t.rentalStatus[k as keyof typeof t.rentalStatus]);

  const chips = [
    { label: t.common.all, href: href({ q: sp.q }, {}), active: !status },
    ...FILTERS.filter((k) => count(k) > 0 || status === k).map((k) => ({ label: label(k), href: href({ q: sp.q }, { status: k }), active: status === k, count: count(k) })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.operations}
        title={r.title}
        description={r.subtitle}
        actions={
          <Button asChild>
            <Link href="/rentals/new">
              <Plus /> {r.new}
            </Link>
          </Button>
        }
      />
      <ListToolbar action="/rentals" q={sp.q} placeholder={r.searchPlaceholder} searchLabel={t.common.search} hidden={{ status }} chips={chips} />

      {!result.ok ? (
        <Forbidden message={t.errors.loadFailed} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={FileSignature} title={sp.q || status ? r.noResults : r.empty}>
          {!sp.q && !status && (
            <Button asChild>
              <Link href="/rentals/new">
                <Plus /> {r.new}
              </Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-subtle">{interpolate(t.common.results, { n: result.total })}</p>
          <Card className="divide-y divide-border overflow-hidden">
            {result.items.map((x) => (
              <Link key={x.id} href={`/rentals/${x.id}`} className="grid gap-2 p-4 transition hover:bg-surface-2/60 sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-4 sm:px-5">
                <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
                  <span className="font-mono text-xs">{x.contract_number}</span>
                  <RentalStatusBadge status={x.status} returnAt={x.return_at} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{x.customer}</p>
                  <p className="truncate text-xs text-muted">
                    {x.vehicle} · <span className="font-mono">{x.plate}</span>
                  </p>
                  <p className="text-xs text-subtle tabular">
                    {formatDateTime(x.pickup_at)} → {formatDateTime(x.return_at)}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular sm:text-right">{formatCurrency(x.total_amount, locale)}</span>
              </Link>
            ))}
          </Card>
          <Pagination
            page={page}
            totalPages={totalPages}
            hrefFor={(p) => href({ q: sp.q, status }, { page: String(p) })}
            labels={{ previous: t.common.previous, next: t.common.next, page: interpolate(t.common.page, { page, total: totalPages }) }}
          />
        </>
      )}
    </div>
  );
}
