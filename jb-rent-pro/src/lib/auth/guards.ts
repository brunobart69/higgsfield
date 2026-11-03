import "server-only";
import { getSession, type CurrentProfile } from "./session";

export type GuardResult = { ok: true; profile: CurrentProfile } | { ok: false; error: "sessionExpired" | "forbidden" };

/** Usuário autenticado com perfil ativo (proprietário ou administrador). */
export async function requireStaff(): Promise<GuardResult> {
  const s = await getSession();
  if (s.status === "anonymous") return { ok: false, error: "sessionExpired" };
  if (s.status === "no_access") return { ok: false, error: "forbidden" };
  return { ok: true, profile: s.profile };
}

/** Somente ADMINISTRADOR PRINCIPAL. A RLS do banco aplica a mesma regra. */
export async function requireOwner(): Promise<GuardResult> {
  const r = await requireStaff();
  if (!r.ok) return r;
  if (r.profile.role !== "owner") return { ok: false, error: "forbidden" };
  return r;
}
