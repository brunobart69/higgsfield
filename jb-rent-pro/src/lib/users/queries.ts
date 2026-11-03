import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/session";

export type CompanyUser = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  lastSignInAt: string | null;
  createdAt: string;
};

/** Usuários da empresa (a RLS limita à empresa do usuário autenticado). */
export async function listCompanyUsers(): Promise<{ ok: true; users: CompanyUser[] } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, role, is_active, last_sign_in_at, created_at")
    .order("role", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[users] list failed", error.code, error.message);
    return { ok: false };
  }
  return {
    ok: true,
    users: (data ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      phone: u.phone,
      role: u.role as UserRole,
      isActive: u.is_active,
      lastSignInAt: u.last_sign_in_at,
      createdAt: u.created_at,
    })),
  };
}
