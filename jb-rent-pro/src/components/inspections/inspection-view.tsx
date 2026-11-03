"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { AREA_GROUPS, type Condition } from "@/lib/inspections/constants";
import type { InspectionDetail } from "@/lib/inspections/queries";
import { PhotoViewer } from "./area-photos";

export const CONDITION_VARIANT: Record<Condition, "success" | "warning" | "danger" | "neutral"> = {
  ok: "success",
  minor: "warning",
  damaged: "danger",
  not_checked: "neutral",
};

/** Inspeção concluída (somente leitura): checklist por área com fotos. */
export function InspectionView({ inspection }: { inspection: InspectionDetail }) {
  const { t } = useI18n();
  const it = t.inspections;
  const [viewer, setViewer] = useState<string | null>(null);
  const photos = (area: string) => inspection.photos.filter((p) => p.area === area);

  return (
    <div className="space-y-6">
      {AREA_GROUPS.map((g) => (
        <Card key={g.key}>
          <CardHeader>
            <CardTitle>{it.groups[g.key]}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {g.areas.map((area) => {
              const e = inspection.checklist[area];
              const c = (e?.condition ?? "not_checked") as Condition;
              return (
                <div key={area} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{it.areas[area]}</p>
                      <Badge variant={CONDITION_VARIANT[c]}>{it.conditions[c]}</Badge>
                    </div>
                    {e?.notes && <p className="mt-1 text-xs text-muted">{e.notes}</p>}
                  </div>
                  {photos(area).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {photos(area).map((p) => (
                        <button key={p.id} type="button" onClick={() => p.url && setViewer(p.url)} className="size-16 overflow-hidden rounded-md border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária */}
                          {p.url && <img src={p.url} alt={it.areas[area]} className="h-full w-full object-cover" loading="lazy" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
      {photos("general").length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{it.areas.general}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {photos("general").map((p) => (
              <button key={p.id} type="button" onClick={() => p.url && setViewer(p.url)} className="size-24 overflow-hidden rounded-md border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária */}
                {p.url && <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </button>
            ))}
          </CardContent>
        </Card>
      )}
      <PhotoViewer url={viewer} onClose={() => setViewer(null)} closeLabel={t.common.close} />
    </div>
  );
}
