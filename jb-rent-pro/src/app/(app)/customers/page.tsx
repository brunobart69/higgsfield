import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus, User, Users } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { customerName, listCustomers } from "@/lib/customers/queries";
import { CUSTOMERS_PAGE_SIZE } from "@/lib/customers/constants";
import { parsePage } from "@/lib/search";
import { todayInMadrid } from "@/lib/periods";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Pagination } from "@/components/ui/pagination";
import { Forbidden } from "@/components/layout/forbidden";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.customers.title };
}

type SP = { q?: string; type?: string; archived?: string; page?: string };

function href(base: SP, patch: Partial<SP>) {
  const p = new URLSearchParams();
  Object.entries({ ...base, ...patch }).forEach(([k, v]) => v && p.set(k, v));
  const s = p.toString();
  return s ? `/customers?${s}` : "/customers";
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const page = parsePage(sp.page);
  const archived = sp.archived === "1";
  const result = await listCustomers({ q: sp.q, type: sp.type, archived, page });
  const base: SP = { q: sp.q, type: sp.type, archived: sp.archived };
  const totalPages = result.ok ? Math.max(1, Math.ceil(result.total / CUSTOMERS_PAGE_SIZE)) : 1;
  const today = todayInMadrid();
  const c = t.customers;

  const chips = [
    { label: t.common.all, href: href({ q: sp.q }, {}), active: !sp.type && !archived },
    { label: c.types.individual, href: href({ q: sp.q }, { type: "individual" }), active: sp.type === "individual" && !archived },
    { label: c.types.company, href: href({ q: sp.q }, { type: "company" }), active: sp.type === "company" && !archived },
    { label: t.common.showArchived, href: href({ q: sp.q }, { archived: "1" }), active: archived },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.operations}
        title={c.title}
        description={c.subtitle}
        actions={
          <Button asChild>
            <Link href="/customers/new">
              <Plus /> {c.new}
            </Link>
          </Button>
        }
      />
      <ListToolbar
        action="/customers"
        q={sp.q}
        placeholder={c.searchPlaceholder}
        searchLabel={t.common.search}
        hidden={{ type: sp.type, archived: sp.archived }}
        chips={chips}
      />

      {!result.ok ? (
        <Forbidden message={t.errors.loadFailed} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={Users} title={sp.q || sp.type || archived ? c.noResults : c.empty}>
          {!sp.q && !sp.type && !archived && (
            <Button asChild>
              <Link href="/customers/new">
                <Plus /> {c.new}
              </Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-subtle">{interpolate(t.common.results, { n: result.total })}</p>
          <Card className="divide-y divide-border overflow-hidden">
            {result.items.map((cu) => {
              const Icon = cu.customer_type === "company" ? Building2 : User;
              const doc = cu.customer_type === "company" ? cu.tax_id : cu.id_document_number;
              const licenceExpired = cu.driving_licence_expiry !== null && cu.driving_licence_expiry < today;
              return (
                <Link key={cu.id} href={`/customers/${cu.id}`} className="flex items-center gap-3 p-4 transition hover:bg-surface-2/60 sm:px-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-gold">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{customerName(cu)}</p>
                      <Badge variant="neutral">{c.types[cu.customer_type]}</Badge>
                      {licenceExpired && <Badge variant="danger">{c.licenceExpired}</Badge>}
                      {cu.anonymized_at && <Badge variant="neutral">RGPD</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted">{[doc, cu.phone, cu.email, cu.city].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                </Link>
              );
            })}
          </Card>
          <Pagination
            page={page}
            totalPages={totalPages}
            hrefFor={(p) => href(base, { page: String(p) })}
            labels={{ previous: t.common.previous, next: t.common.next, page: interpolate(t.common.page, { page, total: totalPages }) }}
          />
        </>
      )}
    </div>
  );
}
