import type { Locale } from "@/lib/i18n/config";
import { formatCurrency } from "@/lib/format";

/** Barras horizontais por categoria (valores já agregados no banco). */
export function CategoryBars({ rows, labels, locale, tone }: { rows: Array<{ category: string; total: number }>; labels: Record<string, string>; locale: Locale; tone: "income" | "expense" }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.total)), 1);
  const total = rows.reduce((a, r) => a + Math.round(r.total * 100), 0) / 100;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.category} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted">{labels[r.category] ?? r.category}</span>
            <span className="shrink-0 tabular">
              {formatCurrency(r.total, locale)}
              {total !== 0 && <span className="ml-2 text-xs text-subtle">{Math.round((r.total / total) * 100)}%</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className={tone === "income" ? "h-full rounded-full bg-[var(--chart-1)]" : "h-full rounded-full bg-[var(--chart-2)]"}
              style={{ width: `${Math.max(2, (Math.abs(r.total) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
