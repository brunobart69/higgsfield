"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { PERIOD_KEYS, type PeriodKey } from "@/lib/periods";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PeriodFilter({ value, from, to }: { value: PeriodKey; from: string; to: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [showCustom, setShowCustom] = useState(value === "custom");
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const invalid = !customFrom || !customTo || customFrom > customTo;

  function go(params: Record<string, string>) {
    startTransition(() => router.push(`${pathname}?${new URLSearchParams(params).toString()}`, { scroll: false }));
  }

  function select(key: PeriodKey) {
    if (key === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    go({ period: key });
  }

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={t.dashboard.periods.label}
        className={cn(
          "scrollbar-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0",
          pending && "opacity-70",
        )}
      >
        {PERIOD_KEYS.map((key) => {
          const active = key === "custom" ? showCustom : !showCustom && value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(key)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
                active
                  ? "border-gold/50 bg-gold/15 text-gold-light"
                  : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              {key === "custom" && <CalendarRange className="size-3.5" />}
              {t.dashboard.periods[key]}
            </button>
          );
        })}
      </div>

      {showCustom && (
        <form
          className="flex animate-fade-up flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) go({ period: "custom", from: customFrom, to: customTo });
          }}
        >
          <label className="space-y-1 text-xs text-muted">
            <span className="block">{t.common.from}</span>
            <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-10 w-40" required />
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span className="block">{t.common.to}</span>
            <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-10 w-40" required />
          </label>
          <Button type="submit" size="sm" className="h-10" disabled={invalid} loading={pending}>
            {t.common.apply}
          </Button>
          {invalid && customFrom && customTo && (
            <p role="alert" className="w-full text-xs text-danger">
              {t.dashboard.periods.invalidRange}
            </p>
          )}
        </form>
      )}

      <p className="text-xs text-subtle tabular">
        {formatDate(from)} — {formatDate(to)}
      </p>
    </div>
  );
}
