"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Pencil } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { MAINTENANCE_TYPES, type MaintenanceType } from "@/lib/maintenance/constants";
import { todayInMadrid } from "@/lib/periods";
import { saveMaintenanceAction } from "@/app/(app)/maintenance/actions";

export type MaintenanceFormValues = {
  id?: string;
  vehicle_id?: string;
  plan_id?: string | null;
  damage_id?: string | null;
  maintenance_type?: MaintenanceType;
  title?: string;
  description?: string | null;
  scheduled_date?: string | null;
  workshop?: string | null;
  cost?: number | null;
  blocks_vehicle?: boolean;
  notes?: string | null;
};
type VehicleOpt = { value: string; label: string };
type PlanOpt = { value: string; vehicle_id: string; label: string; type: MaintenanceType };

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

function Fields({ v, vehicles, plans }: { v: MaintenanceFormValues; vehicles?: VehicleOpt[]; plans: PlanOpt[] }) {
  const { t } = useI18n();
  const m = t.maintenance;
  const f = m.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const [vehicle, setVehicle] = useState(v.vehicle_id ?? "");
  const [type, setType] = useState<MaintenanceType>(v.maintenance_type ?? "preventive");
  const [title, setTitle] = useState(v.title ?? m.types[v.maintenance_type ?? "preventive"]);
  const [touched, setTouched] = useState(!!v.title);
  const vPlans = plans.filter((p) => p.vehicle_id === vehicle);
  const isEdit = !!v.id;
  return (
    <>
      <input type="hidden" name="id" value={v.id ?? ""} />
      <input type="hidden" name="damage_id" value={v.damage_id ?? ""} />
      {vehicles && !isEdit ? (
        <SelectField
          label={f.vehicle}
          name="vehicle_id"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
          required
          error={err("vehicle_id")}
          options={[{ value: "", label: "—" }, ...vehicles]}
        />
      ) : (
        <input type="hidden" name="vehicle_id" value={vehicle} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={f.maintenance_type}
          name="maintenance_type"
          value={type}
          onChange={(e) => {
            const nt = e.target.value as MaintenanceType;
            setType(nt);
            if (!touched) setTitle(m.types[nt]);
          }}
          options={MAINTENANCE_TYPES.map((x) => ({ value: x, label: m.types[x] }))}
        />
        <SelectField
          label={f.plan}
          name="plan_id"
          defaultValue={v.plan_id ?? ""}
          optionalLabel={opt}
          disabled={vPlans.length === 0}
          options={[{ value: "", label: "—" }, ...vPlans.map((p) => ({ value: p.value, label: p.label }))]}
        />
        <TextField
          label={f.title}
          name="title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTouched(true);
          }}
          required
          className="sm:col-span-2"
          error={err("title")}
        />
        <TextField label={f.scheduled_date} name="scheduled_date" type="date" defaultValue={v.scheduled_date ?? todayInMadrid()} required={!isEdit} error={err("scheduled_date")} />
        <TextField label={f.workshop} name="workshop" defaultValue={v.workshop ?? ""} optionalLabel={opt} error={err("workshop")} />
        <TextField label={f.cost} name="cost" defaultValue={money(v.cost)} inputMode="decimal" optionalLabel={opt} error={err("cost")} />
        <TextAreaField label={f.description} name="description" defaultValue={v.description ?? ""} rows={3} optionalLabel={opt} className="sm:col-span-2" error={err("description")} />
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3.5 text-sm sm:col-span-2">
          <input type="checkbox" name="blocks_vehicle" defaultChecked={v.blocks_vehicle ?? true} className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]" />
          <span>{f.blocks_vehicle}</span>
        </label>
        <TextAreaField label={f.notes} name="notes" defaultValue={v.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" error={err("notes")} />
      </div>
    </>
  );
}

export function MaintenanceDialog({
  values,
  vehicles,
  plans = [],
  label,
  size = "default",
  variant,
}: {
  values: MaintenanceFormValues;
  vehicles?: VehicleOpt[];
  plans?: PlanOpt[];
  label?: string;
  size?: "default" | "sm";
  variant?: "default" | "secondary";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = !!values.id;
  const title = isEdit ? t.maintenance.edit : (label ?? t.maintenance.new);
  return (
    <>
      <Button size={size} variant={variant ?? (isEdit ? "secondary" : "default")} onClick={() => setOpen(true)}>
        {isEdit ? <Pencil /> : <CalendarPlus />} {title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={async (p, fd) => {
                const res = await saveMaintenanceAction(p, fd);
                if (res.ok && !isEdit && res.vars?.id) router.push(`/maintenance/${res.vars.id}`);
                return res;
              }}
              successMessage={t.maintenance.saved}
              onSuccess={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              <Fields v={values} vehicles={vehicles} plans={plans} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
