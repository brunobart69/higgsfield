import type { Metadata } from "next";
import Link from "next/link";
import { Info, ShieldCheck } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { listDeposits } from "@/lib/rentals/queries";
import { RENTALS_PAGE_SIZE } from "@/lib/rentals/constants";
import { parsePage } from "@/lib/search";
import { formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Forbidden } from "@/components/layout/forbidden";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.deposits.title };
}

const VARIANT = { not_received: "warning", held: "info", settled: "success" } as const;

export default async function DepositsPage({ searchParams }: { searchParams: Promise<{ all?: string; page?: string }> }) {
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const all = sp.all === "1";
  const page = parsePage(sp.page);
  const res = await listDeposits({ pendingOnly: !all, page });
  const d = t.deposits;
  const totalPages = res.ok ? Math.max(1, Math.ceil(res.total / RENTALS_PAGE_SIZE)) : 1;
  const held = res.ok ? res.items.filter((x) => x.status === "held").reduce((a, x) => a + Math.round(x.balance * 100), 0) / 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.operations} title={d.title} description={d.subtitle} />
      <p className="flex items-start gap-2 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-gold" /> {d.notIncome}
      </p>
      <div className="flex gap-1.5">
        {[
          { label: d.pendingOnly, href: "/deposits", active: !all },
          { label: d.all, href: "/deposits?all=1", active: all },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            aria-current={c.active ? "true" : undefined}
            className={
              c.active
                ? "inline-flex h-9 items-center rounded-full border border-gold/50 bg-gold/15 px-3.5 text-xs font-medium text-gold-light"
                : "inline-flex h-9 items-center rounded-full border border-border bg-surface-2 px-3.5 text-xs font-medium text-muted hover:text-foreground"
            }
          >
            {c.label}
          </Link>
        ))}
      </div>
      {!res.ok ? (
        <Forbidden message={t.errors.loadFailed} />
      ) : res.items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={d.empty} />
      ) : (
        <>
          {!all && held > 0 && (
            <p className="text-sm">
              {d.balance}: <span className="font-semibold text-gold-light tabular">{formatCurrency(held, locale)}</span>
            </p>
          )}
          <Card className="divide-y divide-border overflow-hidden">
            {res.items.map((x) => (
              <Link key={x.id} href={`/rentals/${x.rental_id}`} className="grid gap-2 p-4 transition hover:bg-surface-2/60 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{x.contract_number}</span>
                    <Badge variant={VARIANT[x.status]}>{d.status[x.status]}</Badge>
                    <Badge variant="neutral">{t.rentalStatus[x.rental_status]}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm">
                    {x.customer} · <span className="font-mono text-xs text-muted">{x.plate}</span>
                  </p>
                </div>
                <dl className="grid grid-cols-4 gap-3 text-xs tabular sm:text-right">
                  <div>
                    <dt className="text-subtle">{d.agreed}</dt>
                    <dd>{formatCurrency(x.agreed, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">{d.received}</dt>
                    <dd>{formatCurrency(x.received, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">{d.retained}</dt>
                    <dd>{formatCurrency(x.retained, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">{d.balance}</dt>
                    <dd className="font-semibold text-gold-light">{formatCurrency(x.balance, locale)}</dd>
                  </div>
                </dl>
              </Link>
            ))}
          </Card>
          <Pagination
            page={page}
            totalPages={totalPages}
            hrefFor={(p) => `/deposits?${all ? "all=1&" : ""}page=${p}`}
            labels={{ previous: t.common.previous, next: t.common.next, page: interpolate(t.common.page, { page, total: totalPages }) }}
          />
        </>
      )}
    </div>
  );
}
