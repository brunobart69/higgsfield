import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import type { DueStatus, MaintenanceStatus, MaintenanceType } from "./constants";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const MAINTENANCE_PAGE_SIZE = 30;

export type MaintenanceRow = {
  id: string;
  vehicle_id: string;
  plan_id: string | null;
  damage_id: string | null;
  maintenance_type: MaintenanceType;
  status: MaintenanceStatus;
  title: string;
  description: string | null;
  scheduled_date: string | null;
  started_at: string | null;
  completed_date: string | null;
  mileage: number | null;
  workshop: string | null;
  cost: number | null;
  invoice_number: string | null;
  paid_at: string | null;
  payment_method: string | null;
  blocks_vehicle: boolean;
  cancel_reason: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  vehicle: { brand: string; model: string; plate: string; current_mileage: number };
  plan: { name: string } | null;
  damage: { description: string; status: string } | null;
};

const SELECT =
  "*, vehicles(brand, model, plate, current_mileage), maintenance_plans(name), damages(description, status)";

function map(r: Record<string, unknown>): MaintenanceRow {
  return {
    ...(r as unknown as MaintenanceRow),
    cost: n(r.cost),
    vehicle: one(r.vehicles as Rel<MaintenanceRow["vehicle"]>) ?? { brand: "", model: "", plate: "", current_mileage: 0 },
    plan: one(r.maintenance_plans as Rel<{ name: string }>),
    damage: one(r.damages as Rel<{ description: string; status: string }>),
  };
}

export async function listMaintenance(f: { view: "agenda" | "history" | "all"; vehicleId?: string; damageId?: string; q?: string; page?: number }) {
  const supabase = await createClient();
  const page = f.page ?? 1;
  const from = (page - 1) * MAINTENANCE_PAGE_SIZE;
  let q = supabase.from("maintenance_records").select(SELECT, { count: "exact" }).is("archived_at", null);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
  if (f.damageId) q = q.eq("damage_id", f.damageId);
  const s = sanitizeSearch(f.q);
  if (s) q = q.or(`title.ilike.%${s}%,workshop.ilike.%${s}%`);
  q =
    f.view === "all"
      ? q.order("created_at", { ascending: false })
      : f.view === "agenda"
      ? q.in("status", ["scheduled", "in_progress"]).order("status", { ascending: false }).order("scheduled_date", { ascending: true, nullsFirst: false })
      : q.in("status", ["completed", "cancelled"]).order("completed_date", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false });
  const { data, count, error } = await q.range(from, from + MAINTENANCE_PAGE_SIZE - 1);
  if (error) console.error("[maintenance] list failed", error.code, error.message);
  return { total: count ?? 0, items: (data ?? []).map((r) => map(r as Record<string, unknown>)) };
}

export async function getMaintenance(id: string): Promise<MaintenanceRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("maintenance_records").select(SELECT).eq("id", id).maybeSingle();
  return data ? map(data as Record<string, unknown>) : null;
}

export type PlanRow = {
  id: string;
  vehicle_id: string;
  vehicle: string;
  name: string;
  maintenance_type: MaintenanceType;
  interval_km: number | null;
  interval_months: number | null;
  last_done_date: string | null;
  last_done_mileage: number | null;
  notes: string | null;
  next_date: string | null;
  next_km: number | null;
  current_km: number;
  days_left: number | null;
  km_left: number | null;
  due_status: DueStatus;
  open_record_id: string | null;
};

/** Planos com o vencimento calculado no banco (maintenance_due). */
export async function listPlans(vehicleId?: string): Promise<PlanRow[]> {
  const supabase = await createClient();
  let pq = supabase.from("maintenance_plans").select("id, vehicle_id, name, maintenance_type, interval_km, interval_months, last_done_date, last_done_mileage, notes").is("archived_at", null);
  if (vehicleId) pq = pq.eq("vehicle_id", vehicleId);
  const [due, plans, open] = await Promise.all([
    supabase.rpc("maintenance_due"),
    pq,
    supabase.from("maintenance_records").select("id, plan_id").in("status", ["scheduled", "in_progress"]).not("plan_id", "is", null).is("archived_at", null),
  ]);
  const byId = new Map(((plans.data ?? []) as Array<Record<string, unknown>>).map((p) => [p.id as string, p]));
  const openBy = new Map(((open.data ?? []) as Array<{ id: string; plan_id: string }>).map((r) => [r.plan_id, r.id]));
  return ((due.data ?? []) as Array<Record<string, unknown>>)
    .filter((d) => byId.has(d.plan_id as string))
    .map((d) => {
      const p = byId.get(d.plan_id as string)!;
      return {
        id: d.plan_id as string,
        vehicle_id: d.vehicle_id as string,
        vehicle: d.vehicle as string,
        name: d.name as string,
        maintenance_type: d.maintenance_type as MaintenanceType,
        interval_km: n(p.interval_km),
        interval_months: n(p.interval_months),
        last_done_date: (p.last_done_date as string) ?? null,
        last_done_mileage: n(p.last_done_mileage),
        notes: (p.notes as string) ?? null,
        next_date: (d.next_date as string) ?? null,
        next_km: n(d.next_km),
        current_km: Number(d.current_km ?? 0),
        days_left: n(d.days_left),
        km_left: n(d.km_left),
        due_status: d.due_status as DueStatus,
        open_record_id: openBy.get(d.plan_id as string) ?? null,
      };
    });
}

export async function getMaintenanceOverview() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("maintenance_overview");
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    inProgress: Number(d.in_progress ?? 0),
    scheduled: Number(d.scheduled ?? 0),
    overdue: Number(d.overdue ?? 0),
    dueSoon: Number(d.due_soon ?? 0),
    costYear: Number(d.cost_year ?? 0),
  };
}

/** Veículos e planos para os formulários. */
export async function getMaintenanceFormOptions() {
  const supabase = await createClient();
  const [v, p] = await Promise.all([
    supabase.from("vehicles").select("id, brand, model, plate, current_mileage").is("archived_at", null).neq("status", "sold").order("plate"),
    supabase.from("maintenance_plans").select("id, vehicle_id, name, maintenance_type").is("archived_at", null).order("name"),
  ]);
  return {
    vehicles: (v.data ?? []).map((x) => ({ value: x.id as string, label: `${x.plate} · ${x.brand} ${x.model}`, mileage: Number(x.current_mileage ?? 0) })),
    plans: (p.data ?? []).map((x) => ({ value: x.id as string, vehicle_id: x.vehicle_id as string, label: x.name as string, type: x.maintenance_type as MaintenanceType })),
  };
}
