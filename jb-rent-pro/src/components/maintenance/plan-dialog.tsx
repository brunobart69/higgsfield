"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { MAINTENANCE_TYPES, type MaintenanceType } from "@/lib/maintenance/constants";
import { todayInMadrid } from "@/lib/periods";
import { savePlanAction } from "@/app/(app)/maintenance/actions";

export type PlanFormValues = {
  id?: string;
  vehicle_id?: string;
  name?: string;
  maintenance_type?: MaintenanceType;
  interval_km?: number | null;
  interval_months?: number | null;
  last_done_date?: string | null;
  last_done_mileage?: number | null;
  notes?: string | null;
};

function Fields({ v, vehicles }: { v: PlanFormValues; vehicles?: Array<{ value: string; label: string; mileage: number }> }) {
  const { t } = useI18n();
  const p = t.maintenance.plans;
  const err = useFieldError();
  const opt = t.common.optional;
  const [vehicle, setVehicle] = useState(v.vehicle_id ?? "");
  const km = v.last_done_mileage ?? vehicles?.find((x) => x.value === vehicle)?.mileage ?? "";
  return (
    <>
      <input type="hidden" name="id" value={v.id ?? ""} />
      {vehicles && !v.id ? (
        <SelectField
          label={t.maintenance.fields.vehicle}
          name="vehicle_id"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          required
          error={err("vehicle_id")}
          options={[{ value: "", label: "—" }, ...vehicles.map(({ value, label }) => ({ value, label }))]}
        />
      ) : (
        <input type="hidden" name="vehicle_id" value={vehicle} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={p.name} name="name" defaultValue={v.name ?? ""} placeholder={p.namePlaceholder} required error={err("name")} />
        <SelectField
          label={t.maintenance.fields.maintenance_type}
          name="maintenance_type"
          defaultValue={v.maintenance_type ?? "oil_change"}
          options={MAINTENANCE_TYPES.map((x) => ({ value: x, label: t.maintenance.types[x] }))}
        />
        <TextField label={p.interval_km} name="interval_km" defaultValue={v.interval_km ?? ""} inputMode="numeric" optionalLabel={opt} error={err("interval_km")} />
        <TextField label={p.interval_months} name="interval_months" defaultValue={v.interval_months ?? ""} inputMode="numeric" optionalLabel={opt} error={err("interval_months")} />
        <p className="-mt-2 text-xs text-subtle sm:col-span-2">{p.intervalHint}</p>
        <TextField label={p.last_done_date} name="last_done_date" type="date" defaultValue={v.last_done_date ?? todayInMadrid()} error={err("last_done_date")} />
        <TextField key={vehicle} label={p.last_done_mileage} name="last_done_mileage" defaultValue={km} inputMode="numeric" error={err("last_done_mileage")} />
        <TextAreaField label={t.maintenance.fields.notes} name="notes" defaultValue={v.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" />
      </div>
    </>
  );
}

export function PlanDialog({
  values,
  vehicles,
  size = "default",
  variant,
}: {
  values: PlanFormValues;
  vehicles?: Array<{ value: string; label: string; mileage: number }>;
  size?: "default" | "sm";
  variant?: "default" | "secondary" | "ghost";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = !!values.id;
  const title = isEdit ? t.maintenance.plans.edit : t.maintenance.plans.new;
  return (
    <>
      <Button size={size} variant={variant ?? (isEdit ? "ghost" : "secondary")} onClick={() => setOpen(true)} aria-label={isEdit ? title : undefined}>
        {isEdit ? <Pencil /> : <Plus />} {!isEdit && title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={savePlanAction}
              successMessage={t.maintenance.plans.saved}
              onSuccess={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              <Fields v={values} vehicles={vehicles} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
