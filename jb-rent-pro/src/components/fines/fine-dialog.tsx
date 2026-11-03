"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { FINE_STATUSES, type FineStatus } from "@/lib/fines/constants";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { isoToMadridLocal } from "@/lib/rentals/datetime";
import { todayInMadrid } from "@/lib/periods";
import { saveFineAction } from "@/app/(app)/fines/actions";

export type FineFormValues = {
  id?: string;
  vehicle_id?: string;
  rental_id?: string | null;
  customer_id?: string | null;
  infraction_at?: string;
  authority?: string;
  reference?: string | null;
  infraction?: string;
  location?: string | null;
  points?: number | null;
  amount?: number;
  notified_at?: string | null;
  identification_deadline?: string | null;
  payment_deadline?: string | null;
  status?: FineStatus;
  identified_at?: string | null;
  paid_at?: string | null;
  paid_amount?: number | null;
  payment_method?: string | null;
  recharge_amount?: number | null;
  recharge_paid_at?: string | null;
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

function Fields({ v, vehicles, rentals }: { v: FineFormValues; vehicles?: Opt[]; rentals: RentalOpt[] }) {
  const { t } = useI18n();
  const fi = t.fines;
  const f = fi.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const [vehicle, setVehicle] = useState(v.vehicle_id ?? "");
  const local = isoToMadridLocal(v.infraction_at);
  const vRentals = rentals.filter((r) => r.vehicle_id === vehicle);
  return (
    <div className="space-y-5">
      <input type="hidden" name="id" value={v.id ?? ""} />
      <input type="hidden" name="customer_id" value={v.customer_id ?? ""} />
      <Section title={fi.sections.infraction}>
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
        <TextField label={f.infraction_date} name="infraction_date" type="date" defaultValue={local.date || todayInMadrid()} required error={err("infraction_date")} />
        <TextField label={f.infraction_time} name="infraction_time" type="time" defaultValue={local.time || "12:00"} required error={err("infraction_time")} />
        <TextField label={f.authority} name="authority" defaultValue={v.authority ?? ""} placeholder={f.authorityPlaceholder} required error={err("authority")} />
        <TextField label={f.reference} name="reference" defaultValue={v.reference ?? ""} optionalLabel={opt} className="[&_input]:uppercase" error={err("reference")} />
        <TextAreaField label={f.infraction} name="infraction" defaultValue={v.infraction ?? ""} rows={2} required className="sm:col-span-2" error={err("infraction")} />
        <TextField label={f.location} name="location" defaultValue={v.location ?? ""} optionalLabel={opt} error={err("location")} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label={f.amount} name="amount" defaultValue={money(v.amount)} inputMode="decimal" required error={err("amount")} />
          <TextField label={f.points} name="points" defaultValue={v.points ?? ""} inputMode="numeric" optionalLabel={opt} error={err("points")} />
        </div>
        <SelectField
          label={f.rental}
          name="rental_id"
          defaultValue={v.rental_id ?? ""}
          optionalLabel={opt}
          hint={fi.autoRental}
          className="sm:col-span-2"
          error={err("rental_id")}
          options={[{ value: "", label: "—" }, ...vRentals.map(({ value, label }) => ({ value, label }))]}
        />
      </Section>
      <Section title={fi.sections.deadlines}>
        <TextField label={f.notified_at} name="notified_at" type="date" defaultValue={v.notified_at ?? ""} optionalLabel={opt} error={err("notified_at")} />
        <TextField label={f.identification_deadline} name="identification_deadline" type="date" defaultValue={v.identification_deadline ?? ""} optionalLabel={opt} error={err("identification_deadline")} />
        <TextField label={f.payment_deadline} name="payment_deadline" type="date" defaultValue={v.payment_deadline ?? ""} optionalLabel={opt} error={err("payment_deadline")} />
        <SelectField label={f.status} name="status" defaultValue={v.status ?? "pending"} error={err("status")} options={FINE_STATUSES.map((s) => ({ value: s, label: fi.statuses[s] }))} />
        <TextField label={f.identified_at} name="identified_at" type="date" defaultValue={v.identified_at ?? ""} optionalLabel={opt} error={err("identified_at")} />
        <p className="text-xs text-subtle sm:col-span-2">{fi.deadlineNote}</p>
      </Section>
      <Section title={fi.sections.payment}>
        <TextField label={f.paid_at} name="paid_at" type="date" defaultValue={v.paid_at ?? ""} optionalLabel={opt} error={err("paid_at")} />
        <TextField label={f.paid_amount} name="paid_amount" defaultValue={money(v.paid_amount)} inputMode="decimal" optionalLabel={opt} error={err("paid_amount")} />
        <SelectField
          label={f.payment_method}
          name="payment_method"
          defaultValue={v.payment_method ?? ""}
          optionalLabel={opt}
          options={[{ value: "", label: "—" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))]}
        />
        <div />
        <TextField label={f.recharge_amount} name="recharge_amount" defaultValue={money(v.recharge_amount)} inputMode="decimal" optionalLabel={opt} error={err("recharge_amount")} />
        <TextField label={f.recharge_paid_at} name="recharge_paid_at" type="date" defaultValue={v.recharge_paid_at ?? ""} optionalLabel={opt} error={err("recharge_paid_at")} />
        <TextAreaField label={f.notes} name="notes" defaultValue={v.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" />
        <p className="text-xs text-subtle sm:col-span-2">{fi.financeNote}</p>
      </Section>
    </div>
  );
}

export function FineDialog({ values, vehicles, rentals, size = "default" }: { values: FineFormValues; vehicles?: Opt[]; rentals: RentalOpt[]; size?: "default" | "sm" }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = !!values.id;
  const title = isEdit ? t.fines.edit : t.fines.new;
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
                const res = await saveFineAction(p, fd);
                if (res.ok && !isEdit && res.vars?.id) router.push(`/fines/${res.vars.id}`);
                return res;
              }}
              successMessage={t.fines.saved}
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
