import { addDays } from "@/lib/periods";

export type PolicyStatus = "upcoming" | "active" | "expiring" | "expired" | "renewed" | "archived";

/**
 * Situação da apólice na data de hoje (Madri):
 * vencendo = termina em até 30 dias (alertas 30/15/7 conforme a proximidade).
 */
export function policyStatus(p: { start_date: string; end_date: string; renewed: boolean; archived_at?: string | null }, today: string): PolicyStatus {
  if (p.archived_at) return "archived";
  if (p.end_date < today) return p.renewed ? "renewed" : "expired";
  if (p.start_date > today) return "upcoming";
  if (p.end_date <= addDays(today, 30)) return p.renewed ? "active" : "expiring";
  return "active";
}

/** Dias até o fim da vigência (negativo = vencida). */
export function daysLeft(endDate: string, today: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

/** Faixa do alerta: 30, 15, 7 dias ou vencida. */
export function alertBand(endDate: string, today: string): 30 | 15 | 7 | 0 | null {
  const d = daysLeft(endDate, today);
  if (d < 0) return 0;
  if (d <= 7) return 7;
  if (d <= 15) return 15;
  if (d <= 30) return 30;
  return null;
}

function ymd(iso: string): [number, number, number] {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return [y, m, d];
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = ymd(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Período sugerido para a renovação: começa no dia seguinte ao fim.
 * Vigências em meses/anos completos (o caso comum: 1 ano) são renovadas pelo
 * mesmo número de meses; as demais, pelo mesmo número de dias.
 */
export function renewalPeriod(start: string, end: string): { start: string; end: string } {
  const ns = addDays(end, 1);
  const [sy, sm] = ymd(start);
  const [ey, em] = ymd(ns);
  const months = (ey - sy) * 12 + (em - sm);
  if (months > 0 && addMonths(start, months) === ns) return { start: ns, end: addDays(addMonths(ns, months), -1) };
  const len = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  return { start: ns, end: addDays(ns, Math.max(len, 1)) };
}

export const STATUS_VARIANT: Record<PolicyStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  upcoming: "info",
  active: "success",
  expiring: "warning",
  expired: "danger",
  renewed: "neutral",
  archived: "neutral",
};
