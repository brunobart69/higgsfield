import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DateRange } from "@/lib/periods";

export type DashboardKpis = {
  vehicles_total: number;
  vehicles_available: number;
  vehicles_rented: number;
  vehicles_reserved: number;
  vehicles_maintenance: number;
  revenue: number;
  expenses: number;
  operating_profit: number;
  active_contracts: number;
  upcoming_returns: number;
  insurance_expiring: number;
  documents_expiring: number;
};

export type MonthlyPoint = {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
  occupancy_pct: number;
  fleet_value: number;
};

export type VehiclePerformance = {
  vehicle_id: string;
  label: string;
  plate: string;
  revenue: number;
  expenses: number;
  profit: number;
  rented_days: number;
  available_days: number;
  occupancy_pct: number;
};

export type AlertKind =
  | "rental_overdue"
  | "rental_return_soon"
  | "rental_pickup_soon"
  | "insurance_expiring"
  | "insurance_expired"
  | "itv_expiring"
  | "itv_expired"
  | "document_expiring"
  | "document_expired"
  | "payment_overdue";

export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";

export type DashboardAlert = {
  kind: AlertKind;
  severity: AlertSeverity;
  entity: string;
  entity_id: string;
  title: string;
  due_date: string | null;
};

export type DashboardData =
  | { ok: true; kpis: DashboardKpis; monthly: MonthlyPoint[]; vehicles: VehiclePerformance[]; alerts: DashboardAlert[] }
  | { ok: false; error: "databaseNotReady" | "loadFailed" };

/** NUMERIC chega do PostgREST como número JSON; normaliza strings por segurança. */
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

function isMissingFunction(err: { code?: string } | null) {
  return err?.code === "PGRST202" || err?.code === "42883" || err?.code === "PGRST205" || err?.code === "42P01";
}

export async function loadDashboard(period: DateRange, chart: DateRange): Promise<DashboardData> {
  const supabase = await createClient();
  const [kpisRes, monthlyRes, vehiclesRes, alertsRes] = await Promise.all([
    supabase.rpc("dashboard_kpis", { p_from: period.from, p_to: period.to }),
    supabase.rpc("dashboard_monthly", { p_from: chart.from, p_to: chart.to }),
    supabase.rpc("dashboard_vehicle_performance", { p_from: period.from, p_to: period.to }),
    supabase.rpc("dashboard_alerts", { p_limit: 12 }),
  ]);

  const firstError = kpisRes.error ?? monthlyRes.error ?? vehiclesRes.error ?? alertsRes.error;
  if (firstError) {
    console.error("[dashboard] RPC error", firstError.code, firstError.message);
    return { ok: false, error: isMissingFunction(firstError) ? "databaseNotReady" : "loadFailed" };
  }

  const k = (kpisRes.data ?? {}) as Record<string, unknown>;
  const kpis: DashboardKpis = {
    vehicles_total: num(k.vehicles_total),
    vehicles_available: num(k.vehicles_available),
    vehicles_rented: num(k.vehicles_rented),
    vehicles_reserved: num(k.vehicles_reserved),
    vehicles_maintenance: num(k.vehicles_maintenance),
    revenue: num(k.revenue),
    expenses: num(k.expenses),
    operating_profit: num(k.operating_profit),
    active_contracts: num(k.active_contracts),
    upcoming_returns: num(k.upcoming_returns),
    insurance_expiring: num(k.insurance_expiring),
    documents_expiring: num(k.documents_expiring),
  };

  const monthly = ((monthlyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    month: String(r.month),
    revenue: num(r.revenue),
    expenses: num(r.expenses),
    profit: num(r.profit),
    occupancy_pct: num(r.occupancy_pct),
    fleet_value: num(r.fleet_value),
  }));

  const vehicles = ((vehiclesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    vehicle_id: String(r.vehicle_id),
    label: String(r.label),
    plate: String(r.plate),
    revenue: num(r.revenue),
    expenses: num(r.expenses),
    profit: num(r.profit),
    rented_days: num(r.rented_days),
    available_days: num(r.available_days),
    occupancy_pct: num(r.occupancy_pct),
  }));

  const alerts = (alertsRes.data ?? []) as DashboardAlert[];
  return { ok: true, kpis, monthly, vehicles, alerts };
}

/** Quantidade de alertas para o sino do cabeçalho. */
export async function countAlerts(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_alerts", { p_limit: 100 });
  if (error) return 0;
  return Array.isArray(data) ? data.length : 0;
}
