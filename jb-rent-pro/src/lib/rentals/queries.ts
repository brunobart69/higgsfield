import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import { RENTALS_PAGE_SIZE, type RentalStatus } from "./constants";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export type RentalListItem = {
  id: string;
  contract_number: string;
  status: RentalStatus;
  pickup_at: string;
  return_at: string;
  total_amount: number;
  customer: string;
  vehicle: string;
  plate: string;
};

const LIST_SELECT =
  "id, contract_number, status, pickup_at, return_at, total_amount, customers!inner(full_name, company_name, customer_type), vehicles!inner(brand, model, plate)";

function mapListRow(r: Record<string, unknown>): RentalListItem {
  const c = one(r.customers as Rel<{ full_name: string | null; company_name: string | null; customer_type: string }>);
  const v = one(r.vehicles as Rel<{ brand: string; model: string; plate: string }>);
  return {
    id: r.id as string,
    contract_number: r.contract_number as string,
    status: r.status as RentalStatus,
    pickup_at: r.pickup_at as string,
    return_at: r.return_at as string,
    total_amount: Number(r.total_amount),
    customer: (c?.customer_type === "company" ? c?.company_name : c?.full_name) ?? "—",
    vehicle: v ? `${v.brand} ${v.model}` : "—",
    plate: v?.plate ?? "",
  };
}

export async function listRentals(opts: { q?: string; status?: string; page: number }) {
  const supabase = await createClient();
  let query = supabase.from("rentals").select(LIST_SELECT, { count: "exact" }).is("archived_at", null);
  const nowIso = new Date().toISOString();
  if (opts.status === "late") query = query.in("status", ["in_progress", "late"]).lt("return_at", nowIso);
  else if (opts.status === "active") query = query.in("status", ["confirmed", "in_progress", "late"]);
  else if (opts.status) query = query.eq("status", opts.status);
  const q = sanitizeSearch(opts.q);
  if (q) {
    // busca no número do contrato, no cliente e na matrícula (filtros nas tabelas relacionadas)
    const { data: ids } = await supabase.rpc("global_search", { p_query: q, p_limit: 50 });
    const vIds = ((ids ?? []) as Array<{ kind: string; id: string }>).filter((r) => r.kind === "vehicle").map((r) => r.id);
    const cIds = ((ids ?? []) as Array<{ kind: string; id: string }>).filter((r) => r.kind === "customer").map((r) => r.id);
    const parts = [`contract_number.ilike.*${q}*`];
    if (vIds.length) parts.push(`vehicle_id.in.(${vIds.join(",")})`);
    if (cIds.length) parts.push(`customer_id.in.(${cIds.join(",")})`);
    query = query.or(parts.join(","));
  }
  const from = (opts.page - 1) * RENTALS_PAGE_SIZE;
  const orderAsc = opts.status === "reservation" || opts.status === "confirmed";
  const { data, error, count } = await query.order("pickup_at", { ascending: orderAsc }).range(from, from + RENTALS_PAGE_SIZE - 1);
  if (error) {
    console.error("[rentals] list failed", error.code, error.message);
    return { ok: false as const };
  }
  return { ok: true as const, total: count ?? 0, items: (data ?? []).map((r) => mapListRow(r as Record<string, unknown>)) };
}

export async function countRentalsByStatus() {
  const supabase = await createClient();
  const { data } = await supabase.from("rentals").select("status, return_at").is("archived_at", null);
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    out[r.status] = (out[r.status] ?? 0) + 1;
    if ((r.status === "in_progress" || r.status === "late") && new Date(r.return_at).getTime() < now) out.late_derived = (out.late_derived ?? 0) + 1;
  }
  return out;
}

export type RentalExtra = { id: string; fee_id: string | null; name: string; amount: number; charge_type: "per_rental" | "per_day"; quantity: number };
export type RentalPayment = {
  id: string;
  kind: "payment" | "refund";
  amount: number;
  paid_at: string;
  method: string;
  reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
};
export type Deposit = {
  id: string;
  amount_received: number;
  received_at: string | null;
  received_method: string | null;
  amount_returned: number;
  returned_at: string | null;
  returned_method: string | null;
  amount_retained: number;
  retention_reason: string | null;
  status: "not_received" | "held" | "settled";
  balance: number;
};

export type RentalDetail = {
  id: string;
  contract_number: string;
  status: RentalStatus;
  customer_id: string;
  vehicle_id: string;
  pickup_at: string;
  return_at: string;
  actual_return_at: string | null;
  picked_up_at: string | null;
  pricing_mode: "daily" | "weekly" | "monthly" | "custom";
  unit_price: number;
  rental_days: number;
  base_amount: number;
  extras_amount: number;
  extra_fees_amount: number;
  discount_amount: number;
  excess_km: number;
  excess_mileage_amount: number;
  total_amount: number;
  deposit_amount: number;
  payment_method: string | null;
  mileage_policy: "unlimited" | "daily" | "weekly" | "monthly" | "custom";
  mileage_limit_km: number | null;
  allowed_km: number | null;
  excess_km_price: number | null;
  start_mileage: number | null;
  end_mileage: number | null;
  start_fuel_level: number | null;
  end_fuel_level: number | null;
  contract_locale: "pt-BR" | "es-ES";
  signature_status: "unsigned" | "pending" | "signed";
  pickup_location: string | null;
  return_location: string | null;
  notes: string | null;
  return_notes: string | null;
  cancelled_reason: string | null;
  created_at: string;
  customer: {
    id: string;
    customer_type: "individual" | "company";
    full_name: string | null;
    company_name: string | null;
    legal_name: string | null;
    id_document_type: string | null;
    id_document_number: string | null;
    tax_id: string | null;
    driving_licence_number: string | null;
    driving_licence_expiry: string | null;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    representative_name: string | null;
  };
  vehicle: { id: string; brand: string; model: string; version: string | null; plate: string; vin: string | null; color: string | null; current_mileage: number; daily_price: number | null; year: number | null };
  extras: RentalExtra[];
  payments: RentalPayment[];
  deposit: Deposit | null;
  paid: number;
  balance: number;
};

export async function getRental(id: string): Promise<RentalDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rentals")
    .select(
      `*, customers(id, customer_type, full_name, company_name, legal_name, id_document_type, id_document_number, tax_id,
        driving_licence_number, driving_licence_expiry, address, postal_code, city, country, phone, email, representative_name),
       vehicles(id, brand, model, version, plate, vin, color, current_mileage, daily_price, year),
       rental_extras(id, fee_id, name, amount, charge_type, quantity),
       rental_payments(id, kind, amount, paid_at, method, reference, voided_at, void_reason, created_at),
       deposits(id, amount_received, received_at, received_method, amount_returned, returned_at, returned_method, amount_retained, retention_reason, status, balance)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[rentals] get failed", error.code, error.message);
    return null;
  }
  const d = data as Record<string, unknown>;
  const payments = ((d.rental_payments as RentalPayment[]) ?? [])
    .map((p) => ({ ...p, amount: Number(p.amount) }))
    .sort((a, b) => (a.paid_at === b.paid_at ? a.created_at.localeCompare(b.created_at) : a.paid_at.localeCompare(b.paid_at)));
  const paidCents = payments.filter((p) => !p.voided_at).reduce((acc, p) => acc + Math.round(p.amount * 100) * (p.kind === "payment" ? 1 : -1), 0);
  const totalCents = Math.round(Number(d.total_amount) * 100);
  const dep = one(d.deposits as Rel<Deposit>);
  const num = (k: string) => (d[k] === null || d[k] === undefined ? null : Number(d[k]));
  return {
    ...(d as unknown as RentalDetail),
    unit_price: Number(d.unit_price),
    base_amount: Number(d.base_amount),
    extras_amount: Number(d.extras_amount),
    extra_fees_amount: Number(d.extra_fees_amount),
    discount_amount: Number(d.discount_amount),
    excess_mileage_amount: Number(d.excess_mileage_amount),
    total_amount: Number(d.total_amount),
    deposit_amount: Number(d.deposit_amount),
    excess_km_price: num("excess_km_price"),
    customer: one(d.customers as Rel<RentalDetail["customer"]>)!,
    vehicle: one(d.vehicles as Rel<RentalDetail["vehicle"]>)!,
    extras: ((d.rental_extras as RentalExtra[]) ?? []).map((e) => ({ ...e, amount: Number(e.amount) })),
    payments,
    deposit: dep
      ? {
          ...dep,
          amount_received: Number(dep.amount_received),
          amount_returned: Number(dep.amount_returned),
          amount_retained: Number(dep.amount_retained),
          balance: Number(dep.balance),
        }
      : null,
    paid: paidCents / 100,
    balance: (totalCents - paidCents) / 100,
  };
}

/** Dados para o formulário: veículos ativos, taxas do catálogo e padrões da empresa. */
export async function getRentalFormOptions() {
  const supabase = await createClient();
  const [vehicles, fees, company] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, brand, model, plate, status, daily_price, weekly_price, monthly_price, current_mileage")
      .is("archived_at", null)
      .neq("status", "sold")
      .order("brand")
      .order("model"),
    supabase.from("fee_catalog").select("id, name_pt, name_es, amount, charge_type, is_active").eq("is_active", true).order("sort_order"),
    supabase
      .from("companies")
      .select("default_locale, default_deposit_amount, default_mileage_policy, default_mileage_limit_km, default_excess_km_price, rental_grace_minutes")
      .maybeSingle(),
  ]);
  return {
    vehicles: (vehicles.data ?? []).map((v) => ({
      ...v,
      daily_price: v.daily_price === null ? null : Number(v.daily_price),
      weekly_price: v.weekly_price === null ? null : Number(v.weekly_price),
      monthly_price: v.monthly_price === null ? null : Number(v.monthly_price),
    })) as Array<{
      id: string;
      brand: string;
      model: string;
      plate: string;
      status: string;
      daily_price: number | null;
      weekly_price: number | null;
      monthly_price: number | null;
      current_mileage: number;
    }>,
    fees: (fees.data ?? []).map((f) => ({ ...f, amount: Number(f.amount) })) as Array<{
      id: string;
      name_pt: string;
      name_es: string;
      amount: number;
      charge_type: "per_rental" | "per_day";
    }>,
    defaults: {
      contract_locale: ((company.data?.default_locale as string) ?? "es-ES") as "pt-BR" | "es-ES",
      deposit_amount: company.data?.default_deposit_amount === null || company.data?.default_deposit_amount === undefined ? null : Number(company.data.default_deposit_amount),
      mileage_policy: ((company.data?.default_mileage_policy as string) ?? "unlimited") as "unlimited" | "daily" | "weekly" | "monthly" | "custom",
      mileage_limit_km: (company.data?.default_mileage_limit_km as number | null) ?? null,
      excess_km_price: company.data?.default_excess_km_price === null || company.data?.default_excess_km_price === undefined ? null : Number(company.data.default_excess_km_price),
      grace_minutes: Number(company.data?.rental_grace_minutes ?? 0),
    },
  };
}

export async function listDeposits(opts: { pendingOnly: boolean; page: number }) {
  const supabase = await createClient();
  let q = supabase
    .from("deposits")
    .select(
      "id, rental_id, amount_received, amount_returned, amount_retained, balance, status, received_at, returned_at, retention_reason, rentals!inner(contract_number, deposit_amount, status, return_at), customers(full_name, company_name, customer_type), vehicles(plate)",
      { count: "exact" },
    );
  if (opts.pendingOnly) q = q.neq("status", "settled");
  const from = (opts.page - 1) * RENTALS_PAGE_SIZE;
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, from + RENTALS_PAGE_SIZE - 1);
  if (error) {
    console.error("[deposits] list failed", error.code, error.message);
    return { ok: false as const };
  }
  return {
    ok: true as const,
    total: count ?? 0,
    items: (data ?? []).map((r) => {
      const rent = one(r.rentals as Rel<{ contract_number: string; deposit_amount: number; status: string; return_at: string }>);
      const c = one(r.customers as Rel<{ full_name: string | null; company_name: string | null; customer_type: string }>);
      const v = one(r.vehicles as Rel<{ plate: string }>);
      return {
        id: r.id as string,
        rental_id: r.rental_id as string,
        contract_number: rent?.contract_number ?? "",
        rental_status: (rent?.status ?? "reservation") as RentalStatus,
        return_at: rent?.return_at ?? null,
        agreed: Number(rent?.deposit_amount ?? 0),
        received: Number(r.amount_received),
        returned: Number(r.amount_returned),
        retained: Number(r.amount_retained),
        balance: Number(r.balance),
        status: r.status as Deposit["status"],
        customer: (c?.customer_type === "company" ? c?.company_name : c?.full_name) ?? "—",
        plate: v?.plate ?? "",
      };
    }),
  };
}

export async function listCustomerDeposits(customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deposits")
    .select("id, rental_id, amount_received, amount_returned, amount_retained, balance, status, received_at, rentals(contract_number, deposit_amount)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => {
    const rent = one(r.rentals as Rel<{ contract_number: string; deposit_amount: number }>);
    return {
      id: r.id as string,
      rental_id: r.rental_id as string,
      contract_number: rent?.contract_number ?? "",
      agreed: Number(rent?.deposit_amount ?? 0),
      received: Number(r.amount_received),
      returned: Number(r.amount_returned),
      retained: Number(r.amount_retained),
      balance: Number(r.balance),
      status: r.status as Deposit["status"],
    };
  });
}
