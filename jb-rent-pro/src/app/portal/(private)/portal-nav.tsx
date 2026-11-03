"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, FileText, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { home: Home, docs: FileText, request: CalendarPlus };

export function PortalNav({ items }: { items: Array<{ href: string; label: string; icon: keyof typeof ICONS }> }) {
  const pathname = usePathname();
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 sm:px-4" aria-label="portal">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const active = i.href === "/portal" ? pathname === "/portal" || pathname.startsWith("/portal/rentals") : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition",
              active ? "border-gold text-gold-light" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden /> {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
