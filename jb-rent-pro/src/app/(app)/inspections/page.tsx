import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { errorText } from "@/lib/i18n/errors";
import { PAGE_SIZE, listDamages, listInspections } from "@/lib/inspections/queries";
import { parsePage } from "@/lib/search";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Pagination } from "@/components/ui/pagination";
import { TabsNav } from "@/components/ui/tabs-nav";
import { DamageList, InspectionList } from "@/components/inspections/lists";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.inspections.title };
}

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ tab?: string; all?: string; page?: string; error?: string }> }) {
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const tab = sp.tab === "damages" ? "damages" : "inspections";
  const page = parsePage(sp.page);
  const openOnly = sp.all !== "1";
  const it = t.inspections;

  const data = tab === "damages" ? await listDamages({ openOnly, page }) : await listInspections({ page });
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const base = tab === "damages" ? `/inspections?tab=damages${openOnly ? "" : "&all=1"}` : "/inspections?tab=inspections";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.operations} title={it.title} description={it.subtitle} />
      {sp.error && <FormAlert message={errorText(t, sp.error)} />}
      <TabsNav
        active={tab}
        tabs={[
          { key: "inspections", label: it.tabs.inspections, href: "/inspections?tab=inspections" },
          { key: "damages", label: it.tabs.damages, href: "/inspections?tab=damages" },
        ]}
      />
      {tab === "damages" && (
        <div className="flex gap-1.5">
          {[
            { label: t.damages.openOnly, href: "/inspections?tab=damages", active: openOnly },
            { label: t.damages.all, href: "/inspections?tab=damages&all=1", active: !openOnly },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium",
                c.active ? "border-gold/50 bg-gold/15 text-gold-light" : "border-border bg-surface-2 text-muted hover:text-foreground",
              )}
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
      {data.items.length === 0 ? (
        <EmptyState icon={tab === "damages" ? AlertTriangle : ClipboardCheck} title={tab === "damages" ? t.damages.empty : it.empty} />
      ) : tab === "damages" ? (
        <DamageList items={data.items as Awaited<ReturnType<typeof listDamages>>["items"]} />
      ) : (
        <InspectionList items={data.items as Awaited<ReturnType<typeof listInspections>>["items"]} />
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        hrefFor={(p) => `${base}&page=${p}`}
        labels={{ previous: t.common.previous, next: t.common.next, page: interpolate(t.common.page, { page, total: totalPages }) }}
      />
    </div>
  );
}
