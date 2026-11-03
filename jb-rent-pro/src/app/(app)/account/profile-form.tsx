"use client";
import { SelectField, TextField } from "@/components/ui/field";
import { ActionForm, useFieldError } from "@/components/settings/action-form";
import { useI18n } from "@/lib/i18n/provider";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/config";
import { updateProfileAction } from "./actions";

function Fields({ fullName, phone, locale }: { fullName: string; phone: string; locale: string }) {
  const { t } = useI18n();
  const err = useFieldError();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label={t.account.name} name="full_name" defaultValue={fullName} autoComplete="name" required error={err("full_name")} />
      <TextField
        label={t.account.phone}
        name="phone"
        type="tel"
        inputMode="tel"
        defaultValue={phone}
        autoComplete="tel"
        optionalLabel={t.common.optional}
        error={err("phone")}
      />
      <SelectField
        label={t.account.language}
        name="locale"
        defaultValue={locale}
        options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l].name }))}
      />
    </div>
  );
}

export function ProfileForm(props: { fullName: string; phone: string; locale: string }) {
  const { t } = useI18n();
  return (
    <ActionForm action={updateProfileAction} successMessage={t.account.profileSaved}>
      <Fields {...props} />
    </ActionForm>
  );
}
