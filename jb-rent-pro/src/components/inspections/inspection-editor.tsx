"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Fuel, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { formatDate } from "@/lib/format";
import { AREA_GROUPS, CONDITIONS, type Checklist, type Condition, type InspectionArea } from "@/lib/inspections/constants";
import type { InspectionDetail } from "@/lib/inspections/queries";
import type { DamageListItem } from "@/lib/inspections/queries";
import type { FormState } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";
import {
  deleteInspectionPhotoAction,
  discardInspectionAction,
  registerInspectionPhotoAction,
  saveInspectionAction,
} from "@/app/(app)/inspections/actions";
import { AreaPhotos, PhotoViewer } from "./area-photos";

const CONDITION_STYLE: Record<Condition, string> = {
  ok: "border-success/50 bg-success/15 text-success",
  minor: "border-warning/50 bg-warning/15 text-warning",
  damaged: "border-danger/50 bg-danger/15 text-danger",
  not_checked: "border-border-strong bg-surface-3 text-muted",
};

export function InspectionEditor({
  inspection,
  companyId,
  openDamages,
}: {
  inspection: InspectionDetail;
  companyId: string;
  openDamages: DamageListItem[];
}) {
  const { t } = useI18n();
  const it = t.inspections;
  const router = useRouter();
  const [checklist, setChecklist] = useState<Checklist>(inspection.checklist ?? {});
  const [fuel, setFuel] = useState(String(inspection.fuel_level ?? (inspection.inspection_type === "delivery" ? 100 : "")));
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [discarding, startDiscard] = useTransition();
  const [state, action, pending] = useActionState<FormState, FormData>(saveInspectionAction, {});
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message === "completed" ? it.completed : it.saved);
      setConfirmComplete(false);
      router.refresh();
    } else if (state.error || state.fieldErrors) setConfirmComplete(false);
  }, [state, it, router]);

  function setCondition(area: InspectionArea, condition: Condition) {
    setChecklist((c) => ({ ...c, [area]: { ...(c[area] ?? {}), condition } }));
  }
  function setNotes(area: InspectionArea, notes: string) {
    setChecklist((c) => ({ ...c, [area]: { condition: c[area]?.condition ?? "not_checked", notes } }));
  }

  function submit(complete: boolean) {
    const form = document.getElementById("inspection-form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    fd.set("complete", complete ? "1" : "0");
    startTransition(() => action(fd));
  }

  const photosByArea = (area: string) => inspection.photos.filter((p) => p.area === area).map((p) => ({ id: p.id, url: p.url }));
  const pendingAreas = AREA_GROUPS.flatMap((g) => g.areas).filter((a) => !checklist[a] || checklist[a]?.condition === "not_checked").length;

  return (
    <form
      id="inspection-form"
      className="space-y-6 pb-24 lg:pb-0"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <input type="hidden" name="id" value={inspection.id} />
      <input type="hidden" name="checklist" value={JSON.stringify(checklist)} />
      <FormAlert message={errorText(t, state.error, state.vars) ?? (state.fieldErrors?.checklist ? t.errors.invalid : undefined)} />

      <Card>
        <CardContent className="grid gap-5 p-5 sm:grid-cols-2">
          <TextField
            label={it.fields.mileage}
            name="mileage"
            defaultValue={inspection.mileage ?? ""}
            inputMode="numeric"
            required
            error={errorText(t, fe.mileage)}
            hint={inspection.rental?.start_mileage != null && inspection.inspection_type === "return" ? `${t.rentals.info.startMileage}: ${inspection.rental.start_mileage}` : undefined}
          />
          <div className="space-y-1.5">
            <label htmlFor="fuel" className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted">
              <Fuel className="size-3.5" /> {it.fields.fuel}
            </label>
            <div className="flex items-center gap-3">
              <input
                id="fuel-range"
                type="range"
                min={0}
                max={100}
                step={5}
                value={fuel === "" ? 50 : Number(fuel)}
                onChange={(e) => setFuel(e.target.value)}
                className={cn("h-11 flex-1 accent-[var(--gold)]", fuel === "" && "opacity-40")}
                aria-label={it.fields.fuel}
              />
              <Input id="fuel" name="fuel_level" placeholder="—" value={fuel} onChange={(e) => setFuel(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" className="w-20 text-center" aria-invalid={fe.fuel_level ? true : undefined} />
            </div>
            {fe.fuel_level && (
              <p role="alert" className="text-xs text-danger">
                {errorText(t, fe.fuel_level)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-subtle">{it.checklistHint}</p>

      {AREA_GROUPS.map((group) => (
        <Card key={group.key}>
          <CardHeader>
            <CardTitle>{it.groups[group.key]}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {group.areas.map((area) => {
              const entry = checklist[area];
              const cond = entry?.condition ?? "not_checked";
              return (
                <div key={area} className="space-y-3 px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium">{it.areas[area]}</p>
                    <div role="radiogroup" aria-label={it.areas[area]} className="grid grid-cols-4 gap-1.5 sm:w-[26rem]">
                      {CONDITIONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={cond === c}
                          onClick={() => setCondition(area, c)}
                          className={cn(
                            "h-11 rounded-md border px-1 text-[0.72rem] font-medium transition",
                            cond === c ? CONDITION_STYLE[c] : "border-border bg-surface-2 text-muted hover:text-foreground",
                          )}
                        >
                          {it.conditions[c]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(cond === "minor" || cond === "damaged" || entry?.notes) && (
                    <Input
                      value={entry?.notes ?? ""}
                      onChange={(e) => setNotes(area, e.target.value)}
                      placeholder={it.fields.notes}
                      aria-label={`${it.fields.notes}: ${it.areas[area]}`}
                      maxLength={500}
                    />
                  )}
                  <AreaPhotos
                    photos={photosByArea(area)}
                    companyId={companyId}
                    vehicleId={inspection.vehicle_id}
                    folder={`inspections/${inspection.id}`}
                    register={(path, size) => registerInspectionPhotoAction({ inspection_id: inspection.id, path, area, size_bytes: size })}
                    remove={deleteInspectionPhotoAction}
                    label={it.areas[area]}
                    onOpen={setViewer}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>{it.existingDamages}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {openDamages.length === 0 ? (
            <p className="text-sm text-muted">{it.noExistingDamages}</p>
          ) : (
            <ul className="space-y-2">
              {openDamages.map((d) => (
                <li key={d.id} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <Link href={`/damages/${d.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="font-medium">{t.damages.categories[d.category]}</span>
                    {d.area && <span className="text-muted"> · {it.areas[d.area as InspectionArea]}</span>}
                    <span className="block truncate text-xs text-muted">{d.description}</span>
                  </Link>
                  <span className="text-xs text-subtle tabular">{formatDate(d.detected_at)}</span>
                </li>
              ))}
            </ul>
          )}
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3.5 text-sm">
            <input type="checkbox" name="existing_damages_confirmed" defaultChecked={inspection.existing_damages_confirmed} className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]" />
            {it.fields.existingConfirmed}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <AreaPhotos
            photos={photosByArea("general")}
            companyId={companyId}
            vehicleId={inspection.vehicle_id}
            folder={`inspections/${inspection.id}`}
            register={(path, size) => registerInspectionPhotoAction({ inspection_id: inspection.id, path, area: "general", size_bytes: size })}
            remove={deleteInspectionPhotoAction}
            label={it.areas.general}
            onOpen={setViewer}
          />
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3.5 text-sm">
            <input type="checkbox" name="customer_present" defaultChecked={inspection.customer_present} className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]" />
            {it.fields.customerPresent}
          </label>
          <TextField label={it.fields.customerName} name="customer_name" defaultValue={inspection.customer_name ?? inspection.rental?.customer ?? ""} optionalLabel={t.common.optional} />
          <TextAreaField label={it.fields.observations} name="observations" defaultValue={inspection.observations ?? ""} rows={3} optionalLabel={t.common.optional} />
        </CardContent>
      </Card>

      {/* barra de ações fixa no celular (alcance do polegar) */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-xl lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2">
          {pendingAreas > 0 && (
            <Badge variant="neutral" className="mr-auto hidden sm:inline-flex">
              {pendingAreas} × {it.conditions.not_checked}
            </Badge>
          )}
          <Button type="button" variant="ghost" size="icon" className="shrink-0 text-danger sm:w-auto sm:px-4" onClick={() => setConfirmDiscard(true)} disabled={pending} aria-label={it.discard}>
            <Trash2 /> <span className="hidden sm:inline">{it.discard}</span>
          </Button>
          <Button type="submit" variant="secondary" className="flex-1 sm:flex-none" loading={pending && !confirmComplete}>
            {it.saveDraft}
          </Button>
          <Button type="button" className="flex-1 sm:flex-none" onClick={() => setConfirmComplete(true)} disabled={pending}>
            <CheckCircle2 className="hidden min-[400px]:block" /> {it.complete}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title={it.completeTitle}
        description={`${it.completeBody}${inspection.inspection_type === "delivery" && inspection.rental && ["reservation", "confirmed"].includes(inspection.rental.status) ? ` ${it.completeDeliveryBody}` : ""}`}
        confirmLabel={it.complete}
        pending={pending}
        onConfirm={() => submit(true)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={it.discardTitle}
        destructive
        confirmLabel={it.discard}
        pending={discarding}
        onConfirm={() =>
          startDiscard(async () => {
            const res = await discardInspectionAction(inspection.id);
            if (res.ok) {
              toast.success(it.discarded);
              router.push(inspection.rental ? `/rentals/${inspection.rental.id}` : `/vehicles/${inspection.vehicle_id}?tab=inspections`);
            } else toast.error(errorText(t, res.error));
            setConfirmDiscard(false);
          })
        }
      />
      <PhotoViewer url={viewer} onClose={() => setViewer(null)} closeLabel={t.common.close} />
    </form>
  );
}
