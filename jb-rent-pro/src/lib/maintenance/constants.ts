export const MAINTENANCE_TYPES = ["preventive", "oil_change", "tyres", "brakes", "itv", "repair", "bodywork", "cleaning", "other"] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];
export const MAINTENANCE_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export type DueStatus = "ok" | "due_soon" | "overdue";

export const MAINTENANCE_STATUS_VARIANT: Record<MaintenanceStatus, "info" | "warning" | "success" | "neutral"> = {
  scheduled: "info",
  in_progress: "warning",
  completed: "success",
  cancelled: "neutral",
};
export const DUE_VARIANT: Record<DueStatus, "success" | "warning" | "danger"> = { ok: "success", due_soon: "warning", overdue: "danger" };

/** Mesma regra do banco (maintenance_due): "em breve" até 30 dias ou 1.000 km. */
export const DUE_SOON_DAYS = 30;
export const DUE_SOON_KM = 1000;

/** Categoria financeira usada ao concluir (espelha app.after_maintenance_change). */
export function financeCategoryFor(t: MaintenanceType): "tyres" | "itv" | "cleaning" | "repairs" | "maintenance" {
  if (t === "tyres" || t === "itv" || t === "cleaning") return t;
  if (t === "repair" || t === "bodywork") return "repairs";
  return "maintenance";
}

/** Próximo serviço do plano e situação — espelho de public.maintenance_due para a interface e testes. */
export function planDue(
  p: { interval_km: number | null; interval_months: number | null; last_done_date: string | null; last_done_mileage: number | null },
  currentKm: number,
  today: string,
): { nextDate: string | null; nextKm: number | null; daysLeft: number | null; kmLeft: number | null; status: DueStatus } {
  let nextDate: string | null = null;
  if (p.interval_months && p.last_done_date) {
    const [y = 0, m = 1, d = 1] = p.last_done_date.split("-").map(Number);
    const total = y * 12 + (m - 1) + p.interval_months;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    nextDate = `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  }
  const nextKm = p.interval_km && p.last_done_mileage !== null ? p.last_done_mileage + p.interval_km : null;
  const daysLeft = nextDate ? Math.round((Date.parse(`${nextDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
  const kmLeft = nextKm !== null ? nextKm - currentKm : null;
  const status: DueStatus =
    (daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft <= 0)
      ? "overdue"
      : (daysLeft !== null && daysLeft <= DUE_SOON_DAYS) || (kmLeft !== null && kmLeft <= DUE_SOON_KM)
        ? "due_soon"
        : "ok";
  return { nextDate, nextKm, daysLeft, kmLeft, status };
}
