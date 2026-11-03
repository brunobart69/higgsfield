import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { safeInternalPath } from "@/lib/utils";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.signIn };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { t } = await getI18n();
  const params = await searchParams;
  const initialError = params.error === "link" ? "invalidLink" : params.error === "session" ? "sessionExpired" : undefined;
  return (
    <>
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-gold">{t.auth.loginSubtitle}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">{t.auth.loginTitle}</h1>
      <LoginForm next={safeInternalPath(params.next)} initialError={initialError} />
    </>
  );
}
