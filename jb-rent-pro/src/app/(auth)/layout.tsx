import { Logo, LogoMark } from "@/components/brand/logo";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { getI18n } from "@/lib/i18n/server";
import { ShieldCheck } from "lucide-react";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Painel da marca (desktop) */}
      <aside className="relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_10%_10%,rgba(201,162,75,0.16),transparent_60%),radial-gradient(40rem_30rem_at_90%_100%,rgba(201,162,75,0.08),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--foreground)_1px,transparent_1px),linear-gradient(90deg,var(--foreground)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />
        <Logo className="relative" />
        <div className="relative max-w-lg animate-fade-up">
          <LogoMark className="mb-8 h-20 w-20 drop-shadow-[0_10px_40px_rgba(201,162,75,0.35)]" />
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            {t.brand.slogan.split(",").map((part, i, arr) => (
              <span key={i} className={i === arr.length - 1 ? "text-gold-gradient" : undefined}>
                {part}
                {i < arr.length - 1 ? "," : ""}
                <br />
              </span>
            ))}
          </h1>
          <p className="mt-6 text-muted">{t.meta.description}</p>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-subtle">
          <ShieldCheck className="size-4 text-gold" /> {t.auth.secureNote}
        </p>
      </aside>

      {/* Formulário */}
      <main className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo compact className="lg:invisible" />
          <LocaleSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm animate-fade-up">{children}</div>
        </div>
        <p className="text-center text-xs text-subtle lg:hidden">{t.brand.slogan}</p>
      </main>
    </div>
  );
}
