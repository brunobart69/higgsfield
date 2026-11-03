import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-gold/10 text-gold">
        <Icon className="size-5" />
      </span>
      <p className="max-w-md text-sm text-muted">{title}</p>
      {children}
    </div>
  );
}
