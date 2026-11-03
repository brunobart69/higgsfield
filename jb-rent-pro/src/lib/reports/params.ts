import { isPeriodKey, resolvePeriod, type PeriodKey } from "@/lib/periods";
import { REPORT_KEYS, type ReportKey } from "./keys";

export function parseReportParams(sp: { period?: string | null; from?: string | null; to?: string | null; basis?: string | null }) {
  const period = resolvePeriod(isPeriodKey(sp.period) ? (sp.period as PeriodKey) : "thisMonth", { from: sp.from, to: sp.to });
  const basis: "accrual" | "cash" = sp.basis === "cash" ? "cash" : "accrual";
  return { period, basis };
}

export function isReportKey(v: unknown): v is ReportKey {
  return typeof v === "string" && (REPORT_KEYS as readonly string[]).includes(v);
}
