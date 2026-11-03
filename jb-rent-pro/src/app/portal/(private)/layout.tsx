import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, ShieldAlert } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";
import { getPortalMe } from "@/lib/portal/queries";
import { getSession } from "@/lib/auth/session";
import { PortalNav } from "./portal-nav";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, { t }] = await Promise.all([getPortalMe(), getI18n()]);
  if (!me) {
    const session = await getSession();
    if (session.status === "anonymous") redirect("/portal/login");
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md animate-fade-up text-center">
          <LogoMark className="mx-auto h-14 w-14" />
          <div className="mx-auto mt-8 flex size-11 items-center justify-center rounded-full bg-danger/10 text-danger">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold">{t.portal.noAccess.title}</h1>
          <p className="mt-2 text-sm text-muted">{t.portal.noAccess.body}</p>
          <div className="mt-6 flex justify-center gap-2">
            {session.status === "ok" && (
              <Button asChild>
                <Link href="/dashboard">{t.portal.noAccess.dashboard}</Link>
              </Button>
            )}
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="secondary">
                {t.auth.signOut}
              </Button>
            </form>
          </div>
        </div>
      </main>
    );
  }
  const p = t.portal.nav;
  const items = [
    { href: "/portal", label: p.home, icon: "home" as const },
    { href: "/portal/documents", label: p.documents, icon: "docs" as const },
    { href: "/portal/request", label: p.request, icon: "request" as const },
  ];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/portal" aria-label={t.portal.title} className="shrink-0">
            <Logo compact />
          </Link>
          <span className="hidden truncate text-sm text-muted sm:inline">· {me.company.name}</span>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitcher />
            <form action="/auth/signout" method="post">
              <input type="hidden" name="next" value="/portal/login" />
              <Button type="submit" variant="ghost" size="sm" aria-label={p.signOut}>
                <LogOut /> <span className="hidden sm:inline">{p.signOut}</span>
              </Button>
            </form>
          </div>
        </div>
        <PortalNav items={items} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-subtle sm:px-6">
        {me.company.legal_name ?? me.company.name}
        {me.company.phone && ` · ${me.company.phone}`}
        {me.company.email && ` · ${me.company.email}`}
      </footer>
    </div>
  );
}
