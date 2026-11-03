import type { Metadata } from "next";
import Link from "next/link";
import { CarFront, Plus } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { countVehiclesByStatus, listVehicles } from "@/lib/vehicles/queries";
import { VEHICLES_PAGE_SIZE, VEHICLE_STATUSES } from "@/lib/vehicles/constants";
import { parsePage } from "@/lib/search";
import { todayInMadrid } from "@/lib/periods";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Pagination } from "@/components/ui/pagination";
import { Forbidden } from "@/components/layout/forbidden";
import { VehicleCard } from "@/components/vehicles/vehicle-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.vehicles.title };
}

type SP = { q?: string; status?: string; archived?: string; page?: string };

function href(base: SP, patch: Partial<SP>) {
  const p = new URLSearchParams();
  Object.entries({ ...base, ...patch }).forEach(([k, v]) => v && p.set(k, v));
  const s = p.toString();
  return s ? `/vehicles?${s}` : "/vehicles";
}

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const page = parsePage(sp.page);
  const archived = sp.archived === "1";
  const [result, counts] = await Promise.all([
    listVehicles({ q: sp.q, status: sp.status, archived, page }),
    countVehiclesByStatus(),
  ]);
  const base: SP = { q: sp.q, status: sp.status, archived: sp.archived };
  const totalPages = result.ok ? Math.max(1, Math.ceil(result.total / VEHICLES_PAGE_SIZE)) : 1;
  const today = todayInMadrid();

  const chips = [
    { label: t.common.all, href: href({ q: sp.q }, {}), active: !sp.status && !archived, count: counts.all ?? 0 },
    ...VEHICLE_STATUSES.filter((s) => (counts[s] ?? 0) > 0 || sp.status === s).map((s) => ({
      label: t.vehicles.status[s],
      href: href({ q: sp.q }, { status: s }),
      active: sp.status === s && !archived,
      count: counts[s] ?? 0,
    })),
    { label: t.common.showArchived, href: href({ q: sp.q }, { archived: "1" }), active: archived },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.fleet}
        title={t.vehicles.title}
        description={t.vehicles.subtitle}
        actions={
          <Button asChild>
            <Link href="/vehicles/new">
              <Plus /> {t.vehicles.new}
            </Link>
          </Button>
        }
      />
      <ListToolbar
        action="/vehicles"
        q={sp.q}
        placeholder={t.vehicles.searchPlaceholder}
        searchLabel={t.common.search}
        hidden={{ status: sp.status, archived: sp.archived }}
        chips={chips}
      />

      {!result.ok ? (
        <Forbidden message={t.errors.loadFailed} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CarFront} title={sp.q || sp.status || archived ? t.vehicles.noResults : t.vehicles.empty}>
          {!sp.q && !sp.status && !archived && (
            <Button asChild>
              <Link href="/vehicles/new">
                <Plus /> {t.vehicles.new}
              </Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-subtle">{interpolate(t.common.results, { n: result.total })}</p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {result.items.map((v) => (
              <li key={v.id}>
                <VehicleCard v={v} today={today} />
              </li>
            ))}
          </ul>
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
