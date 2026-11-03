"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import type { FormState } from "@/lib/auth/validation";

const emailSchema = z.string().trim().toLowerCase().email("invalidEmail").max(254);

/**
 * Envia o código de acesso. Só funciona para e-mails já ativados pela empresa
 * (shouldCreateUser: false). A resposta é sempre a mesma para não revelar se o e-mail existe.
 */
export async function sendPortalCodeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(fd.get("email"));
  if (!parsed.success) return { fieldErrors: { email: "invalidEmail" }, values: { email: String(fd.get("email") ?? "").slice(0, 254) } };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/portal` },
  });
  if (error && (error.status === 429 || /rate/i.test(error.message))) return { error: "rateLimited", values: { email: parsed.data } };
  if (error) console.warn("[portal] otp request", error.status, error.code);
  return { ok: true, values: { email: parsed.data } };
}

export async function verifyPortalCodeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(fd.get("email"));
  const token = String(fd.get("token") ?? "").replace(/\s/g, "");
  if (!email.success || !/^\d{6,10}$/.test(token)) return { ok: true, error: "invalidCode", values: { email: String(fd.get("email") ?? "") } };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token, type: "email" });
  if (error) return { ok: true, error: error.status === 429 ? "rateLimited" : "invalidCode", values: { email: email.data } };
  const me = await supabase.rpc("portal_me");
  if (me.error || !me.data) {
    await supabase.auth.signOut();
    return { ok: true, error: "portalForbidden", values: { email: email.data } };
  }
  redirect("/portal");
}
