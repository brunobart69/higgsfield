import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import type { EntryStatus } from "./constants";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
export const ENTRIES_PAGE_SIZE = 40;

export type CategoryTotal = { type: "income" | "expense"; category: string; total: number };
export type FinanceReport = { income: number; expenses: number; result: number; byCategory: CategoryTotal[]; nonOperational: CategoryTotal[] };

export async function getFinanceReport(from: string, to: string, basis: "accrual" | "cash"): Promise<FinanceReport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_report", { p_from: from, p_to: to, p_basis: basis });
  if (error || !data) {
    if (error) console.error("[finance] report failed", error.code, error.message);
    return null;
  }
  const d = data as Record<string, unknown>;
  const list = (v: unknown) => ((v ?? []) as Array<Record<string, unknown>>).map((x) => ({ type: x.type as "income" | "expense", category: String(x.category), total: num(x.total) }));
  return { income: num(d.income), expenses: num(d.expenses), result: num(d.result), byCategory: list(d.by_category), nonOperational: list(d.non_operational) };
}

export type CashFlowRow = {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
  projected_in: number;
  projected_out: number;
  deposits_in: number;
  deposits_out: number;
};

export async function getCashFlow(from: string, to: string): Promise<CashFlowRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_flow", { p_from: from, p_to: to });
  if (error) console.error("[finance] cash flow failed", error.code, error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    month: String(r.month),
    inflow: num(r.inflow),
    outflow: num(r.outflow),
    net: num(r.net),
    balance: num(r.balance),
    projected_in: num(r.projected_in),
    projected_out: num(r.projected_out),
    deposits_in: num(r.deposits_in),
    deposits_out: num(r.deposits_out),
  }));
}

export type OpenItem = {
  kind: "rental" | "entry";
  id: string;
  description: string;
  category: string;
  amount: number;
  due_date: string | null;
  vehicle_id: string | null;
  plate: string | null;
  customer_id: string | null;
  customer: string | null;
  rental_id: string | null;
  installment_no: number | null;
  installment_count: number | null;
};

export async function getOpenItems(type: "income" | "expense"): Promise<OpenItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_items", { p_type: type });
  if (error) console.error("[finance] open items failed", error.code, error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...(r as unknown as OpenItem), amount: num(r.amount) }));
}

export type Entry = {
  id: string;
  type: "income" | "expense";
  category: string;
  description: string;
  amount: number;
  vat_rate: number | null;
  competence_date: string;
  due_date: string | null;
  paid_at: string | null;
  status: EntryStatus;
  payment_method: string | null;
  vehicle_id: string | null;
  customer_id: string | null;
  rental_id: string | null;
  rental_line: string | null;
  source_ref: string | null;
  insurance_policy_id: string | null;
  series_id: string | null;
  installment_no: number | null;
  installment_count: number | null;
  reference: string | null;
  notes: string | null;
  is_operational: boolean;
  created_at: string;
  plate: string | null;
  contract: string | null;
  auto: boolean;
  origin: { href: string; kind: string } | null;
};

/** Link para a origem de um lançamento automático. */
export function originOf(e: Pick<Entry, "rental_id" | "rental_line" | "source_ref" | "insurance_policy_id" | "vehicle_id">): { href: string; kind: string } | null {
  if (e.rental_line && e.rental_id) return { href: `/rentals/${e.rental_id}`, kind: "rental" };
  if (e.insurance_policy_id) return { href: `/insurance/${e.insurance_policy_id}`, kind: "insurance" };
  const [k, id] = (e.source_ref ?? "").split(":");
  if (!k || !id) return null;
  if (k === "maintenance") return { href: `/maintenance/${id}`, kind: "maintenance" };
  if (k === "fine") return { href: `/fines/${id}`, kind: "fine" };
  if (k === "accident") return { href: `/fines/accidents/${id}`, kind: "accident" };
  if (k === "vehicle") return { href: `/vehicles/${id}?tab=financial`, kind: "vehicle" };
  return null;
}

const SELECT =
  "id, type, category, description, amount, vat_rate, competence_date, due_date, paid_at, status, payment_method, vehicle_id, customer_id, rental_id, rental_line, source_ref, insurance_policy_id, series_id, installment_no, installment_count, reference, notes, is_operational, created_at, vehicles(plate), rentals(contract_number)";

function mapEntry(r: Record<string, unknown>): Entry {
  const e = r as unknown as Entry;
  return {
    ...e,
    amount: num(r.amount),
    vat_rate: r.vat_rate === null ? null : num(r.vat_rate),
    plate: one(r.vehicles as Rel<{ plate: string }>)?.plate ?? null,
    contract: one(r.rentals as Rel<{ contract_number: string }>)?.contract_number ?? null,
    auto: !!(e.rental_line || e.source_ref || e.insurance_policy_id),
    origin: originOf(e),
  };
}

export type EntryFilter = {
  from: string;
  to: string;
  type?: "income" | "expense";
  status?: EntryStatus;
  category?: string;
  vehicleId?: string;
  q?: string;
  page: number;
};

export async function listEntries(f: EntryFilter) {
  const supabase = await createClient();
  const fromRow = (f.page - 1) * ENTRIES_PAGE_SIZE;
  let q = supabase
    .from("financial_transactions")
    .select(SELECT, { count: "exact" })
    .is("archived_at", null)
    .gte("competence_date", f.from)
    .lte("competence_date", f.to);
  if (f.type) q = q.eq("type", f.type);
  if (f.status) q = q.eq("status", f.status);
  if (f.category) q = q.eq("category", f.category);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);
  const s = sanitizeSearch(f.q);
  if (s) q = q.or(`description.ilike.%${s}%,reference.ilike.%${s}%`);
  const { data, count, error } = await q
    .order("competence_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(fromRow, fromRow + ENTRIES_PAGE_SIZE - 1);
  if (error) console.error("[finance] list failed", error.code, error.message);
  return { total: count ?? 0, items: (data ?? []).map((r) => mapEntry(r as Record<string, unknown>)) };
}

export async function getEntry(id: string): Promise<Entry | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("financial_transactions").select(SELECT).eq("id", id).maybeSingle();
  return data ? mapEntry(data as Record<string, unknown>) : null;
}

export async function getCashOpening() {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("cash_opening_balance, cash_opening_date").maybeSingle();
  return { balance: data?.cash_opening_balance === null || data?.cash_opening_balance === undefined ? null : Number(data.cash_opening_balance), date: (data?.cash_opening_date as string) ?? null };
}

export type RoiRow = {
  vehicle_id: string;
  label: string;
  plate: string;
  status: string;
  acquisition_date: string | null;
  purchase_price: number | null;
  current_value: number | null;
  sold_at: string | null;
  sale_price: number | null;
  revenue: number;
  expenses: number;
  profit: number;
  months_in_fleet: number;
  rented_days: number;
  available_days: number;
};

export async function getFleetRoi(): Promise<RoiRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fleet_roi");
  if (error) console.error("[finance] roi failed", error.code, error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as RoiRow),
    purchase_price: r.purchase_price === null ? null : num(r.purchase_price),
    current_value: r.current_value === null ? null : num(r.current_value),
    sale_price: r.sale_price === null ? null : num(r.sale_price),
    revenue: num(r.revenue),
    expenses: num(r.expenses),
    profit: num(r.profit),
    months_in_fleet: num(r.months_in_fleet),
    rented_days: num(r.rented_days),
    available_days: num(r.available_days),
  }));
}

/** Série mensal (mesma do dashboard) para o gráfico de patrimônio. */
export async function getMonthlySeries(from: string, to: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("dashboard_monthly", { p_from: from, p_to: to });
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    month: String(r.month),
    revenue: num(r.revenue),
    expenses: num(r.expenses),
    profit: num(r.profit),
    occupancy_pct: num(r.occupancy_pct),
    fleet_value: num(r.fleet_value),
  }));
}
