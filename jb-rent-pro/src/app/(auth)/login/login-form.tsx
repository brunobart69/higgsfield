"use client";
import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useI18n } from "@/lib/i18n/provider";
import type { FormState } from "@/lib/auth/validation";
import { errorText } from "@/lib/i18n/errors";
import { signInAction } from "../actions";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<FormState, FormData>(signInAction, {
    error: initialError,
  });
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {errorText(t, state.error)}
        </div>
      )}
      <FormField
        label={t.auth.email}
        name="email"
        type="email"
        defaultValue={state.values?.email}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        required
        error={errorText(t, fe.email)}
      />
      <FormField
        label={t.auth.password}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={errorText(t, fe.password)}
        revealLabels={{ show: t.auth.showPassword, hide: t.auth.hidePassword }}
      />
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-xs text-gold hover:underline">
          {t.auth.forgotPassword}
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {pending ? t.auth.signingIn : t.auth.signIn}
      </Button>
    </form>
  );
}
