"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  changePasswordSchema,
  forgotSchema,
  mapAuthError,
  resetSchema,
  signInSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/auth/validation";
import { safeInternalPath } from "@/lib/utils";
import { clientIp, siteUrl } from "@/lib/site";

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  const values = { email: String(formData.get("email") ?? "").slice(0, 254) };
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) return { error: mapAuthError(error), values };

  // Somente contas vinculadas a uma empresa (perfil ativo) acessam o painel.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return { error: "noAccess", values };
  }

  const ua = (await headers()).get("user-agent");
  const { error: logError } = await supabase.rpc("log_sign_in", { p_user_agent: ua, p_ip: await clientIp() });
  if (logError) console.error("[auth] log_sign_in failed", logError.message);

  redirect(safeInternalPath(parsed.data.next));
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotSchema.safeParse({ email: formData.get("email") });
  const values = { email: String(formData.get("email") ?? "").slice(0, 254) };
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error && mapAuthError(error) === "rateLimited") return { error: "rateLimited", values };
  if (error) console.error("[auth] reset request failed", error.message);
  // Resposta idêntica exista ou não a conta (evita enumeração de e-mails).
  return { ok: true, message: "resetSent" };
}

export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "invalidLink" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: mapAuthError(error) };
  redirect("/dashboard?password=updated");
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return { error: "sessionExpired" };

  // Reautenticação: confirma a senha atual antes de trocar.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: auth.user.email,
    password: parsed.data.current,
  });
  if (reauthError) {
    const key = mapAuthError(reauthError);
    return key === "invalidCredentials" ? { fieldErrors: { current: "wrongCurrentPassword" } } : { error: key };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: mapAuthError(error) };
  return { ok: true, message: "passwordUpdated" };
}
