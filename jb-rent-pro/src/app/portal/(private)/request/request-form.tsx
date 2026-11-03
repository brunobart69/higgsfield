"use client";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { addDays, todayInMadrid } from "@/lib/periods";
import { requestRentalAction } from "./actions";

function Fields() {
  const { t } = useI18n();
  const r = t.portal.request;
  const err = useFieldError();
  const start = addDays(todayInMadrid(), 1);
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <TextField label={r.pickupDate} name="pickup_date" type="date" min={todayInMadrid()} defaultValue={start} required className="col-span-1 sm:col-span-1" error={err("pickup_date")} />
      <TextField label={r.pickupTime} name="pickup_time" type="time" defaultValue="10:00" required error={err("pickup_time")} />
      <TextField label={r.returnDate} name="return_date" type="date" min={todayInMadrid()} defaultValue={addDays(start, 3)} required error={err("return_date")} />
      <TextField label={r.returnTime} name="return_time" type="time" defaultValue="10:00" required error={err("return_time")} />
      <TextField label={r.preference} name="preference" placeholder={r.preferencePlaceholder} optionalLabel={t.common.optional} className="col-span-2 sm:col-span-4" error={err("preference")} />
      <TextAreaField label={r.notes} name="notes" rows={3} optionalLabel={t.common.optional} className="col-span-2 sm:col-span-4" error={err("notes")} />
    </div>
  );
}

export function RequestForm() {
  const { t } = useI18n();
  return (
    <ActionForm action={requestRentalAction} submitLabel={t.portal.request.submit} successMessage={t.portal.request.sent} resetOnSuccess>
      <Fields />
    </ActionForm>
  );
}
