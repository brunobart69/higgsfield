import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signedUrlMap } from "@/lib/files/server";
import { sanitizeSearch } from "@/lib/search";
import { VEHICLES_PAGE_SIZE, VEHICLE_STATUSES, type VehicleStatus } from "./constants";

export type VehicleListItem = {
  id: string;
  brand: string;
  model: string;
  version: string | null;
  year: number | null;
  plate: string;
  status: VehicleStatus;
  current_mileage: number;
  daily_price: number | null;
  itv_due_date: string | null;
  category: string | null;
  fuel: string | null;
  transmission: string | null;
  archived_at: string | null;
  photoUrl: string | null;
};

export type VehicleDetail = VehicleListItem & {
  vin: string | null;
  color: string | null;
  vehicle_type: string | null;
  doors: number | null;
  seats: number | null;
  acquisition_date: string | null;
  purchase_price: number | null;
  market_value: number | null;
  fleet_entry_date: string | null;
  weekly_price: number | null;
  monthly_price: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const LIST_COLUMNS =
  "id, brand, model, version, year, plate, status, current_mileage, daily_price, itv_due_date, category, fuel, transmission, archived_at, main_photo_path";

export async function listVehicles(opts: { q?: string; status?: string; archived?: boolean; page: number }) {
  const supabase = await createClient();
  let query = supabase.from("vehicles").select(LIST_COLUMNS, { count: "exact" });
  query = opts.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (opts.status && (VEHICLE_STATUSES as readonly string[]).includes(opts.status)) query = query.eq("status", opts.status);
  const q = sanitizeSearch(opts.q);
  if (q) {
    const compact = q.replace(/\s/g, "");
    query = query.or(`plate.ilike.*${q}*,plate.ilike.*${compact}*,brand.ilike.*${q}*,model.ilike.*${q}*,vin.ilike.*${compact}*`);
  }
  const from = (opts.page - 1) * VEHICLES_PAGE_SIZE;
  const { data, error, count } = await query.order("plate").range(from, from + VEHICLES_PAGE_SIZE - 1);
  if (error) {
    console.error("[vehicles] list failed", error.code, error.message);
    return { ok: false as const };
  }
  const urls = await signedUrlMap(supabase, (data ?? []).map((v) => v.main_photo_path as string).filter(Boolean));
  return {
    ok: true as const,
    total: count ?? 0,
    items: (data ?? []).map(({ main_photo_path, ...v }) => ({
      ...(v as Omit<VehicleListItem, "photoUrl">),
      photoUrl: main_photo_path ? (urls[main_photo_path] ?? null) : null,
    })),
  };
}

/** Contagem por status para os filtros da lista. */
export async function countVehiclesByStatus(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicles").select("status").is("archived_at", null);
  const out: Record<string, number> = { all: 0 };
  for (const r of data ?? []) {
    out.all = (out.all ?? 0) + 1;
    out[r.status] = (out[r.status] ?? 0) + 1;
  }
  return out;
}

export async function getVehicle(id: string): Promise<VehicleDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicles").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const urls = data.main_photo_path ? await signedUrlMap(supabase, [data.main_photo_path]) : {};
  return { ...(data as VehicleDetail), photoUrl: data.main_photo_path ? (urls[data.main_photo_path] ?? null) : null };
}

export type VehiclePhoto = { id: string; kind: string; caption: string | null; url: string | null; created_at: string };

export async function listVehiclePhotos(vehicleId: string): Promise<VehiclePhoto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicle_photos")
    .select("id, kind, caption, storage_path, created_at")
    .eq("vehicle_id", vehicleId)
    .order("kind")
    .order("sort_order")
    .order("created_at");
  const urls = await signedUrlMap(supabase, (data ?? []).map((p) => p.storage_path));
  return (data ?? []).map((p) => ({ id: p.id, kind: p.kind, caption: p.caption, url: urls[p.storage_path] ?? null, created_at: p.created_at }));
}

export type VehicleDocument = {
  id: string;
  category: string;
  title: string;
  mime_type: string;
  size_bytes: number | null;
  issued_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export async function listVehicleDocuments(vehicleId: string): Promise<VehicleDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, category, title, mime_type, size_bytes, issued_at, expires_at, created_at")
    .eq("vehicle_id", vehicleId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as VehicleDocument[];
}

export async function listVehicleRentals(vehicleId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rentals")
    .select("id, contract_number, status, pickup_at, return_at, total_amount, customers(full_name, company_name, customer_type)")
    .eq("vehicle_id", vehicleId)
    .order("pickup_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => {
    const c = (Array.isArray(r.customers) ? r.customers[0] : r.customers) as
      | { full_name: string | null; company_name: string | null; customer_type: string }
      | null;
    return {
      id: r.id as string,
      contract_number: r.contract_number as string,
      status: r.status as string,
      pickup_at: r.pickup_at as string,
      return_at: r.return_at as string,
      total_amount: Number(r.total_amount),
      customer: c ? (c.customer_type === "company" ? c.company_name : c.full_name) : null,
    };
  });
}

export type VehicleFinancials = {
  revenue: number;
  expenses: number;
  investment: number;
  profit: number;
  rentals: number;
  rented_days: number;
  by_category: Array<{ type: string; category: string; total: number }>;
};

export async function getVehicleFinancials(vehicleId: string): Promise<VehicleFinancials | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vehicle_financials", { p_vehicle_id: vehicleId });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    revenue: Number(d.revenue ?? 0),
    expenses: Number(d.expenses ?? 0),
    investment: Number(d.investment ?? 0),
    profit: Number(d.profit ?? 0),
    rentals: Number(d.rentals ?? 0),
    rented_days: Number(d.rented_days ?? 0),
    by_category: ((d.by_category as Array<Record<string, unknown>>) ?? []).map((c) => ({
      type: String(c.type),
      category: String(c.category),
      total: Number(c.total),
    })),
  };
}

/** Histórico de alterações de um registro (a RLS limita administradores às próprias ações). */
export async function listEntityHistory(entities: string[], entityId: string, limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_logs")
    .select("id, created_at, user_id, action, entity, entity_id, changes, ip_address, user_agent")
    .in("entity", entities)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id as number,
    createdAt: r.created_at as string,
    userId: r.user_id as string | null,
    action: r.action as string,
    entity: r.entity as string,
    entityId: r.entity_id as string | null,
    changes: (r.changes as Record<string, unknown> | null) ?? null,
    ip: (r.ip_address as string | null) ?? null,
    userAgent: r.user_agent as string | null,
  }));
}

/** Preços padrão da empresa para pré-preencher um novo veículo. */
export async function getDefaultPrices() {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("default_daily_price, default_weekly_price, default_monthly_price").maybeSingle();
  return {
    daily_price: (data?.default_daily_price as number | null) ?? null,
    weekly_price: (data?.default_weekly_price as number | null) ?? null,
    monthly_price: (data?.default_monthly_price as number | null) ?? null,
  };
}
