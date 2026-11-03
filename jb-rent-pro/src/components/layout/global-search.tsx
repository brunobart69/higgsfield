"use client";
import Link from "next/link";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

/** Busca global: campo no desktop, ícone no celular (abre a página de pesquisa). */
export function GlobalSearch() {
  const { t } = useI18n();
  return (
    <>
      <form method="get" action="/search" role="search" className="relative hidden w-full max-w-md md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          type="search"
          name="q"
          placeholder={t.search.placeholder}
          aria-label={t.nav.search}
          enterKeyHint="search"
          className="h-10 w-full rounded-md border border-border bg-surface-2/80 pl-9 pr-3 text-sm placeholder:text-subtle focus-visible:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/20"
        />
      </form>
      <Link
        href="/search"
        className="flex size-9 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground md:hidden"
        aria-label={t.nav.search}
      >
        <Search className="size-4" />
      </Link>
    </>
  );
}
