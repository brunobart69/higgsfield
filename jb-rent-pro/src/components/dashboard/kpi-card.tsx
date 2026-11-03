import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "gold" | "success" | "info" | "warning" | "danger" | "neutral";

const toneClass: Record<Tone, string> = {
  gold: "bg-gold/10 text-gold",
  success: "bg-success/10 text-success",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-surface-3 text-muted",
};

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  emphasis = false,
  className,
  style,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  emphasis?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        "group relative animate-fade-up overflow-hidden rounded-lg border border-border bg-surface/80 p-4 transition-colors hover:border-border-strong sm:p-5",
        emphasis && "border-gold/25 bg-[linear-gradient(160deg,rgba(201,162,75,0.10),transparent_55%)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", toneClass[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className={cn("mt-2 font-display text-xl font-semibold tracking-tight tabular sm:text-2xl", emphasis && "text-gold-light")}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[0.68rem] text-subtle">{hint}</p>}
    </div>
  );
}
