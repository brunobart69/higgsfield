import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Info, Lock } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";
import { DOCS_PAGE_SIZE, getDocumentLinkOptions, listCenterDocuments, type DocFilter } from "@/lib/documents/queries";
import { DOCUMENT_CATEGORIES } from "@/lib/validation/documents";
import { CUSTOMER_DOC_TYPES } from "@/lib/customers/constants";
import { parsePage } from "@/lib/search";
import { todayInMadrid } from "@/lib/periods";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { CenterUploader } from "@/components/documents/center-uploader";
import { CenterList } from "@/components/documents/center-list";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.docsCenter.title };
}

const STATUSES = ["all", "expiring", "expired", "retention"] as const;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; q?: string; category?: string; status?: string; page?: string }>;
}) {
  const [{ t }, sp, session] = await Promise.all([getI18n(), searchParams, getSession()]);
  if (session.status !== "ok") return null;
  const d = t.docsCenter;
  const scope: DocFilter["scope"] = sp.scope === "customers" ? "customers" : "company";
  const cats: readonly string[] = scope === "customers" ? CUSTOMER_DOC_TYPES : DOCUMENT_CATEGORIES;
  const category = sp.category && cats.includes(sp.category) ? sp.category : undefined;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") && sp.status !== "all" ? (sp.status as DocFilter["status"]) : undefined;
  const page = parsePage(sp.page);
  const today = todayInMadrid();
  const isOwner = session.profile.role === "owner";
  const [res, opts] = await Promise.all([listCenterDocuments({ scope, q: sp.q, category, status, page }), scope === "company" ? getDocumentLinkOptions() : null]);
  const totalPages = Math.max(1, Math.ceil(res.total / DOCS_PAGE_SIZE));

  const href = (over: Record<string, string | undefined>) => {
    const p = { scope: scope === "customers" ? "customers" : undefined, q: sp.q, category, status, ...over };
    const qs = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
    return `/documents${qs.size ? `?${qs}` : ""}`;
  };
  const catLabel = (c: string) =>
    scope === "customers" ? (t.customers.docs.types[c as keyof typeof t.customers.docs.types] ?? c) : (d.categories[c as keyof typeof d.categories] ?? c);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.fleet}
        title={d.title}
        description={d.subtitle}
        actions={opts && <CenterUploader companyId={session.profile.companyId} vehicles={opts.vehicles} rentals={opts.rentals} />}
      />
      <TabsNav
        active={scope}
        tabs={[
          { key: "company", label: d.scopes.company, href: "/documents" },
          { key: "customers", label: d.scopes.customers, href: "/documents?scope=customers" },
        ]}
      />
      {scope === "customers" && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <Lock className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /> {d.privacy}
        </p>
      )}
      <ListToolbar
        action="/documents"
        q={sp.q}
        placeholder={t.common.search}
        searchLabel={t.common.search}
        hidden={{ scope: scope === "customers" ? "customers" : undefined, category, status }}
        chips={STATUSES.map((s) => ({ label: d.statuses[s], href: href({ status: s === "all" ? undefined : s, page: undefined }), active: (status ?? "all") === s }))}
      />
      <div className="scrollbar-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {[undefined, ...cats].map((c) => (
          <Link
            key={c ?? "all"}
            scroll={false}
            href={href({ category: c, page: undefined })}
            aria-current={category === c ? "true" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-xs transition-colors",
              category === c ? "border-gold/50 text-gold-light" : "border-border text-subtle hover:text-foreground",
            )}
          >
            {c ? catLabel(c) : d.allCategories}
          </Link>
        ))}
      </div>
      {status === "retention" && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-4 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /> {d.retentionHint}
        </p>
      )}
      {res.items.length === 0 ? (
        <EmptyState icon={FileText} title={d.empty} />
      ) : (
        <>
          <CenterList
            kind={scope === "customers" ? "customer-doc" : "vehicle-doc"}
            today={today}
            isOwner={isOwner}
            rows={res.items.map((x) => {
              const ended = !!x.retention_until && x.retention_until < today;
              return {
                id: x.id,
                label: x.title,
                typeLabel: catLabel(x.category),
                mime_type: x.mime_type,
                size_bytes: x.size_bytes,
                expires_at: x.expires_at,
                created_at: x.created_at,
                link: x.link,
                note: [
                  x.link ? null : d.general,
                  x.retention_until ? (ended ? d.retentionEnded : interpolate(d.retentionUntil, { date: formatDate(x.retention_until) })) : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                noteTone: ended ? "warning" : "muted",
                deletable: scope === "customers" || ended,
              };
            })}
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            hrefFor={(p) => href({ page: String(p) })}
            labels={{ previous: t.common.previous, next: t.common.next, page: interpolate(t.common.page, { page, total: totalPages }) }}
          />
        </>
      )}
    </div>
  );
}
