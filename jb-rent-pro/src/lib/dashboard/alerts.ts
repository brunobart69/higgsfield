import type { AlertSeverity, DashboardAlert } from "./queries";

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Junta os alertas principais com os complementares (documentos de clientes, veículos sem seguro). */
export function mergeAlerts(base: DashboardAlert[], extra: DashboardAlert[]): DashboardAlert[] {
  return [...base, ...extra].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
  );
}
