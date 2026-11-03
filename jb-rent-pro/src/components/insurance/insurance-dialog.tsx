"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { todayInMadrid, addDays } from "@/lib/periods";
import { saveInsuranceAction } from "@/app/(app)/insurance/actions";

export type InsuranceFormValues = {
  id?: string;
  vehicle_id?: string;
  renewed_from_id?: string | null;
  insurer?: string;
  policy_number?: string;
  coverage_type?: string | null;
  start_date?: string;
  end_date?: string;
  premium_amount?: number | null;
  deductible_amount?: number | null;
  roadside_assistance?: boolean;
  assistance_phone?: string | null;
  paid_at?: string | null;
  payment_method?: string | null;
  notes?: string | null;
};

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

function Fields({ v, vehicles }: { v: InsuranceFormValues; vehicles?: Array<{ value: string; label: string }> }) {
  const { t } = useI18n();
  const f = t.insurance.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const today = todayInMadrid();
  return (
    <>
      <input type="hidden" name="id" value={v.id ?? ""} />
      <input type="hidden" name="renewed_from_id" value={v.renewed_from_id ?? ""} />
      {vehicles ? (
        <SelectField
          label={f.vehicle}
          name="vehicle_id"
          defaultValue={v.vehicle_id ?? ""}
          required
          error={err("vehicle_id")}
          options={[{ value: "", label: "—" }, ...vehicles]}
        />
      ) : (
        <input type="hidden" name="vehicle_id" value={v.vehicle_id ?? ""} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={f.insurer} name="insurer" defaultValue={v.insurer ?? ""} required autoComplete="off" error={err("insurer")} />
        <TextField label={f.policy_number} name="policy_number" defaultValue={v.policy_number ?? ""} required autoComplete="off" className="[&_input]:uppercase" error={err("policy_number")} />
        <TextField label={f.start_date} name="start_date" type="date" defaultValue={v.start_date ?? today} required error={err("start_date")} />
        <TextField label={f.end_date} name="end_date" type="date" defaultValue={v.end_date ?? addDays(today, 365)} required error={err("end_date")} />
        <TextField label={f.coverage_type} name="coverage_type" defaultValue={v.coverage_type ?? ""} placeholder={f.coveragePlaceholder} optionalLabel={opt} className="sm:col-span-2" error={err("coverage_type")} />
        <TextField label={f.premium_amount} name="premium_amount" defaultValue={money(v.premium_amount)} inputMode="decimal" optionalLabel={opt} error={err("premium_amount")} />
        <TextField label={f.deductible_amount} name="deductible_amount" defaultValue={money(v.deductible_amount)} inputMode="decimal" optionalLabel={opt} error={err("deductible_amount")} />
        <TextField label={f.paid_at} name="paid_at" type="date" defaultValue={v.paid_at ?? ""} optionalLabel={opt} error={err("paid_at")} />
        <SelectField
          label={f.payment_method}
          name="payment_method"
          defaultValue={v.payment_method ?? ""}
          optionalLabel={opt}
          options={[{ value: "", label: "—" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))]}
        />
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3.5 text-sm sm:col-span-2">
          <input type="checkbox" name="roadside_assistance" defaultChecked={v.roadside_assistance ?? false} className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]" />
          <span>{f.roadside_assistance}</span>
        </label>
        <TextField label={f.assistance_phone} name="assistance_phone" defaultValue={v.assistance_phone ?? ""} inputMode="tel" optionalLabel={opt} error={err("assistance_phone")} />
        <TextAreaField label={f.notes} name="notes" defaultValue={v.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" error={err("notes")} />
      </div>
      <p className="text-xs text-subtle">{t.insurance.premiumNote}</p>
    </>
  );
}

/** Nova apólice, edição ou renovação (nova apólice ligada à anterior). */
export function InsuranceDialog({
  values,
  mode = "new",
  vehicles,
  size = "default",
  variant,
}: {
  values: InsuranceFormValues;
  mode?: "new" | "edit" | "renew";
  /** Lista de veículos quando o veículo não é fixo. */
  vehicles?: Array<{ value: string; label: string }>;
  size?: "default" | "sm";
  variant?: "default" | "secondary";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const title = mode === "edit" ? t.insurance.edit : mode === "renew" ? t.insurance.renewTitle : t.insurance.new;
  const Icon = mode === "edit" ? Pencil : mode === "renew" ? RefreshCw : Plus;
  return (
    <>
      <Button size={size} variant={variant ?? (mode === "new" ? "default" : "secondary")} onClick={() => setOpen(true)}>
        <Icon /> {mode === "renew" ? t.insurance.renew : title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={mode === "renew" ? t.insurance.renewHint : undefined} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={async (p, fd) => {
                const res = await saveInsuranceAction(p, fd);
                if (res.ok && mode !== "edit" && res.vars?.id) router.push(`/insurance/${res.vars.id}`);
                return res;
              }}
              successMessage={t.insurance.saved}
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
