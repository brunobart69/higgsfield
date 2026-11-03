import { z } from "zod";

/** As mensagens são chaves de `errors.*` do dicionário (traduzidas na interface). */
export const emailSchema = z.string().trim().min(1, "required").email("invalidEmail").max(254, "invalidEmail");

export const passwordSchema = z
  .string()
  .min(10, "passwordTooShort")
  .max(128, "passwordTooShort")
  .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /\d/.test(v), "passwordWeak");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "required").max(128, "invalidCredentials"),
  next: z.string().optional(),
});

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string().min(1, "required") })
  .refine((v) => v.password === v.confirm, { message: "passwordMismatch", path: ["confirm"] });

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "required"),
    password: passwordSchema,
    confirm: z.string().min(1, "required"),
  })
  .refine((v) => v.password === v.confirm, { message: "passwordMismatch", path: ["confirm"] })
  .refine((v) => v.password !== v.current, { message: "samePassword", path: ["password"] });

export type FieldErrors = Partial<Record<string, string>>;

export type FormState = {
  ok?: boolean;
  error?: string; // chave de errors.*
  fieldErrors?: FieldErrors;
  message?: string; // chave de auth.*
  /** Valores não sensíveis devolvidos ao formulário (o React 19 limpa o form após a action). */
  values?: { email?: string };
};

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Converte erros do Supabase Auth em chaves de tradução. */
export function mapAuthError(err: { message?: string; status?: number; code?: string } | null): string {
  if (!err) return "generic";
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (err.status === 429 || code === "over_request_rate_limit" || msg.includes("rate limit")) return "rateLimited";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "invalidCredentials";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "emailNotConfirmed";
  if (code === "same_password" || msg.includes("different from the old")) return "samePassword";
  if (code === "weak_password") return "passwordWeak";
  if (code === "session_not_found" || code === "session_expired" || msg.includes("auth session missing")) return "sessionExpired";
  return "generic";
}
