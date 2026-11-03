"use client";
import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import type { FormState } from "@/lib/auth/validation";
import { updatePasswordAction } from "../actions";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<FormState, FormData>(updatePasswordAction, {});
  const fe = state.fieldErrors ?? {};
  const reveal = { show: t.auth.showPassword, hide: t.auth.hidePassword };

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t.auth.resetTitle}</h1>
      <p className="mt-2 text-sm text-muted">{t.auth.resetSubtitle}</p>
      <form action={action} className="mt-8 space-y-5" noValidate>
        {state.error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {errorText(t, state.error)}
          </div>
        )}
        <FormField
          label={t.auth.newPassword}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint={t.auth.passwordHint}
          error={errorText(t, fe.password)}
          revealLabels={reveal}
        />
        <FormField
          label={t.auth.confirmPassword}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={errorText(t, fe.confirm)}
          revealLabels={reveal}
        />
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          {pending ? t.auth.updating : t.auth.updatePassword}
        </Button>
      </form>
    </>
  );
}
