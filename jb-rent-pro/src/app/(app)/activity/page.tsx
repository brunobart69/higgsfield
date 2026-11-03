import type { Metadata } from "next";
import { History } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";
import { listCompanyUsers } from "@/lib/users/queries";
import { ACTIVITY_ACTIONS, ACTIVITY_PAGE_SIZE, listActivity, sanitizeFilters } from "@/lib/activity/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Forbidden } from "@/components/layout/forbidden";
import { ActivityFiltersForm } from "@/components/activity/activity-filters";
import { ActivityList } from "@/components/activity/activity-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.activity.title };
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ t }, session, raw] = await Promise.all([getI18n(), getSession(), searchParams]);
  if (session.status !== "ok") return <Forbidden message={t.errors.forbidden} />;
  const isOwner = session.profile.role === "owner";

  const filters = sanitizeFilters(raw);
  const [result, usersRes] = await Promise.all([listActivity(filters), listCompanyUsers()]);
  const users = usersRes.ok ? usersRes.users : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.fullName ?? u.email]));

  const totalPages = result.ok ? Math.max(1, Math.ceil(result.total / ACTIVITY_PAGE_SIZE)) : 1;
  const hrefFor = (page: number) => {
    const p = new URLSearchParams();
    Object.entries({ ...raw, page: String(page) }).forEach(([k, v]) => v && p.set(k, v));
    return `/activity?${p.toString()}`;
  };

  const entities = Object.keys(t.activity.entities);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.admin} title={t.activity.title} description={t.activity.subtitle} />
      {!isOwner && <p className="text-sm text-muted">{t.activity.ownOnly}</p>}

      <ActivityFiltersForm
        filters={filters}
        users={isOwner ? users.map((u) => ({ id: u.id, name: u.fullName ?? u.email })) : []}
        entities={entities}
        actions={[...ACTIVITY_ACTIONS]}
      />

      {!result.ok ? (
        <Forbidden message={t.errors.loadFailed} />
      ) : result.rows.length === 0 ? (
        <EmptyState icon={History} title={t.activity.empty} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ActivityList rows={result.rows} names={names} />
          </CardContent>
        </Card>
      )}

      {result.ok && (
        <Pagination
          page={filters.page}
          totalPages={totalPages}
          hrefFor={hrefFor}
          labels={{
            previous: t.common.previous,
            next: t.common.next,
            page: interpolate(t.common.page, { page: filters.page, total: totalPages }),
          }}
        />
      )}
    </div>
  );
}
