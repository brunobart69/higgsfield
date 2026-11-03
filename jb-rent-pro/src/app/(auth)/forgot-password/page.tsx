"use client";
import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import type { FormState } from "@/lib/auth/validation";
import { requestPasswordResetAction } from "../actions";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordResetAction, {});

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t.auth.forgotTitle}</h1>
      <p className="mt-2 text-sm text-muted">{t.auth.forgotSubtitle}</p>

      {state.ok ? (
        <div role="status" className="mt-8 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-4 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {t.auth.resetSent}
        </div>
      ) : (
        <form action={action} className="mt-8 space-y-5" noValidate>
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
            error={errorText(t, state.fieldErrors?.email)}
          />
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            {pending ? t.auth.sending : t.auth.sendLink}
          </Button>
        </form>
      )}

      <Link href="/login" className="mt-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-foreground">
        <ArrowLeft className="size-4" /> {t.auth.backToLogin}
      </Link>
    </>
  );
}
