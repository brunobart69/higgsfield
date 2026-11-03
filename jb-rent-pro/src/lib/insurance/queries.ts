import "server-only";
import { createClient } from "@/lib/supabase/server";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export type Policy = {
  id: string;
  vehicle_id: string;
  insurer: string;
  policy_number: string;
  coverage_type: string | null;
  start_date: string;
  end_date: string;
  premium_amount: number | null;
  deductible_amount: number | null;
  roadside_assistance: boolean;
  assistance_phone: string | null;
  paid_at: string | null;
  payment_method: string | null;
  renewed_from_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  renewed: boolean;
  renewal_id: string | null;
  vehicle: { id: string; brand: string; model: string; plate: string };
};

const SELECT =
  "id, vehicle_id, insurer, policy_number, coverage_type, start_date, end_date, premium_amount, deductible_amount, roadside_assistance, assistance_phone, paid_at, payment_method, renewed_from_id, notes, archived_at, created_at, vehicles(id, brand, model, plate)";

function mapPolicy(r: Record<string, unknown>, renewals: Map<string, string>): Policy {
  return {
    ...(r as unknown as Policy),
    premium_amount: r.premium_amount === null ? null : Number(r.premium_amount),
    deductible_amount: r.deductible_amount === null ? null : Number(r.deductible_amount),
    renewed: renewals.has(r.id as string),
    renewal_id: renewals.get(r.id as string) ?? null,
    vehicle: one(r.vehicles as Rel<Policy["vehicle"]>)!,
  };
}

async function renewalsMap(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("insurance_policies").select("id, renewed_from_id").not("renewed_from_id", "is", null).is("archived_at", null);
  return new Map((data ?? []).map((r) => [r.renewed_from_id as string, r.id as string]));
}

export async function listPolicies(opts: { vehicleId?: string; includeArchived?: boolean } = {}): Promise<Policy[]> {
  const supabase = await createClient();
  let q = supabase.from("insurance_policies").select(SELECT).order("end_date", { ascending: true });
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const [{ data, error }, renewals] = await Promise.all([q, renewalsMap(supabase)]);
  if (error) console.error("[insurance] list failed", error.code, error.message);
  return (data ?? []).map((r) => mapPolicy(r as Record<string, unknown>, renewals));
}

export async function getPolicy(id: string): Promise<Policy | null> {
  const supabase = await createClient();
  const [{ data }, renewals] = await Promise.all([supabase.from("insurance_policies").select(SELECT).eq("id", id).maybeSingle(), renewalsMap(supabase)]);
  return data ? mapPolicy(data as Record<string, unknown>, renewals) : null;
}

/** Cadeia de renovações (anteriores e posteriores) de uma apólice. */
export async function getPolicyChain(policy: Policy): Promise<Policy[]> {
  const all = await listPolicies({ vehicleId: policy.vehicle_id, includeArchived: true });
  const byId = new Map(all.map((p) => [p.id, p]));
  const chain: Policy[] = [];
  let cur: Policy | undefined = policy;
  while (cur?.renewed_from_id && byId.get(cur.renewed_from_id)) {
    cur = byId.get(cur.renewed_from_id)!;
    chain.unshift(cur);
  }
  chain.push(policy);
  cur = policy;
  while (cur?.renewal_id && byId.get(cur.renewal_id)) {
    cur = byId.get(cur.renewal_id)!;
    chain.push(cur);
  }
  return chain;
}

export async function getInsuranceOverview() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("insurance_overview");
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    active: Number(d.active ?? 0),
    expiring: Number(d.expiring ?? 0),
    expired: Number(d.expired ?? 0),
    uninsured: Number(d.uninsured_vehicles ?? 0),
    premiumsYear: Number(d.premiums_year ?? 0),
  };
}

/** Veículos em operação sem apólice vigente hoje (mesma regra do alerta). */
export async function listUninsuredVehicles(): Promise<Array<{ id: string; label: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("extra_alert_rows");
  if (error) return [];
  return ((data ?? []) as Array<{ kind: string; entity_id: string; title: string }>)
    .filter((r) => r.kind === "vehicle_uninsured")
    .map((r) => ({ id: r.entity_id, label: r.title }));
}
