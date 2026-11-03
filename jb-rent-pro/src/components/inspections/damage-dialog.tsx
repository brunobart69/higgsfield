"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { DAMAGE_CATEGORIES, DAMAGE_SEVERITIES, DAMAGE_STATUSES, INSPECTION_AREAS } from "@/lib/inspections/constants";
import { todayInMadrid } from "@/lib/periods";
import { saveDamageAction } from "@/app/(app)/inspections/actions";

export type DamageFormValues = {
  id?: string;
  vehicle_id: string;
  rental_id?: string | null;
  inspection_id?: string | null;
  detected_at?: string;
  mileage?: number | null;
  area?: string | null;
  category?: string;
  severity?: string;
  description?: string;
  estimated_cost?: number | null;
  actual_cost?: number | null;
  status?: string;
  repair_shop?: string | null;
  notes?: string | null;
};

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

function Fields({ v }: { v: DamageFormValues }) {
  const { t } = useI18n();
  const d = t.damages;
  const f = d.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  return (
    <>
      <input type="hidden" name="id" value={v.id ?? ""} />
      <input type="hidden" name="vehicle_id" value={v.vehicle_id} />
      <input type="hidden" name="rental_id" value={v.rental_id ?? ""} />
      <input type="hidden" name="inspection_id" value={v.inspection_id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={f.category} name="category" defaultValue={v.category ?? "scratch"} options={DAMAGE_CATEGORIES.map((c) => ({ value: c, label: d.categories[c] }))} />
        <SelectField label={f.severity} name="severity" defaultValue={v.severity ?? "low"} options={DAMAGE_SEVERITIES.map((s) => ({ value: s, label: d.severities[s] }))} />
        <SelectField
          label={f.area}
          name="area"
          defaultValue={v.area ?? ""}
          options={[{ value: "", label: "—" }, ...INSPECTION_AREAS.map((a) => ({ value: a, label: t.inspections.areas[a] }))]}
        />
        <SelectField label={f.status} name="status" defaultValue={v.status ?? "pending"} options={DAMAGE_STATUSES.map((s) => ({ value: s, label: d.statuses[s] }))} />
        <TextAreaField label={f.description} name="description" defaultValue={v.description ?? ""} rows={3} required className="sm:col-span-2" error={err("description")} />
        <TextField label={f.detected_at} name="detected_at" type="date" defaultValue={v.detected_at ?? todayInMadrid()} error={err("detected_at")} />
        <TextField label={f.mileage} name="mileage" defaultValue={v.mileage ?? ""} inputMode="numeric" optionalLabel={opt} error={err("mileage")} />
        <TextField label={f.estimated_cost} name="estimated_cost" defaultValue={money(v.estimated_cost)} inputMode="decimal" optionalLabel={opt} error={err("estimated_cost")} />
        <TextField label={f.actual_cost} name="actual_cost" defaultValue={money(v.actual_cost)} inputMode="decimal" optionalLabel={opt} error={err("actual_cost")} />
        <TextField label={f.repair_shop} name="repair_shop" defaultValue={v.repair_shop ?? ""} optionalLabel={opt} className="sm:col-span-2" />
        <TextAreaField label={f.notes} name="notes" defaultValue={v.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" />
      </div>
      <p className="text-xs text-subtle">{d.costNote}</p>
    </>
  );
}

/** Registrar/editar avaria. Ao criar, abre a ficha da avaria para adicionar fotos. */
export function DamageDialog({
  values,
  trigger = "new",
  label,
  size = "default",
}: {
  values: DamageFormValues;
  trigger?: "new" | "edit";
  label?: string;
  size?: "default" | "sm";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = !!values.id;
  return (
    <>
      <Button size={size} variant={trigger === "edit" ? "secondary" : "default"} onClick={() => setOpen(true)}>
        {trigger === "edit" ? <Pencil /> : <Plus />} {label ?? (isEdit ? t.damages.edit : t.damages.new)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={isEdit ? t.damages.edit : t.damages.new} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={async (p, fd) => {
                const res = await saveDamageAction(p, fd);
                if (res.ok && !isEdit && res.vars?.id) router.push(`/damages/${res.vars.id}`);
                return res;
              }}
              successMessage={t.damages.saved}
              onSuccess={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              <Fields v={values} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
