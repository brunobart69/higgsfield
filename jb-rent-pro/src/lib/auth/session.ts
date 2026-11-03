import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "owner" | "admin";

export type CurrentProfile = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: UserRole;
  companyId: string;
  companyName: string;
  locale: string;
  lastSignInAt: string | null;
};

export type SessionState =
  | { status: "anonymous" }
  | { status: "no_access"; email: string }
  | { status: "ok"; profile: CurrentProfile };

/** Usuário autenticado + perfil (memoizado por requisição). */
export const getSession = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: "anonymous" };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, role, company_id, locale, is_active, last_sign_in_at, companies(name)")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error || !data || !data.is_active) {
    return { status: "no_access", email: auth.user.email ?? "" };
  }
  const company = Array.isArray(data.companies) ? data.companies[0] : data.companies;
  return {
    status: "ok",
    profile: {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      phone: data.phone,
      role: data.role as UserRole,
      companyId: data.company_id,
      companyName: (company as { name?: string } | null)?.name ?? "JB RENT",
      locale: data.locale,
      lastSignInAt: data.last_sign_in_at,
    },
  };
});
