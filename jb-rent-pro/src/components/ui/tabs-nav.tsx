import Link from "next/link";
import { cn } from "@/lib/utils";

/** Abas por URL (?tab=): deep-link e funciona sem JavaScript. Rolagem horizontal no celular. */
export function TabsNav({ tabs, active }: { tabs: Array<{ key: string; label: string; href: string }>; active: string }) {
  return (
    <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="inline-flex min-w-full gap-1 border-b border-border">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              role="tab"
              aria-selected={isActive}
              scroll={false}
              className={cn(
                "relative shrink-0 px-3.5 py-2.5 text-sm transition-colors",
                isActive ? "text-gold-light" : "text-muted hover:text-foreground",
              )}
            >
              {tab.label}
              {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" aria-hidden />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
