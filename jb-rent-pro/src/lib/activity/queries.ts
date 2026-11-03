import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/periods";
import { ACTIVITY_PAGE_SIZE, madridStartOfDay, type ActivityEntry, type ActivityFilters } from "./utils";

export * from "./utils";

/** Lista paginada; a RLS já restringe administradores às próprias ações. */
export async function listActivity(f: ActivityFilters): Promise<{ ok: true; rows: ActivityEntry[]; total: number } | { ok: false }> {
  const supabase = await createClient();
  let q = supabase
    .from("activity_logs")
    .select("id, created_at, user_id, action, entity, entity_id, changes, ip_address, user_agent", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (f.userId) q = q.eq("user_id", f.userId);
  if (f.entity) q = q.eq("entity", f.entity);
  if (f.action) q = q.eq("action", f.action);
  if (f.from) q = q.gte("created_at", madridStartOfDay(f.from));
  if (f.to) q = q.lt("created_at", madridStartOfDay(addDays(f.to, 1)));
  const start = (f.page - 1) * ACTIVITY_PAGE_SIZE;
  const { data, error, count } = await q.range(start, start + ACTIVITY_PAGE_SIZE - 1);
  if (error) {
    console.error("[activity] list failed", error.code, error.message);
    return { ok: false };
  }
  return {
    ok: true,
    total: count ?? 0,
    rows: (data ?? []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      userId: r.user_id,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      changes: (r.changes as Record<string, unknown> | null) ?? null,
      ip: (r.ip_address as string | null) ?? null,
      userAgent: r.user_agent,
    })),
  };
}

/** Últimos acessos do próprio usuário. */
export async function listMyAccess(userId: string, limit = 10) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_logs")
    .select("id, created_at, ip_address, user_agent")
    .eq("user_id", userId)
    .eq("action", "auth.login")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id as number,
    createdAt: r.created_at as string,
    ip: (r.ip_address as string | null) ?? null,
    userAgent: (r.user_agent as string | null) ?? null,
  }));
}

