import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signedUrlMap } from "@/lib/files/server";
import type { Checklist, DamageCategory, DamageSeverity, DamageStatus, InspectionType } from "./constants";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export const PAGE_SIZE = 25;

export type InspectionPhoto = { id: string; area: string; url: string | null; storage_path: string; created_at: string };

export type InspectionDetail = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  inspection_type: InspectionType;
  status: "draft" | "completed";
  performed_at: string;
  mileage: number | null;
  fuel_level: number | null;
  checklist: Checklist;
  existing_damages_confirmed: boolean;
  customer_present: boolean;
  customer_name: string | null;
  observations: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  vehicle: { id: string; brand: string; model: string; plate: string; current_mileage: number };
  rental: { id: string; contract_number: string; status: string; start_mileage: number | null; customer: string | null } | null;
  photos: InspectionPhoto[];
};

export async function getInspection(id: string): Promise<InspectionDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspections")
    .select(
      "*, vehicles(id, brand, model, plate, current_mileage), rentals(id, contract_number, status, start_mileage, customers(full_name, company_name, customer_type)), inspection_photos(id, area, storage_path, created_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  const photos = ((d.inspection_photos as Array<{ id: string; area: string; storage_path: string; created_at: string }>) ?? []).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const urls = await signedUrlMap(supabase, photos.map((p) => p.storage_path), 1800);
  const r = one(d.rentals as Rel<{ id: string; contract_number: string; status: string; start_mileage: number | null; customers: Rel<{ full_name: string | null; company_name: string | null; customer_type: string }> }>);
  const c = r ? one(r.customers) : null;
  return {
    ...(d as unknown as InspectionDetail),
    checklist: (d.checklist as Checklist) ?? {},
    vehicle: one(d.vehicles as Rel<InspectionDetail["vehicle"]>)!,
    rental: r
      ? { id: r.id, contract_number: r.contract_number, status: r.status, start_mileage: r.start_mileage, customer: (c?.customer_type === "company" ? c?.company_name : c?.full_name) ?? null }
      : null,
    photos: photos.map((p) => ({ ...p, url: urls[p.storage_path] ?? null })),
  };
}

export type InspectionListItem = {
  id: string;
  inspection_type: InspectionType;
  status: "draft" | "completed";
  performed_at: string;
  mileage: number | null;
  vehicle: string;
  plate: string;
  contract: string | null;
  issues: number;
};

function countIssues(c: Checklist) {
  return Object.values(c ?? {}).filter((e) => e && e.condition === "damaged").length;
}

export async function listInspections(opts: { vehicleId?: string; rentalId?: string; page?: number; limit?: number }) {
  const supabase = await createClient();
  let q = supabase
    .from("inspections")
    .select("id, inspection_type, status, performed_at, mileage, checklist, vehicles(brand, model, plate), rentals(contract_number)", { count: "exact" })
    .order("performed_at", { ascending: false });
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  if (opts.rentalId) q = q.eq("rental_id", opts.rentalId);
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  if (error) console.error("[inspections] list failed", error.code, error.message);
  return {
    total: count ?? 0,
    items: (data ?? []).map((r) => {
      const v = one(r.vehicles as Rel<{ brand: string; model: string; plate: string }>);
      const rent = one(r.rentals as Rel<{ contract_number: string }>);
      return {
        id: r.id as string,
        inspection_type: r.inspection_type as InspectionType,
        status: r.status as "draft" | "completed",
        performed_at: r.performed_at as string,
        mileage: r.mileage as number | null,
        vehicle: v ? `${v.brand} ${v.model}` : "—",
        plate: v?.plate ?? "",
        contract: rent?.contract_number ?? null,
        issues: countIssues(r.checklist as Checklist),
      } satisfies InspectionListItem;
    }),
  };
}

export type DamageListItem = {
  id: string;
  vehicle_id: string;
  detected_at: string;
  area: string | null;
  category: DamageCategory;
  severity: DamageSeverity;
  status: DamageStatus;
  description: string;
  estimated_cost: number | null;
  actual_cost: number | null;
  vehicle: string;
  plate: string;
  contract: string | null;
  rental_id: string | null;
};

export async function listDamages(opts: { vehicleId?: string; customerId?: string; rentalId?: string; openOnly?: boolean; page?: number; limit?: number }) {
  const supabase = await createClient();
  let q = supabase
    .from("damages")
    .select("id, vehicle_id, rental_id, detected_at, area, category, severity, status, description, estimated_cost, actual_cost, vehicles(brand, model, plate), rentals(contract_number)", { count: "exact" })
    .is("archived_at", null)
    .order("detected_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  if (opts.customerId) q = q.eq("customer_id", opts.customerId);
  if (opts.rentalId) q = q.eq("rental_id", opts.rentalId);
  if (opts.openOnly) q = q.neq("status", "resolved");
  const limit = opts.limit ?? PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  if (error) console.error("[damages] list failed", error.code, error.message);
  return {
    total: count ?? 0,
    items: (data ?? []).map((r) => {
      const v = one(r.vehicles as Rel<{ brand: string; model: string; plate: string }>);
      const rent = one(r.rentals as Rel<{ contract_number: string }>);
      return {
        id: r.id as string,
        vehicle_id: r.vehicle_id as string,
        rental_id: r.rental_id as string | null,
        detected_at: r.detected_at as string,
        area: r.area as string | null,
        category: r.category as DamageCategory,
        severity: r.severity as DamageSeverity,
        status: r.status as DamageStatus,
        description: r.description as string,
        estimated_cost: r.estimated_cost === null ? null : Number(r.estimated_cost),
        actual_cost: r.actual_cost === null ? null : Number(r.actual_cost),
        vehicle: v ? `${v.brand} ${v.model}` : "—",
        plate: v?.plate ?? "",
        contract: rent?.contract_number ?? null,
      } satisfies DamageListItem;
    }),
  };
}

export type DamageDetail = DamageListItem & {
  rental_id: string | null;
  customer_id: string | null;
  inspection_id: string | null;
  accident_id: string | null;
  mileage: number | null;
  repair_shop: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
  customer: string | null;
  photos: Array<{ id: string; url: string | null }>;
};

export async function getDamage(id: string): Promise<DamageDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("damages")
    .select("*, vehicles(brand, model, plate), rentals(contract_number), customers(full_name, company_name, customer_type), damage_photos(id, storage_path, created_at)")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  const v = one(d.vehicles as Rel<{ brand: string; model: string; plate: string }>);
  const rent = one(d.rentals as Rel<{ contract_number: string }>);
  const c = one(d.customers as Rel<{ full_name: string | null; company_name: string | null; customer_type: string }>);
  const photos = ((d.damage_photos as Array<{ id: string; storage_path: string; created_at: string }>) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const urls = await signedUrlMap(supabase, photos.map((p) => p.storage_path), 1800);
  return {
    ...(d as unknown as DamageDetail),
    estimated_cost: d.estimated_cost === null ? null : Number(d.estimated_cost),
    actual_cost: d.actual_cost === null ? null : Number(d.actual_cost),
    vehicle: v ? `${v.brand} ${v.model}` : "—",
    plate: v?.plate ?? "",
    contract: rent?.contract_number ?? null,
    customer: c ? ((c.customer_type === "company" ? c.company_name : c.full_name) ?? null) : null,
    photos: photos.map((p) => ({ id: p.id, url: urls[p.storage_path] ?? null })),
  };
}

/** Inspeções de entrega e devolução de um contrato (para o card e a comparação). */
export async function getRentalInspections(rentalId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inspections")
    .select("id, inspection_type, status, performed_at, mileage, fuel_level, checklist")
    .eq("rental_id", rentalId);
  const rows = (data ?? []) as Array<{ id: string; inspection_type: InspectionType; status: "draft" | "completed"; performed_at: string; mileage: number | null; fuel_level: number | null; checklist: Checklist }>;
  return {
    delivery: rows.find((r) => r.inspection_type === "delivery") ?? null,
    return: rows.find((r) => r.inspection_type === "return") ?? null,
  };
}
