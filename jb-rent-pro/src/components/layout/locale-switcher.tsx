"use client";
import { useState } from "react";
import { Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, isLocale } from "@/lib/i18n/config";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

/**
 * Troca de idioma: grava a preferência (cookie de interface + perfil no banco)
 * e recarrega a página, para que tudo o que é renderizado no servidor (títulos,
 * <html lang>, textos) venha no novo idioma. Não usa Server Action + refresh,
 * cuja combinação podia ser abortada pelo roteador e deixar o botão travado.
 */
export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const [pending, setPending] = useState(false);

  async function change(next: string) {
    if (next === locale || !isLocale(next) || pending) return;
    setPending(true);
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
    if (isSupabaseConfigured()) {
      try {
        const supabase = createClient();
        const save = (async () => {
          const { data } = await supabase.auth.getUser();
          if (data.user) await supabase.from("profiles").update({ locale: next }).eq("id", data.user.id);
        })();
        // não deixa o usuário esperando se a rede estiver lenta
        await Promise.race([save, new Promise((r) => setTimeout(r, 3000))]);
      } catch {
        // a preferência do navegador já foi gravada; o perfil será atualizado na próxima troca
      }
    }
    window.location.reload();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2.5" aria-label={t.common.language} loading={pending}>
          {!pending && <Languages />}
          <span className="text-xs font-semibold tracking-wider">{LOCALE_LABELS[locale].short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t.common.language}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={change}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l}>
              {LOCALE_LABELS[l].name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
