import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { countAlerts } from "@/lib/dashboard/queries";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.status === "anonymous") redirect("/login");

  if (session.status === "no_access") {
    const { t } = await getI18n();
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md animate-fade-up text-center">
          <LogoMark className="mx-auto h-14 w-14" />
          <div className="mx-auto mt-8 flex size-11 items-center justify-center rounded-full bg-danger/10 text-danger">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold">{t.auth.noAccessTitle}</h1>
          <p className="mt-2 text-sm text-muted">{t.auth.noAccessBody}</p>
          <p className="mt-1 text-xs text-subtle">{session.email}</p>
          <form action="/auth/signout" method="post" className="mt-6">
            <Button type="submit" variant="secondary">
              {t.auth.signOut}
            </Button>
          </form>
        </div>
      </main>
    );
  }

  const alertCount = await countAlerts();
  return (
    <AppShell profile={session.profile} alertCount={alertCount}>
      {children}
    </AppShell>
  );
}
