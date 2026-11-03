import "server-only";
import { createClient } from "@/lib/supabase/server";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Sincroniza as notificações com os alertas atuais (no banco, no máximo a cada
 * 5 minutos por empresa) e devolve as não lidas do usuário.
 */
export async function refreshAndCountNotifications(): Promise<number> {
  const supabase = await createClient();
  const r = await supabase.rpc("refresh_notifications");
  if (r.error && r.error.code !== "PGRST202") console.error("[notifications] refresh failed", r.error.code, r.error.message);
  const { data, error } = await supabase.rpc("unread_notifications");
  if (error) return 0;
  return Number(data ?? 0);
}

export type NotificationRow = {
  id: string;
  source: "alert" | "event";
  kind: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  entity: string | null;
  entity_id: string | null;
  due_date: string | null;
  created_at: string;
  resolved_at: string | null;
  read: boolean;
};

export async function listNotifications(view: "open" | "resolved"): Promise<NotificationRow[]> {
  const supabase = await createClient();
  let q = supabase.from("notifications").select("id, source, kind, severity, title, entity, entity_id, due_date, created_at, resolved_at, notification_reads(read_at)");
  q = view === "open" ? q.is("resolved_at", null) : q.not("resolved_at", "is", null).order("resolved_at", { ascending: false });
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) console.error("[notifications] list failed", error.code, error.message);
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  const rows = (data ?? []).map((r) => {
    const reads = r.notification_reads as Rel<{ read_at: string }> | Array<{ read_at: string }>;
    return { ...(r as unknown as NotificationRow), read: Array.isArray(reads) ? reads.length > 0 : !!one(reads) };
  });
  return view === "open" ? rows.sort((a, b) => Number(a.read) - Number(b.read) || rank[a.severity] - rank[b.severity]) : rows;
}

export type RentalRequest = {
  id: string;
  customer_id: string;
  customer: string;
  phone: string | null;
  email: string | null;
  pickup_at: string;
  return_at: string;
  vehicle_preference: string | null;
  notes: string | null;
  status: "new" | "contacted" | "converted" | "declined";
  rental_id: string | null;
  created_at: string;
};

export async function listRentalRequests(openOnly = true): Promise<RentalRequest[]> {
  const supabase = await createClient();
  let q = supabase
    .from("rental_requests")
    .select("id, customer_id, pickup_at, return_at, vehicle_preference, notes, status, rental_id, created_at, customers(full_name, company_name, customer_type, phone, email)");
  if (openOnly) q = q.in("status", ["new", "contacted"]);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
  if (error && error.code !== "PGRST205") console.error("[requests] list failed", error.code, error.message);
  return (data ?? []).map((r) => {
    const c = one(r.customers as Rel<{ full_name: string | null; company_name: string | null; customer_type: string; phone: string | null; email: string | null }>);
    return {
      ...(r as unknown as RentalRequest),
      customer: (c?.customer_type === "company" ? c?.company_name : c?.full_name) ?? "—",
      phone: c?.phone ?? null,
      email: c?.email ?? null,
    };
  });
}
