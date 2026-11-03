import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/format";
import { ChangePasswordForm } from "./change-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.account.title };
}

export default async function AccountPage() {
  const [{ t }, session] = await Promise.all([getI18n(), getSession()]);
  if (session.status !== "ok") redirect("/login");
  const p = session.profile;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-gold">{t.account.title}</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{p.fullName ?? p.email}</h1>
        <p className="mt-1 text-sm text-muted">{t.account.subtitle}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.account.profile}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-subtle">{t.account.name}</dt>
              <dd className="mt-1">{p.fullName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">{t.auth.email}</dt>
              <dd className="mt-1 break-all">{p.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">{t.account.role}</dt>
              <dd className="mt-1">
                <Badge>{t.roles[p.role]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">{t.account.lastSignIn}</dt>
              <dd className="mt-1 tabular">{formatDateTime(p.lastSignInAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card id="password" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t.account.changePassword}</CardTitle>
          <CardDescription>{t.auth.passwordHint}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
