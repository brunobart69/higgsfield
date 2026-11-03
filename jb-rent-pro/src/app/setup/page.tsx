import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { getI18n } from "@/lib/i18n/server";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Exibida apenas enquanto as variáveis do Supabase não estiverem configuradas. */
export default async function SetupPage() {
  if (isSupabaseConfigured()) redirect("/login");
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-10 px-5 py-8">
      <div className="flex items-center justify-between">
        <Logo slogan={t.brand.slogan} />
        <LocaleSwitcher />
      </div>
      <Card className="animate-fade-up">
        <CardContent className="space-y-4 p-6">
          <div className="flex size-11 items-center justify-center rounded-md bg-gold/10 text-gold">
            <Settings2 className="size-5" />
          </div>
          <h1 className="font-display text-xl font-semibold">{t.setup.title}</h1>
          <p className="text-sm text-muted">{t.setup.body}</p>
          <p className="text-sm text-muted">{t.setup.steps}</p>
          <pre className="overflow-x-auto rounded-md border border-border bg-background p-4 text-xs text-gold-light">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=https://seu-dominio.com`}
          </pre>
        </CardContent>
      </Card>
    </main>
  );
}
