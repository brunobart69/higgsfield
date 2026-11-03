import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import { signedUrlMap } from "@/lib/files/server";
import type { AccidentFault, AccidentStatus, FineStatus } from "./constants";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
type CustomerRel = { full_name: string | null; company_name: string | null; customer_type: string };
const customerName = (c: CustomerRel | null) => (c ? ((c.customer_type === "company" ? c.company_name : c.full_name) ?? "—") : null);

export type Fine = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  customer_id: string | null;
  infraction_at: string;
  authority: string;
  reference: string | null;
  infraction: string;
  location: string | null;
  points: number | null;
  amount: number;
  notified_at: string | null;
  identification_deadline: string | null;
  payment_deadline: string | null;
  status: FineStatus;
  identified_at: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  payment_method: string | null;
  recharge_amount: number | null;
  recharge_paid_at: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  vehicle: { brand: string; model: string; plate: string };
  contract: string | null;
  customer: string | null;
};

const FINE_SELECT = "*, vehicles(brand, model, plate), rentals(contract_number), customers(full_name, company_name, customer_type)";

function mapFine(r: Record<string, unknown>): Fine {
  return {
    ...(r as unknown as Fine),
    amount: Number(r.amount),
    paid_amount: n(r.paid_amount),
    recharge_amount: n(r.recharge_amount),
    vehicle: one(r.vehicles as Rel<Fine["vehicle"]>) ?? { brand: "", model: "", plate: "" },
    contract: one(r.rentals as Rel<{ contract_number: string }>)?.contract_number ?? null,
    customer: customerName(one(r.customers as Rel<CustomerRel>)),
  };
}

export async function listFines(f: { open?: boolean; q?: string; vehicleId?: string; customerId?: string; rentalId?: string } = {}): Promise<Fine[]> {
  const supabase = await createClient();
  let q = supabase.from("traffic_fines").select(FINE_SELECT).is("archived_at", null);
  if (f.open) q = q.in("status", ["pending", "appealed"]);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
  if (f.customerId) q = q.eq("customer_id", f.customerId);
  if (f.rentalId) q = q.eq("rental_id", f.rentalId);
  const s = sanitizeSearch(f.q);
  if (s) q = q.or(`authority.ilike.%${s}%,reference.ilike.%${s}%,infraction.ilike.%${s}%`);
  const { data, error } = await q.order("infraction_at", { ascending: false }).limit(200);
  if (error) console.error("[fines] list failed", error.code, error.message);
  return (data ?? []).map((r) => mapFine(r as Record<string, unknown>));
}

export async function getFine(id: string): Promise<Fine | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("traffic_fines").select(FINE_SELECT).eq("id", id).maybeSingle();
  return data ? mapFine(data as Record<string, unknown>) : null;
}

export type Accident = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  customer_id: string | null;
  insurance_policy_id: string | null;
  occurred_at: string;
  location: string | null;
  description: string;
  status: AccidentStatus;
  fault: AccidentFault;
  injuries: boolean;
  third_party: boolean;
  third_party_details: string | null;
  police_report: boolean;
  police_report_number: string | null;
  amicable_report: boolean;
  insurer_claim_number: string | null;
  reported_to_insurer_at: string | null;
  estimated_cost: number | null;
  deductible_amount: number | null;
  deductible_paid_at: string | null;
  insurer_payout: number | null;
  insurer_payout_at: string | null;
  closed_at: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  vehicle: { brand: string; model: string; plate: string };
  contract: string | null;
  customer: string | null;
  policy: { insurer: string; policy_number: string; deductible_amount: number | null; assistance_phone: string | null } | null;
};

const ACC_SELECT =
  "*, vehicles(brand, model, plate), rentals(contract_number), customers(full_name, company_name, customer_type), insurance_policies(insurer, policy_number, deductible_amount, assistance_phone)";

function mapAccident(r: Record<string, unknown>): Accident {
  const p = one(r.insurance_policies as Rel<{ insurer: string; policy_number: string; deductible_amount: unknown; assistance_phone: string | null }>);
  return {
    ...(r as unknown as Accident),
    estimated_cost: n(r.estimated_cost),
    deductible_amount: n(r.deductible_amount),
    insurer_payout: n(r.insurer_payout),
    vehicle: one(r.vehicles as Rel<Accident["vehicle"]>) ?? { brand: "", model: "", plate: "" },
    contract: one(r.rentals as Rel<{ contract_number: string }>)?.contract_number ?? null,
    customer: customerName(one(r.customers as Rel<CustomerRel>)),
    policy: p ? { insurer: p.insurer, policy_number: p.policy_number, deductible_amount: n(p.deductible_amount), assistance_phone: p.assistance_phone } : null,
  };
}

export async function listAccidents(f: { open?: boolean; vehicleId?: string; customerId?: string; rentalId?: string; q?: string } = {}): Promise<Accident[]> {
  const supabase = await createClient();
  let q = supabase.from("accidents").select(ACC_SELECT).is("archived_at", null);
  if (f.open) q = q.not("status", "in", "(closed,rejected)");
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
  if (f.customerId) q = q.eq("customer_id", f.customerId);
  if (f.rentalId) q = q.eq("rental_id", f.rentalId);
  const s = sanitizeSearch(f.q);
  if (s) q = q.or(`location.ilike.%${s}%,description.ilike.%${s}%,insurer_claim_number.ilike.%${s}%`);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(200);
  if (error) console.error("[accidents] list failed", error.code, error.message);
  return (data ?? []).map((r) => mapAccident(r as Record<string, unknown>));
}

export async function getAccident(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("accidents").select(`${ACC_SELECT}, accident_photos(id, storage_path, created_at)`).eq("id", id).maybeSingle();
  if (!data) return null;
  const a = mapAccident(data as Record<string, unknown>);
  const photos = (((data as Record<string, unknown>).accident_photos as Array<{ id: string; storage_path: string; created_at: string }>) ?? []).sort((x, y) =>
    x.created_at.localeCompare(y.created_at),
  );
  const [urls, dmg] = await Promise.all([
    signedUrlMap(supabase, photos.map((p) => p.storage_path), 1800),
    supabase.from("damages").select("id, category, severity, status, description, estimated_cost, actual_cost").eq("accident_id", id).is("archived_at", null),
  ]);
  return {
    ...a,
    photos: photos.map((p) => ({ id: p.id, url: urls[p.storage_path] ?? null })),
    damages: (dmg.data ?? []).map((d) => ({ ...d, estimated_cost: n(d.estimated_cost), actual_cost: n(d.actual_cost) })) as Array<{
      id: string;
      category: string;
      severity: string;
      status: string;
      description: string;
      estimated_cost: number | null;
      actual_cost: number | null;
    }>,
  };
}

/** Veículos para os formulários de multa/sinistro. */
export async function getVehicleOptions() {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicles").select("id, brand, model, plate").is("archived_at", null).order("plate");
  return (data ?? []).map((x) => ({ value: x.id as string, label: `${x.plate} · ${x.brand} ${x.model}` }));
}

/** Contratos recentes (para vincular manualmente quando a detecção automática não se aplica). */
export async function getRentalOptions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rentals")
    .select("id, contract_number, vehicle_id, pickup_at, customers(full_name, company_name, customer_type)")
    .is("archived_at", null)
    .neq("status", "cancelled")
    .order("pickup_at", { ascending: false })
    .limit(300);
  return (data ?? []).map((r) => ({
    value: r.id as string,
    vehicle_id: r.vehicle_id as string,
    label: `${r.contract_number} · ${customerName(one(r.customers as Rel<CustomerRel>)) ?? ""}`,
  }));
}
