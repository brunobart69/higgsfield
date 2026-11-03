"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { ACCIDENT_FAULTS, ACCIDENT_STATUSES, type AccidentFault, type AccidentStatus } from "@/lib/fines/constants";
import { isoToMadridLocal } from "@/lib/rentals/datetime";
import { todayInMadrid } from "@/lib/periods";
import { saveAccidentAction } from "@/app/(app)/fines/actions";

export type AccidentFormValues = {
  id?: string;
  vehicle_id?: string;
  rental_id?: string | null;
  customer_id?: string | null;
  insurance_policy_id?: string | null;
  occurred_at?: string;
  location?: string | null;
  description?: string;
  status?: AccidentStatus;
  fault?: AccidentFault;
  injuries?: boolean;
  third_party?: boolean;
  third_party_details?: string | null;
  police_report?: boolean;
  police_report_number?: string | null;
  amicable_report?: boolean;
  insurer_claim_number?: string | null;
  reported_to_insurer_at?: string | null;
  estimated_cost?: number | null;
  deductible_amount?: number | null;
  deductible_paid_at?: string | null;
  insurer_payout?: number | null;
  insurer_payout_at?: string | null;
  notes?: string | null;
};
type Opt = { value: string; label: string };
type RentalOpt = Opt & { vehicle_id: string };

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-border pt-5 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="float-left mb-1 w-full font-display text-sm font-semibold text-gold-light">{title}</legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]" />
      <span>{label}</span>
    </label>
  );
}

function Fields({ v, vehicles, rentals }: { v: AccidentFormValues; vehicles?: Opt[]; rentals: RentalOpt[] }) {
  const { t } = useI18n();
  const a = t.accidents;
  const f = a.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const [vehicle, setVehicle] = useState(v.vehicle_id ?? "");
  const local = isoToMadridLocal(v.occurred_at);
  const vRentals = rentals.filter((r) => r.vehicle_id === vehicle);
  return (
    <div className="space-y-5">
      <input type="hidden" name="id" value={v.id ?? ""} />
      <input type="hidden" name="customer_id" value={v.customer_id ?? ""} />
      <input type="hidden" name="insurance_policy_id" value={v.insurance_policy_id ?? ""} />
      <Section title={a.sections.event}>
        {vehicles && !v.id ? (
          <SelectField
            label={f.vehicle}
            name="vehicle_id"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            required
            error={err("vehicle_id")}
            className="sm:col-span-2"
            options={[{ value: "", label: "—" }, ...vehicles]}
          />
        ) : (
          <input type="hidden" name="vehicle_id" value={vehicle} />
        )}
        <TextField label={f.occurred_date} name="occurred_date" type="date" defaultValue={local.date || todayInMadrid()} required error={err("occurred_date")} />
        <TextField label={f.occurred_time} name="occurred_time" type="time" defaultValue={local.time || "12:00"} required error={err("occurred_time")} />
        <TextField label={f.location} name="location" defaultValue={v.location ?? ""} optionalLabel={opt} className="sm:col-span-2" error={err("location")} />
        <TextAreaField label={f.description} name="description" defaultValue={v.description ?? ""} rows={3} required className="sm:col-span-2" error={err("description")} />
        <SelectField label={f.status} name="status" defaultValue={v.status ?? "reported"} options={ACCIDENT_STATUSES.map((s) => ({ value: s, label: a.statuses[s] }))} />
        <SelectField label={f.fault} name="fault" defaultValue={v.fault ?? "unknown"} options={ACCIDENT_FAULTS.map((s) => ({ value: s, label: a.faults[s] }))} />
        <SelectField
          label={f.rental}
          name="rental_id"
          defaultValue={v.rental_id ?? ""}
          optionalLabel={opt}
          hint={a.autoInfo}
          className="sm:col-span-2"
          error={err("rental_id")}
          options={[{ value: "", label: "—" }, ...vRentals.map(({ value, label }) => ({ value, label }))]}
        />
        <Check name="injuries" label={f.injuries} defaultChecked={v.injuries} />
      </Section>
      <Section title={a.sections.parties}>
        <Check name="third_party" label={f.third_party} defaultChecked={v.third_party} />
        <Check name="amicable_report" label={f.amicable_report} defaultChecked={v.amicable_report} />
        <TextAreaField label={f.third_party_details} name="third_party_details" defaultValue={v.third_party_details ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" />
        <Check name="police_report" label={f.police_report} defaultChecked={v.police_report} />
        <TextField label={f.police_report_number} name="police_report_number" defaultValue={v.police_report_number ?? ""} optionalLabel={opt} />
      </Section>
      <Section title={a.sections.insurance}>
        <TextField label={f.insurer_claim_number} name="insurer_claim_number" defaultValue={v.insurer_claim_number ?? ""} optionalLabel={opt} />
        <TextField label={f.reported_to_insurer_at} name="reported_to_insurer_at" type="date" defaultValue={v.reported_to_insurer_at ?? ""} optionalLabel={opt} error={err("reported_to_insurer_at")} />
      </Section>
      <Section title={a.sections.values}>
        <TextField label={f.estimated_cost} name="estimated_cost" defaultValue={money(v.estimated_cost)} inputMode="decimal" optionalLabel={opt} error={err("estimated_cost")} />
        <div />
        <TextField label={f.deductible_amount} name="deductible_amount" defaultValue={money(v.deductible_amount)} inputMode="decimal" optionalLabel={opt} error={err("deductible_amount")} />
        <TextField label={f.deductible_paid_at} name="deductible_paid_at" type="date" defaultValue={v.deductible_paid_at ?? ""} optionalLabel={opt} error={err("deductible_paid_at")} />
        <TextField label={f.insurer_payout} name="insurer_payout" defaultValue={money(v.insurer_payout)} inputMode="decimal" optionalLabel={opt} error={err("insurer_payout")} />
        <TextField label={f.insurer_payout_at} name="insurer_payout_at" type="date" defaultValue={v.insurer_payout_at ?? ""} optionalLabel={opt} error={err("insurer_payout_at")} />
        <TextAreaField label={f.notes} name="notes" defaultValue={v.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" />
        <p className="text-xs text-subtle sm:col-span-2">{a.financeNote}</p>
      </Section>
    </div>
  );
}

export function AccidentDialog({ values, vehicles, rentals, size = "default" }: { values: AccidentFormValues; vehicles?: Opt[]; rentals: RentalOpt[]; size?: "default" | "sm" }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = !!values.id;
  const title = isEdit ? t.accidents.edit : t.accidents.new;
  return (
    <>
      <Button size={size} variant={isEdit ? "secondary" : "default"} onClick={() => setOpen(true)}>
        {isEdit ? <Pencil /> : <Plus />} {title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={async (p, fd) => {
                const res = await saveAccidentAction(p, fd);
                if (res.ok && !isEdit && res.vars?.id) router.push(`/fines/accidents/${res.vars.id}`);
                return res;
              }}
              successMessage={t.accidents.saved}
              onSuccess={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              <Fields v={values} vehicles={vehicles} rentals={rentals} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
