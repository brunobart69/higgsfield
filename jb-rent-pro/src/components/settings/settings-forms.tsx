"use client";
import { useState } from "react";
import { Info } from "lucide-react";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import type { CompanySettings } from "@/lib/settings/queries";
import { MILEAGE_POLICIES } from "@/lib/settings/constants";
import {
  saveCompanyAction,
  saveContractAction,
  saveDefaultsAction,
  saveFiscalAction,
} from "@/app/(app)/settings/actions";
import { ActionForm, useFieldError } from "@/components/ui/action-form";

/** Número do banco → texto editável com vírgula decimal ("45,00"). */
export function moneyInput(v: number | null | undefined) {
  return v === null || v === undefined ? "" : Number(v).toFixed(2).replace(".", ",");
}
function numInput(v: number | null | undefined) {
  return v === null || v === undefined ? "" : String(v).replace(".", ",");
}

function F(props: React.ComponentProps<typeof TextField>) {
  const err = useFieldError();
  return <TextField error={err(props.name)} {...props} />;
}
function TA(props: React.ComponentProps<typeof TextAreaField>) {
  const err = useFieldError();
  return <TextAreaField error={err(props.name)} {...props} />;
}
function S(props: React.ComponentProps<typeof SelectField>) {
  const err = useFieldError();
  return <SelectField error={err(props.name)} {...props} />;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-muted">
      <Info className="mt-0.5 size-4 shrink-0 text-gold" />
      {children}
    </p>
  );
}

const grid = "grid gap-4 sm:grid-cols-2";

export function CompanyForm({ c }: { c: CompanySettings }) {
  const { t } = useI18n();
  const f = t.settings.fields;
  const opt = t.common.optional;
  return (
    <ActionForm action={saveCompanyAction}>
      <div className={grid}>
        <F label={f.name} name="name" defaultValue={c.name} required autoComplete="organization" />
        <F label={f.legal_name} name="legal_name" defaultValue={c.legal_name ?? ""} optionalLabel={opt} />
        <F label={f.tax_id} name="tax_id" defaultValue={c.tax_id ?? ""} autoCapitalize="characters" optionalLabel={opt} />
        <F label={f.phone} name="phone" type="tel" defaultValue={c.phone ?? ""} inputMode="tel" optionalLabel={opt} />
        <F label={f.email} name="email" type="email" defaultValue={c.email ?? ""} inputMode="email" optionalLabel={opt} />
        <F label={f.website} name="website" defaultValue={c.website ?? ""} inputMode="url" optionalLabel={opt} />
        <F label={f.address} name="address" defaultValue={c.address ?? ""} className="sm:col-span-2" optionalLabel={opt} />
        <F label={f.city} name="city" defaultValue={c.city ?? ""} optionalLabel={opt} />
        <F label={f.postal_code} name="postal_code" defaultValue={c.postal_code ?? ""} inputMode="numeric" maxLength={5} optionalLabel={opt} />
        <F label={f.province} name="province" defaultValue={c.province ?? ""} optionalLabel={opt} />
      </div>
    </ActionForm>
  );
}

export function FiscalForm({ c }: { c: CompanySettings }) {
  const { t } = useI18n();
  const f = t.settings.fields;
  const opt = t.common.optional;
  return (
    <ActionForm action={saveFiscalAction}>
      <Notice>{t.settings.fiscalNotice}</Notice>
      <div className={grid}>
        <F label={f.vat_rate} name="vat_rate" defaultValue={numInput(c.vat_rate)} inputMode="decimal" optionalLabel={opt} />
        <S
          label={f.prices_include_vat}
          name="prices_include_vat"
          defaultValue={String(c.prices_include_vat)}
          options={[
            { value: "true", label: f.prices_with_vat },
            { value: "false", label: f.prices_without_vat },
          ]}
        />
        <F label={f.iban} name="iban" defaultValue={c.iban ?? ""} autoCapitalize="characters" className="sm:col-span-2" optionalLabel={opt} />
        <F
          label={f.document_retention_years}
          name="document_retention_years"
          defaultValue={c.document_retention_years ?? ""}
          inputMode="numeric"
          optionalLabel={opt}
        />
        <TA label={f.fiscal_notes} name="fiscal_notes" defaultValue={c.fiscal_notes ?? ""} className="sm:col-span-2" optionalLabel={opt} />
      </div>
    </ActionForm>
  );
}

export function DefaultsForm({ c }: { c: CompanySettings }) {
  const { t } = useI18n();
  const f = t.settings.fields;
  const opt = t.common.optional;
  const [policy, setPolicy] = useState(c.default_mileage_policy);
  return (
    <ActionForm action={saveDefaultsAction}>
      <Notice>{t.settings.regionLocked}</Notice>
      <div className={grid}>
        <S
          label={f.default_locale}
          name="default_locale"
          defaultValue={c.default_locale}
          options={[
            { value: "es-ES", label: "Español (España)" },
            { value: "pt-BR", label: "Português (Brasil)" },
          ]}
        />
        <div className="grid grid-cols-2 gap-4">
          <F label={f.currency} name="_currency" value={c.currency} disabled readOnly />
          <F label={f.timezone} name="_tz" value={c.timezone} disabled readOnly />
        </div>
        <F label={`${f.default_daily_price} (€)`} name="default_daily_price" defaultValue={moneyInput(c.default_daily_price)} inputMode="decimal" optionalLabel={opt} />
        <F label={`${f.default_weekly_price} (€)`} name="default_weekly_price" defaultValue={moneyInput(c.default_weekly_price)} inputMode="decimal" optionalLabel={opt} />
        <F label={`${f.default_monthly_price} (€)`} name="default_monthly_price" defaultValue={moneyInput(c.default_monthly_price)} inputMode="decimal" optionalLabel={opt} />
        <F label={`${f.default_deposit_amount} (€)`} name="default_deposit_amount" defaultValue={moneyInput(c.default_deposit_amount)} inputMode="decimal" optionalLabel={opt} />
        <S
          label={f.default_mileage_policy}
          name="default_mileage_policy"
          value={policy}
          onChange={(e) => setPolicy(e.target.value as typeof policy)}
          options={MILEAGE_POLICIES.map((p) => ({ value: p, label: t.settings.mileage[p] }))}
        />
        <F
          label={f.rental_grace_minutes}
          name="rental_grace_minutes"
          defaultValue={String(c.rental_grace_minutes ?? 0)}
          inputMode="numeric"
          hint={t.settings.graceHint}
        />
        {policy !== "unlimited" && (
          <div className="grid grid-cols-2 gap-4">
            <F label={f.default_mileage_limit_km} name="default_mileage_limit_km" defaultValue={c.default_mileage_limit_km ?? ""} inputMode="numeric" required />
            <F label={`${f.default_excess_km_price} (€)`} name="default_excess_km_price" defaultValue={moneyInput(c.default_excess_km_price)} inputMode="decimal" optionalLabel={opt} />
          </div>
        )}
      </div>
    </ActionForm>
  );
}

export function ContractForm({ c }: { c: CompanySettings }) {
  const { t } = useI18n();
  const f = t.settings.fields;
  const opt = t.common.optional;
  return (
    <ActionForm action={saveContractAction}>
      <Notice>{t.settings.contractHint}</Notice>
      <TA label={f.rental_conditions_es} name="rental_conditions_es" defaultValue={c.rental_conditions_es ?? ""} rows={10} optionalLabel={opt} />
      <TA label={f.rental_conditions_pt} name="rental_conditions_pt" defaultValue={c.rental_conditions_pt ?? ""} rows={10} optionalLabel={opt} />
      <TA label={f.contract_footer} name="contract_footer" defaultValue={c.contract_footer ?? ""} rows={3} optionalLabel={opt} />
    </ActionForm>
  );
}
