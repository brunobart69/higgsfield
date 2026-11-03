"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { MANUAL_EXPENSE, MANUAL_INCOME } from "@/lib/finance/constants";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { todayInMadrid } from "@/lib/periods";
import { saveEntryAction } from "@/app/(app)/financial/actions";

export type EntryFormValues = {
  id?: string;
  type?: "income" | "expense";
  category?: string;
  description?: string;
  amount?: number;
  vat_rate?: number | null;
  competence_date?: string;
  due_date?: string | null;
  vehicle_id?: string | null;
  reference?: string | null;
  notes?: string | null;
  payment_method?: string | null;
};

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

function Fields({ v, vehicles }: { v: EntryFormValues; vehicles: Array<{ value: string; label: string }> }) {
  const { t } = useI18n();
  const f = t.financial.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const isEdit = !!v.id;
  const [type, setType] = useState<"income" | "expense">(v.type ?? "expense");
  const [status, setStatus] = useState<"pending" | "paid">("pending");
  const [inst, setInst] = useState("1");
  const cats = type === "income" ? MANUAL_INCOME : MANUAL_EXPENSE;
  const today = todayInMadrid();
  return (
    <>
      <input type="hidden" name="id" value={v.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        {isEdit ? (
          <input type="hidden" name="type" value={type} />
        ) : (
          <div role="radiogroup" aria-label={f.type} className="flex gap-2 sm:col-span-2">
            {(["expense", "income"] as const).map((k) => (
              <label
                key={k}
                className={`flex h-11 flex-1 cursor-pointer items-center justify-center rounded-md border text-sm ${type === k ? "border-gold/60 bg-gold/10 text-gold-light" : "border-border bg-surface-2 text-muted"}`}
              >
                <input type="radio" name="type" value={k} checked={type === k} onChange={() => setType(k)} className="sr-only" />
                {f.types[k]}
              </label>
            ))}
          </div>
        )}
        <SelectField
          key={type}
          label={f.category}
          name="category"
          defaultValue={v.category && (cats as readonly string[]).includes(v.category) ? v.category : cats[0]}
          error={err("category")}
          options={cats.map((c) => ({ value: c, label: t.financeCategories[c] }))}
        />
        <TextField label={f.amount} name="amount" defaultValue={money(v.amount)} inputMode="decimal" required error={err("amount")} />
        <TextField label={f.description} name="description" defaultValue={v.description ?? ""} required className="sm:col-span-2" error={err("description")} />
        <TextField label={f.competence_date} name="competence_date" type="date" defaultValue={v.competence_date ?? today} required error={err("competence_date")} />
        <TextField label={f.due_date} name="due_date" type="date" defaultValue={v.due_date ?? ""} optionalLabel={opt} error={err("due_date")} />
        {!isEdit && (
          <>
            <SelectField
              label={f.status}
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as "pending" | "paid")}
              options={[
                { value: "pending", label: f.statusPending },
                { value: "paid", label: f.statusPaid },
              ]}
            />
            {status === "paid" ? (
              <TextField label={f.paid_at} name="paid_at" type="date" defaultValue={today} required error={err("paid_at")} />
            ) : (
              <TextField
                label={f.installments}
                name="installments"
                value={inst}
                onChange={(e) => setInst(e.target.value)}
                inputMode="numeric"
                hint={f.installmentsHint}
                error={err("installments")}
              />
            )}
          </>
        )}
        {isEdit && <input type="hidden" name="status" value="pending" />}
        <SelectField
          label={f.payment_method}
          name="payment_method"
          defaultValue={v.payment_method ?? ""}
          optionalLabel={opt}
          options={[{ value: "", label: "—" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))]}
        />
        <SelectField label={f.vehicle} name="vehicle_id" defaultValue={v.vehicle_id ?? ""} optionalLabel={opt} options={[{ value: "", label: "—" }, ...vehicles]} />
        <TextField label={f.vat_rate} name="vat_rate" defaultValue={v.vat_rate ?? ""} inputMode="decimal" optionalLabel={opt} error={err("vat_rate")} />
        <TextField label={f.reference} name="reference" defaultValue={v.reference ?? ""} optionalLabel={opt} error={err("reference")} />
        <TextAreaField label={f.notes} name="notes" defaultValue={v.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" />
      </div>
      <p className="text-xs text-subtle">{t.financial.taxNote}</p>
    </>
  );
}

export function EntryDialog({
  values,
  vehicles,
  size = "default",
  iconOnly = false,
}: {
  values: EntryFormValues;
  vehicles: Array<{ value: string; label: string }>;
  size?: "default" | "sm";
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = !!values.id;
  const title = isEdit ? t.financial.entries.edit : t.financial.entries.new;
  return (
    <>
      <Button size={size} variant={isEdit ? "ghost" : "default"} onClick={() => setOpen(true)} aria-label={iconOnly ? title : undefined}>
        {isEdit ? <Pencil /> : <Plus />} {!iconOnly && title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={saveEntryAction}
              successMessage={t.financial.entries.saved}
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
