"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertCircle, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/config";
import type { FormState } from "@/lib/auth/validation";
import { sendPortalCodeAction, verifyPortalCodeAction } from "./actions";

export function PortalLoginForm({ initialError }: { initialError?: string }) {
  const { t } = useI18n();
  const l = t.portal.login;
  const [sent, send, sending] = useActionState<FormState, FormData>(sendPortalCodeAction, { error: initialError });
  const [verified, verify, verifying] = useActionState<FormState, FormData>(verifyPortalCodeAction, {});
  const [reset, setReset] = useState(0);
  const step = sent.ok && reset === 0 ? "code" : "email";
  const email = sent.values?.email ?? "";
  const err = step === "code" ? verified.error : sent.error;
  const msg = err === "invalidCode" ? l.invalidCode : err === "linkError" ? l.linkError : errorText(t, err);

  return (
    <div className="mt-8 space-y-5">
      {msg && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {msg}
        </div>
      )}
      {step === "email" ? (
        <form action={(fd) => { setReset(0); send(fd); }} className="space-y-5" noValidate>
          <FormField
            label={l.email}
            name="email"
            type="email"
            defaultValue={email}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            required
            error={errorText(t, sent.fieldErrors?.email)}
          />
          <Button type="submit" className="w-full" size="lg" loading={sending}>
            {l.sendCode}
          </Button>
        </form>
      ) : (
        <form action={verify} className="space-y-5" noValidate>
          <p className="flex items-start gap-2 rounded-md border border-gold/30 bg-gold/10 p-3 text-sm text-gold-light">
            <MailCheck className="mt-0.5 size-4 shrink-0" /> {interpolate(l.codeSent, { email })}
          </p>
          <input type="hidden" name="email" value={email} />
          <FormField label={l.code} name="token" inputMode="numeric" autoComplete="one-time-code" maxLength={10} required className="[&_input]:text-center [&_input]:tracking-[0.3em]" />
          <Button type="submit" className="w-full" size="lg" loading={verifying}>
            {l.verify}
          </Button>
          <button type="button" onClick={() => setReset((v) => v + 1)} className="w-full text-center text-xs text-gold hover:underline">
            {l.resend}
          </button>
        </form>
      )}
      <p className="text-center text-xs text-subtle">
        <Link href="/login" className="hover:text-foreground hover:underline">
          {l.staff}
        </Link>
      </p>
    </div>
  );
}
