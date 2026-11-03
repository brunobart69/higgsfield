"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { NAV, isEnabled } from "./nav-config";
import type { UserRole } from "@/lib/auth/session";

/** Lista de navegação compartilhada entre o menu lateral (desktop) e a gaveta (celular). */
export function SidebarNav({ role, onNavigate }: { role: UserRole; onNavigate?: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <nav className="space-y-6" aria-label={t.common.menu}>
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.ownerOnly || role === "owner");
        if (items.length === 0) return null;
        return (
          <div key={group.key}>
            <p className="mb-2 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-subtle">
              {t.nav.groups[group.key]}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const label = t.nav[item.key];
                if (!isEnabled(item)) {
                  return (
                    <li key={item.key}>
                      <span
                        aria-disabled="true"
                        title={`${t.common.comingSoon} · ${interpolate(t.common.phase, { n: item.phase })}`}
                        className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-subtle/80"
                      >
                        <Icon className="size-4 shrink-0 opacity-60" />
                        <span className="flex-1 truncate">{label}</span>
                        <span className="flex items-center gap-1 text-[0.6rem] uppercase tracking-wider text-subtle">
                          <Lock className="size-3" />
                          {interpolate(t.common.phase, { n: item.phase })}
                        </span>
                      </span>
                    </li>
                  );
                }
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-gold/10 text-gold-light"
                          : "text-muted hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold" aria-hidden />}
                      <Icon className={cn("size-4 shrink-0", active ? "text-gold" : "text-subtle group-hover:text-foreground")} />
                      <span className="truncate">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
