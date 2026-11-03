import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { getI18n } from "@/lib/i18n/server";
import { PortalLoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.portal.title };
}

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  return (
    <main className="relative flex min-h-dvh flex-col px-5 py-6 sm:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_30rem_at_50%_0%,rgba(201,162,75,0.12),transparent_60%)]"
      />
      <div className="relative flex items-center justify-between">
        <Logo compact />
        <LocaleSwitcher />
      </div>
      <div className="relative flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-sm animate-fade-up">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-gold">{t.brand.name}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{t.portal.login.title}</h1>
          <p className="mt-1 text-sm text-muted">{t.portal.login.subtitle}</p>
          <PortalLoginForm initialError={sp.error === "link" ? "linkError" : undefined} />
        </div>
      </div>
    </main>
  );
}
