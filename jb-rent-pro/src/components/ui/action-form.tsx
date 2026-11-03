"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import type { FormState } from "@/lib/auth/validation";

type Ctx = { error: (name: string) => string | undefined };
const FormErrorsContext = createContext<Ctx>({ error: () => undefined });

/** Erro traduzido de um campo do formulário atual. */
export function useFieldError() {
  return useContext(FormErrorsContext).error;
}

/**
 * Formulário ligado a uma Server Action: mostra erros por campo, alerta geral,
 * estado de carregamento e notificação de sucesso.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  successMessage,
  onSuccess,
  resetOnSuccess = false,
  className,
  encType,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel?: string;
  successMessage?: string;
  onSuccess?: () => void;
  resetOnSuccess?: boolean;
  className?: string;
  encType?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) {
      toast.success(successMessage ?? t.common.saved);
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const ctx: Ctx = { error: (name) => errorText(t, state.fieldErrors?.[name], state.vars) };

  return (
    <FormErrorsContext.Provider value={ctx}>
      <form
        ref={ref}
        className={className ?? "space-y-5"}
        noValidate
        encType={encType}
        onSubmit={(e) => {
          // envio manual: evita o reset automático do React 19, preservando o que foi digitado quando há erro
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
      >
        <FormAlert message={errorText(t, state.error, state.vars)} />
        {children}
        <div className="flex justify-end pt-1">
          <Button type="submit" loading={pending} className="w-full sm:w-auto">
            {pending ? t.common.saving : (submitLabel ?? t.common.save)}
          </Button>
        </div>
      </form>
    </FormErrorsContext.Provider>
  );
}
