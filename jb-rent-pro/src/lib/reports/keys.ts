export const REPORT_KEYS = ["pnl", "entries", "cashflow", "receivables", "payables", "rentals", "fleet", "roi", "maintenance", "fines", "deposits"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
/** Relatórios que mostram a situação atual (não dependem do período). */
export const SNAPSHOT_REPORTS: readonly ReportKey[] = ["receivables", "payables", "roi", "deposits"];
export const FINANCE_REPORTS: readonly ReportKey[] = ["pnl", "entries", "cashflow", "receivables", "payables", "roi"];
