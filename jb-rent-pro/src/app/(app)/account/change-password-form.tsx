"use client";
import { useActionState, useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import type { FormState } from "@/lib/auth/validation";
import { changePasswordAction } from "@/app/(auth)/actions";

export function ChangePasswordForm() {
  const { t } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  const fe = state.fieldErrors ?? {};
  const reveal = { show: t.auth.showPassword, hide: t.auth.hidePassword };

  useEffect(() => {
    if (state.ok) {
      toast.success(t.auth.passwordUpdated);
      formRef.current?.reset();
    }
  }, [state, t]);

  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:max-w-md" noValidate>
      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {errorText(t, state.error)}
        </div>
      )}
      <FormField label={t.auth.currentPassword} name="current" type="password" autoComplete="current-password" error={errorText(t, fe.current)} revealLabels={reveal} />
      <FormField label={t.auth.newPassword} name="password" type="password" autoComplete="new-password" error={errorText(t, fe.password)} revealLabels={reveal} />
      <FormField label={t.auth.confirmPassword} name="confirm" type="password" autoComplete="new-password" error={errorText(t, fe.confirm)} revealLabels={reveal} />
      <div>
        <Button type="submit" loading={pending}>
          {pending ? t.auth.updating : t.auth.updatePassword}
        </Button>
      </div>
    </form>
  );
}
