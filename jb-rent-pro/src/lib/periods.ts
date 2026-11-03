import { REGION } from "@/lib/i18n/config";

export const PERIOD_KEYS = ["today", "last7", "last30", "thisMonth", "lastMonth", "thisYear", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export type DateRange = { from: string; to: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && (PERIOD_KEYS as readonly string[]).includes(v);
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Data civil de hoje em Europe/Madrid ("YYYY-MM-DD"). */
export function todayInMadrid(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REGION.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtc(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}
function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number) {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}
export function startOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}
export function endOfMonth(iso: string) {
  const d = toUtc(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fmt(d);
}
export function addMonths(iso: string, months: number) {
  const d = toUtc(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + months);
  return fmt(d);
}

/**
 * Converte o filtro do dashboard em um intervalo fechado de datas civis
 * (Europe/Madrid). Período personalizado inválido → "Este mês".
 */
export function resolvePeriod(
  key: PeriodKey,
  custom?: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): DateRange & { key: PeriodKey } {
  const today = todayInMadrid(now);
  switch (key) {
    case "today":
      return { key, from: today, to: today };
    case "last7":
      return { key, from: addDays(today, -6), to: today };
    case "last30":
      return { key, from: addDays(today, -29), to: today };
    case "lastMonth": {
      const prev = addMonths(today, -1);
      return { key, from: prev, to: endOfMonth(prev) };
    }
    case "thisYear":
      return { key, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      if (isIsoDate(custom?.from) && isIsoDate(custom?.to) && custom.from <= custom.to) {
        return { key, from: custom.from, to: custom.to };
      }
      return { key: "thisMonth", from: startOfMonth(today), to: endOfMonth(today) };
    case "thisMonth":
    default:
      return { key: "thisMonth", from: startOfMonth(today), to: endOfMonth(today) };
  }
}

/** Janela dos gráficos mensais: 12 meses terminando no mês da data final. */
export function chartWindow(range: DateRange): DateRange {
  return { from: addMonths(range.to, -11), to: endOfMonth(range.to) };
}
