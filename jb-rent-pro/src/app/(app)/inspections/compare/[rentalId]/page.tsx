import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileDown } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getInspection, getRentalInspections, listDamages } from "@/lib/inspections/queries";
import { getRental } from "@/lib/rentals/queries";
import { compareInspections, suggestCategory } from "@/lib/inspections/constants";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DamageDialog } from "@/components/inspections/damage-dialog";
import { DamageList } from "@/components/inspections/lists";
import { CONDITION_VARIANT } from "@/components/inspections/inspection-view";
import { PhaseNotice } from "@/components/ui/phase-notice";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.inspections.compareTitle };
}

export default async function ComparePage({ params }: { params: Promise<{ rentalId: string }> }) {
  const [{ t, locale }, { rentalId }] = await Promise.all([getI18n(), params]);
  const [rental, pair] = await Promise.all([getRental(rentalId), getRentalInspections(rentalId)]);
  if (!rental) notFound();
  const it = t.inspections;
  const ready = pair.delivery?.status === "completed" && pair.return?.status === "completed";
  const [del, ret, damages] = await Promise.all([
    pair.delivery ? getInspection(pair.delivery.id) : null,
    pair.return ? getInspection(pair.return.id) : null,
    listDamages({ rentalId, limit: 50 }),
  ]);
  const cmp = ready && del && ret ? compareInspections(del, ret) : null;
  const photos = (insp: typeof del, area: string) => (insp?.photos ?? []).filter((p) => p.area === area);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href={`/rentals/${rentalId}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {rental.contract_number}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gold">{rental.contract_number}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{it.compareTitle}</h1>
          <p className="text-sm text-muted">
            {rental.vehicle.brand} {rental.vehicle.model} · <span className="font-mono">{rental.vehicle.plate}</span>
          </p>
        </div>
        {cmp && (
          <Button asChild variant="secondary">
            <a href={`/api/rentals/${rentalId}/inspection-report?lang=${locale}`} target="_blank" rel="noopener noreferrer">
              <FileDown /> {it.report}
            </a>
          </Button>
        )}
      </div>

      {!cmp || !del || !ret ? (
        <PhaseNotice text={`${it.before}: ${pair.delivery ? it.status[pair.delivery.status] : it.missingInspection} · ${it.after}: ${pair.return ? it.status[pair.return.status] : it.missingInspection}`} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <KpiCard label={it.driven} value={cmp.drivenKm !== null ? `${formatNumber(cmp.drivenKm, locale)} ${t.common.km}` : "—"} icon={CheckCircle2} />
            <KpiCard
              label={it.fuelDiff}
              value={cmp.fuelDiff !== null ? `${cmp.fuelDiff > 0 ? "+" : ""}${cmp.fuelDiff} %` : "—"}
              icon={CheckCircle2}
              tone={cmp.fuelDiff !== null && cmp.fuelDiff < 0 ? "warning" : "neutral"}
            />
            <KpiCard
              label={it.worsened}
              value={formatNumber(cmp.worsened.length, locale)}
              icon={AlertTriangle}
              tone={cmp.worsened.length ? "danger" : "success"}
              className="col-span-2 md:col-span-1"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{cmp.worsened.length ? interpolate(it.differences, { n: cmp.worsened.length }) : it.noDifferences}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {cmp.areas
                .filter((a) => a.before !== "not_checked" || a.after !== "not_checked")
                .sort((a, b) => Number(b.worsened) - Number(a.worsened))
                .map((a) => (
                  <div key={a.area} className={cn("grid gap-3 px-5 py-4 md:grid-cols-[12rem_1fr_1fr_auto] md:items-start", a.worsened && "bg-danger/5")}>
                    <div className="flex items-center gap-2">
                      {a.worsened && <AlertTriangle className="size-4 text-danger" />}
                      <p className="text-sm font-medium">{it.areas[a.area]}</p>
                    </div>
                    {(
                      [
                        [it.before, a.before, a.beforeNotes, photos(del, a.area)],
                        [it.after, a.after, a.afterNotes, photos(ret, a.area)],
                      ] as const
                    ).map(([label, cond, notes, ph]) => (
                      <div key={label} className="min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-subtle">{label}</span>
                          <Badge variant={CONDITION_VARIANT[cond]}>{it.conditions[cond]}</Badge>
                        </div>
                        {notes && <p className="text-xs text-muted">{notes}</p>}
                        {ph.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {ph.slice(0, 4).map((p) =>
                              p.url ? (
                                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="size-16 overflow-hidden rounded-md border border-border">
                                  {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária */}
                                  <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                                </a>
                              ) : null,
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    <div>
                      {a.worsened && (
                        <DamageDialog
                          size="sm"
                          label={it.registerDamage}
                          values={{
                            vehicle_id: rental.vehicle_id,
                            rental_id: rentalId,
                            inspection_id: ret.id,
                            area: a.area,
                            category: suggestCategory(a.area),
                            severity: a.after === "damaged" ? "medium" : "low",
                            description: a.afterNotes ?? "",
                            mileage: ret.mileage,
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.damages.title}</CardTitle>
        </CardHeader>
        <CardContent>{damages.items.length === 0 ? <p className="text-sm text-muted">{t.damages.empty}</p> : <DamageList items={damages.items} showVehicle={false} />}</CardContent>
      </Card>
    </div>
  );
}
