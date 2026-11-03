/**
 * Variáveis públicas do Supabase. A chave "anon" é pública por design:
 * a segurança é garantida pelas políticas RLS do banco.
 * A chave service_role NUNCA é lida aqui (apenas em código de servidor, fase 2).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
}
