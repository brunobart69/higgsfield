"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { toast } from "sonner";
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
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/config";
import { setLocaleAction } from "@/lib/i18n/actions";

export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (next === locale) return;
    startTransition(async () => {
      const res = await setLocaleAction(next);
      if (!res.ok) {
        toast.error(t.errors.generic);
        return;
      }
      router.refresh();
    });
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
