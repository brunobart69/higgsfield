"use client";
import { useState } from "react";
import { Building2, ShieldCheck, User } from "lucide-react";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { useI18n } from "@/lib/i18n/provider";
import { ID_DOCUMENT_TYPES, type CustomerType } from "@/lib/customers/constants";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/auth/validation";

export type CustomerFormValues = Partial<{
  customer_type: CustomerType;
  full_name: string | null;
  birth_date: string | null;
  nationality: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  driving_licence_number: string | null;
  driving_licence_expiry: string | null;
  company_name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  representative_name: string | null;
  billing_details: { email?: string; address?: string; notes?: string } | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  gdpr_consent_at: string | null;
  marketing_consent: boolean;
}>;

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function Section({ title, children, cols = 3 }: { title: string; children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <fieldset className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full font-display text-sm font-semibold text-gold-light">{title}</legend>
      <div className={cn("clear-both grid gap-4 sm:grid-cols-2", cols === 3 && "lg:grid-cols-3")}>{children}</div>
    </fieldset>
  );
}

function Check({ name, label, defaultChecked, error }: { name: string; label: string; defaultChecked?: boolean; error?: string }) {
  return (
    <div className="space-y-1">
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3.5 text-sm">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]" aria-invalid={error ? true : undefined} />
        <span>{label}</span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Fields({ v, type, setType, locked }: { v: CustomerFormValues; type: CustomerType; setType: (t: CustomerType) => void; locked: boolean }) {
  const { t } = useI18n();
  const c = t.customers;
  const f = c.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const billing = v.billing_details ?? {};

  return (
    <>
      <input type="hidden" name="customer_type" value={type} />
      {!locked && (
        <div role="radiogroup" aria-label={t.customers.title} className="grid grid-cols-2 gap-2">
          {(["individual", "company"] as const).map((k) => {
            const Icon = k === "individual" ? User : Building2;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={type === k}
                onClick={() => setType(k)}
                className={cn(
                  "flex h-14 items-center justify-center gap-2 rounded-md border text-sm transition",
                  type === k ? "border-gold/60 bg-gold/10 text-gold-light" : "border-border bg-surface-2 text-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" /> {c.types[k]}
              </button>
            );
          })}
        </div>
      )}

      {type === "individual" ? (
        <>
          <Section title={c.sections.identity}>
            <TextField label={f.full_name} name="full_name" defaultValue={s(v.full_name)} required autoComplete="off" className="sm:col-span-2" error={err("full_name")} />
            <TextField label={f.birth_date} name="birth_date" type="date" defaultValue={s(v.birth_date)} optionalLabel={opt} error={err("birth_date")} />
            <SelectField
              label={f.id_document_type}
              name="id_document_type"
              defaultValue={s(v.id_document_type)}
              options={[{ value: "", label: "—" }, ...ID_DOCUMENT_TYPES.map((x) => ({ value: x, label: c.idTypes[x] }))]}
              error={err("id_document_type")}
            />
            <TextField label={f.id_document_number} name="id_document_number" defaultValue={s(v.id_document_number)} autoCapitalize="characters" autoComplete="off" error={err("id_document_number")} />
            <TextField label={f.nationality} name="nationality" defaultValue={s(v.nationality)} maxLength={2} autoCapitalize="characters" placeholder="ES" optionalLabel={opt} error={err("nationality")} />
          </Section>
          <Section title={c.sections.licence} cols={2}>
            <TextField label={f.driving_licence_number} name="driving_licence_number" defaultValue={s(v.driving_licence_number)} autoCapitalize="characters" autoComplete="off" optionalLabel={opt} error={err("driving_licence_number")} />
            <TextField label={f.driving_licence_expiry} name="driving_licence_expiry" type="date" defaultValue={s(v.driving_licence_expiry)} optionalLabel={opt} error={err("driving_licence_expiry")} />
          </Section>
        </>
      ) : (
        <>
          <Section title={c.sections.company}>
            <TextField label={f.company_name} name="company_name" defaultValue={s(v.company_name)} required autoComplete="off" className="sm:col-span-2" error={err("company_name")} />
            <TextField label={f.tax_id} name="tax_id" defaultValue={s(v.tax_id)} autoCapitalize="characters" optionalLabel={opt} error={err("tax_id")} />
            <TextField label={f.legal_name} name="legal_name" defaultValue={s(v.legal_name)} className="sm:col-span-2" optionalLabel={opt} error={err("legal_name")} />
            <TextField label={f.representative_name} name="representative_name" defaultValue={s(v.representative_name)} optionalLabel={opt} error={err("representative_name")} />
          </Section>
          <Section title={c.sections.billing} cols={2}>
            <TextField label={f.billing_email} name="billing_email" type="email" inputMode="email" defaultValue={s(billing.email)} optionalLabel={opt} error={err("billing_email")} />
            <TextField label={f.billing_address} name="billing_address" defaultValue={s(billing.address)} optionalLabel={opt} error={err("billing_address")} />
            <TextAreaField label={f.billing_notes} name="billing_notes" defaultValue={s(billing.notes)} rows={2} className="sm:col-span-2" optionalLabel={opt} error={err("billing_notes")} />
          </Section>
        </>
      )}

      <Section title={c.sections.contact}>
        <TextField label={f.phone} name="phone" type="tel" inputMode="tel" defaultValue={s(v.phone)} optionalLabel={opt} error={err("phone")} />
        <TextField label={f.email} name="email" type="email" inputMode="email" defaultValue={s(v.email)} optionalLabel={opt} error={err("email")} />
        <TextField label={f.country} name="country" defaultValue={s(v.country ?? "ES")} maxLength={2} autoCapitalize="characters" error={err("country")} />
        <TextField label={f.address} name="address" defaultValue={s(v.address)} className="sm:col-span-2" optionalLabel={opt} error={err("address")} />
        <TextField label={f.postal_code} name="postal_code" defaultValue={s(v.postal_code)} inputMode="numeric" optionalLabel={opt} error={err("postal_code")} />
        <TextField label={f.city} name="city" defaultValue={s(v.city)} optionalLabel={opt} error={err("city")} />
      </Section>

      <fieldset className="space-y-3 border-t border-border pt-5">
        <legend className="float-left mb-1 flex w-full items-center gap-2 font-display text-sm font-semibold text-gold-light">
          <ShieldCheck className="size-4" /> {c.sections.privacy}
        </legend>
        <div className="clear-both grid gap-3">
          <Check name="gdpr_informed" label={f.gdpr_informed} defaultChecked={!!v.gdpr_consent_at} error={err("gdpr_informed")} />
          <Check name="marketing_consent" label={f.marketing_consent} defaultChecked={!!v.marketing_consent} />
        </div>
      </fieldset>

      <fieldset className="border-t border-border pt-5">
        <TextAreaField label={f.notes} name="notes" defaultValue={s(v.notes)} rows={3} optionalLabel={opt} error={err("notes")} />
      </fieldset>
    </>
  );
}

export function CustomerForm({
  action,
  values = {},
  lockType = false,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  values?: CustomerFormValues;
  lockType?: boolean;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<CustomerType>(values.customer_type ?? "individual");
  return (
    <ActionForm action={action} className="space-y-6" successMessage={t.customers.saved}>
      <Fields v={values} type={type} setType={setType} locked={lockType} />
    </ActionForm>
  );
}
