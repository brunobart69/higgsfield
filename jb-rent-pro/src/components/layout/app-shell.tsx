"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, CarFront, Gauge, Menu, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { CurrentProfile } from "@/lib/auth/session";
import { SidebarNav } from "./sidebar-nav";
import { LocaleSwitcher } from "./locale-switcher";
import { UserMenu } from "./user-menu";
import { GlobalSearch } from "./global-search";

export function AppShell({
  profile,
  alertCount,
  children,
}: {
  profile: CurrentProfile;
  alertCount: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const bottomItems = [
    { href: "/dashboard", label: t.nav.dashboard, icon: Gauge, active: pathname === "/dashboard" },
    { href: "/vehicles", label: t.nav.vehicles, icon: CarFront, active: pathname.startsWith("/vehicles") },
    { href: "/customers", label: t.nav.customers, icon: Users, active: pathname.startsWith("/customers") },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Menu lateral — desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface/60 lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/dashboard" aria-label="JB RENT PRO">
            <Logo />
          </Link>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav role={profile.role} />
        </div>
        <div className="border-t border-border px-5 py-4 text-[0.68rem] leading-relaxed text-subtle">
          <p className="truncate font-medium text-muted">{profile.companyName}</p>
          <p>{t.brand.slogan}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Barra superior */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <Link href="/dashboard" className="lg:hidden" aria-label="JB RENT PRO">
            <Logo compact />
          </Link>
          <div className="flex flex-1 justify-end md:justify-start md:pl-2">
            <GlobalSearch />
          </div>
          <Link
            href="/notifications"
            className="relative flex size-9 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground"
            aria-label={`${t.nav.alerts}: ${alertCount}`}
          >
            <Bell className="size-4" />
            {alertCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[0.6rem] font-bold text-gold-foreground tabular">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </Link>
          <LocaleSwitcher />
          <UserMenu profile={profile} />
        </header>

        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      {/* Navegação inferior — celular (uso com uma mão) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-xl pb-safe lg:hidden"
        aria-label={t.common.menu}
      >
        <ul className="grid grid-cols-4">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex h-16 flex-col items-center justify-center gap-1 text-[0.68rem]",
                    item.active ? "text-gold" : "text-muted",
                  )}
                >
                  <Icon className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.68rem] text-muted"
              aria-label={t.common.openMenu}
            >
              <Menu className="size-5" />
              {t.common.menu}
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" closeLabel={t.common.close} className="px-3 pt-4">
          <SheetTitle className="px-3 pb-3 font-display text-base">{t.common.menu}</SheetTitle>
          <SheetDescription className="sr-only">{t.brand.slogan}</SheetDescription>
          <div className="scrollbar-thin overflow-y-auto pb-6">
            <SidebarNav role={profile.role} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
