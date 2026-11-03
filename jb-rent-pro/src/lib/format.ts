import { REGION, type Locale } from "@/lib/i18n/config";

/**
 * Formatação regional fixa da operação na Espanha:
 * moeda EUR, fuso Europe/Madrid, datas DD/MM/YYYY e horas em 24h,
 * independentemente do idioma escolhido.
 */
const currencyCache = new Map<string, Intl.NumberFormat>();

export function formatCurrency(value: number | string | null | undefined, locale: Locale, opts?: { compact?: boolean }) {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  const key = `${locale}|${opts?.compact ? "c" : "f"}`;
  let fmt = currencyCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: REGION.currency,
      ...(opts?.compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    currencyCache.set(key, fmt);
  }
  return fmt.format(Number.isFinite(n) ? n : 0);
}

export function formatNumber(value: number, locale: Locale, maxFractionDigits = 0) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits }).format(value);
}

export function formatPercent(value: number | string, locale: Locale) {
  const n = typeof value === "string" ? Number(value) : value;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(n)} %`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function madridParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REGION.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

/** DD/MM/YYYY. Strings "YYYY-MM-DD" são datas civis e não sofrem conversão de fuso. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const p = madridParts(date);
  return `${p.d}/${p.m}/${p.y}`;
}

/** DD/MM/YYYY HH:mm (24h) no fuso Europe/Madrid. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const p = madridParts(date);
  return `${p.d}/${p.m}/${p.y} ${p.hh}:${p.mm}`;
}

/** Rótulo curto de mês ("out/26", "oct/26") a partir de "YYYY-MM-DD". */
export function formatMonthShort(isoDate: string, locale: Locale): string {
  const m = DATE_ONLY.exec(isoDate);
  if (!m) return isoDate;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })
    .format(date)
    .replace(".", "");
  return `${month}/${(m[1] ?? "").slice(2)}`;
}
