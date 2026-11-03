"use client";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { useI18n } from "@/lib/i18n/provider";
import { FUEL_TYPES, TRANSMISSIONS, VEHICLE_STATUSES, VEHICLE_TYPES } from "@/lib/vehicles/constants";
import type { FormState } from "@/lib/auth/validation";

export type VehicleFormValues = Partial<{
  brand: string;
  model: string;
  version: string | null;
  year: number | null;
  plate: string;
  vin: string | null;
  color: string | null;
  vehicle_type: string | null;
  fuel: string | null;
  transmission: string | null;
  doors: number | null;
  seats: number | null;
  current_mileage: number;
  acquisition_date: string | null;
  purchase_price: number | null;
  market_value: number | null;
  fleet_entry_date: string | null;
  category: string | null;
  daily_price: number | null;
  weekly_price: number | null;
  monthly_price: number | null;
  itv_due_date: string | null;
  status: string;
  notes: string | null;
}>;

const money = (v: number | null | undefined) => (v === null || v === undefined ? "" : Number(v).toFixed(2).replace(".", ","));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full font-display text-sm font-semibold text-gold-light">{title}</legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

function Fields({ v, isNew }: { v: VehicleFormValues; isNew: boolean }) {
  const { t } = useI18n();
  const f = t.vehicles.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const none = { value: "", label: "—" };
  return (
    <>
      <Section title={t.vehicles.sections.identification}>
        <TextField label={f.brand} name="brand" defaultValue={str(v.brand)} required autoComplete="off" error={err("brand")} />
        <TextField label={f.model} name="model" defaultValue={str(v.model)} required autoComplete="off" error={err("model")} />
        <TextField label={f.version} name="version" defaultValue={str(v.version)} optionalLabel={opt} error={err("version")} />
        <TextField label={f.plate} name="plate" defaultValue={str(v.plate)} required autoCapitalize="characters" placeholder="1234 ABC" error={err("plate")} />
        <TextField label={f.vin} name="vin" defaultValue={str(v.vin)} autoCapitalize="characters" maxLength={20} optionalLabel={opt} error={err("vin")} />
        <TextField label={f.year} name="year" defaultValue={str(v.year)} inputMode="numeric" maxLength={4} optionalLabel={opt} error={err("year")} />
        <TextField label={f.color} name="color" defaultValue={str(v.color)} optionalLabel={opt} error={err("color")} />
        <SelectField label={f.vehicle_type} name="vehicle_type" defaultValue={str(v.vehicle_type)} options={[none, ...VEHICLE_TYPES.map((x) => ({ value: x, label: t.vehicles.types[x] }))]} />
        <SelectField label={f.fuel} name="fuel" defaultValue={str(v.fuel)} options={[none, ...FUEL_TYPES.map((x) => ({ value: x, label: t.vehicles.fuel[x] }))]} />
        <SelectField label={f.transmission} name="transmission" defaultValue={str(v.transmission)} options={[none, ...TRANSMISSIONS.map((x) => ({ value: x, label: t.vehicles.transmission[x] }))]} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label={f.doors} name="doors" defaultValue={str(v.doors)} inputMode="numeric" error={err("doors")} />
          <TextField label={f.seats} name="seats" defaultValue={str(v.seats)} inputMode="numeric" error={err("seats")} />
        </div>
      </Section>

      <Section title={t.vehicles.sections.operational}>
        <TextField label={f.current_mileage} name="current_mileage" defaultValue={str(v.current_mileage ?? "")} inputMode="numeric" error={err("current_mileage")} />
        <TextField label={f.category} name="category" defaultValue={str(v.category)} hint={t.vehicles.hints.category} optionalLabel={opt} error={err("category")} />
        <SelectField label={f.status} name="status" defaultValue={v.status ?? "available"} options={VEHICLE_STATUSES.map((x) => ({ value: x, label: t.vehicles.status[x] }))} />
        <TextField label={f.acquisition_date} name="acquisition_date" type="date" defaultValue={str(v.acquisition_date)} optionalLabel={opt} error={err("acquisition_date")} />
        <TextField label={f.fleet_entry_date} name="fleet_entry_date" type="date" defaultValue={str(v.fleet_entry_date)} optionalLabel={opt} error={err("fleet_entry_date")} />
        <TextField label={f.purchase_price} name="purchase_price" defaultValue={money(v.purchase_price)} inputMode="decimal" optionalLabel={opt} error={err("purchase_price")} />
        <TextField
          label={f.market_value}
          name="market_value"
          defaultValue={money(v.market_value)}
          inputMode="decimal"
          hint={t.vehicles.hints.market_value}
          optionalLabel={opt}
          error={err("market_value")}
          className="sm:col-span-2 lg:col-span-1"
        />
      </Section>

      <Section title={t.vehicles.sections.prices}>
        <TextField label={f.daily_price} name="daily_price" defaultValue={money(v.daily_price)} inputMode="decimal" hint={isNew ? t.vehicles.hints.prices : undefined} error={err("daily_price")} />
        <TextField label={f.weekly_price} name="weekly_price" defaultValue={money(v.weekly_price)} inputMode="decimal" error={err("weekly_price")} />
        <TextField label={f.monthly_price} name="monthly_price" defaultValue={money(v.monthly_price)} inputMode="decimal" error={err("monthly_price")} />
      </Section>

      <Section title={t.vehicles.sections.documentation}>
        <TextField label={f.itv_due_date} name="itv_due_date" type="date" defaultValue={str(v.itv_due_date)} optionalLabel={opt} error={err("itv_due_date")} />
      </Section>

      <fieldset className="space-y-4 border-t border-border pt-5">
        <TextAreaField label={f.notes} name="notes" defaultValue={str(v.notes)} rows={3} optionalLabel={opt} error={err("notes")} />
      </fieldset>
    </>
  );
}

export function VehicleForm({
  action,
  values = {},
  isNew = false,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  values?: VehicleFormValues;
  isNew?: boolean;
}) {
  const { t } = useI18n();
  return (
    <ActionForm action={action} className="space-y-6" successMessage={t.vehicles.saved}>
      <Fields v={values} isNew={isNew} />
    </ActionForm>
  );
}
