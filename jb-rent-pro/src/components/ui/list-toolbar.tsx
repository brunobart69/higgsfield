import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Busca + filtros por URL (GET). Funciona sem JavaScript e mantém o estado ao
 * compartilhar o link. Os filtros são "chips" com contagem opcional.
 */
export function ListToolbar({
  action,
  q,
  placeholder,
  searchLabel,
  hidden,
  chips,
}: {
  action: string;
  q?: string;
  placeholder: string;
  searchLabel: string;
  hidden?: Record<string, string | undefined>;
  chips?: Array<{ label: string; href: string; active: boolean; count?: number }>;
}) {
  return (
    <div className="space-y-3">
      <form method="get" action={action} role="search" className="relative">
        {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label={searchLabel}
          enterKeyHint="search"
          className="h-12 w-full rounded-lg border border-border bg-surface-2 pl-10 pr-4 text-[0.95rem] placeholder:text-subtle focus-visible:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/20"
        />
      </form>
      {chips && chips.length > 0 && (
        <div className="scrollbar-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {chips.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              scroll={false}
              aria-current={c.active ? "true" : undefined}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
                c.active ? "border-gold/50 bg-gold/15 text-gold-light" : "border-border bg-surface-2 text-muted hover:text-foreground",
              )}
            >
              {c.label}
              {c.count !== undefined && <span className="tabular text-subtle">{c.count}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
