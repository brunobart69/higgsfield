import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Cliente com a chave service_role. IGNORA A RLS — usar somente em Server
 * Actions que já verificaram que o usuário é administrador principal, e
 * apenas para operações do Auth Admin (convites, bloqueio de sessão,
 * ativação da área do cliente) e para gerar o contrato em PDF do portal
 * depois de o banco confirmar que o contrato pertence ao cliente logado.
 * Nunca importar em componentes cliente ("server-only" impede).
 */
export function isAdminConfigured() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length > 20;
}

export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
