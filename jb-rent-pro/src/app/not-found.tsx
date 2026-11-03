import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <LogoMark className="h-14 w-14" />
      <p className="font-display text-5xl font-semibold text-gold-gradient">404</p>
      <Link href="/dashboard" className="text-sm text-gold hover:underline">
        {t.common.back}
      </Link>
    </main>
  );
}
