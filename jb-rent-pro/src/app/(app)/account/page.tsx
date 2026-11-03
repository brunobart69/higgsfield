import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/format";
import { describeUserAgent, listMyAccess } from "@/lib/activity/queries";
import { ChangePasswordForm } from "./change-password-form";
import { ProfileForm } from "./profile-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.account.title };
}

export default async function AccountPage() {
  const [{ t }, session] = await Promise.all([getI18n(), getSession()]);
  if (session.status !== "ok") redirect("/login");
  const p = session.profile;
  const access = await listMyAccess(p.id, 10);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow={t.account.title} title={p.fullName ?? p.email} description={t.account.subtitle} />

      <Card>
        <CardHeader>
          <CardTitle>{t.account.profile}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
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
          <div className="border-t border-border pt-5">
            <p className="mb-4 text-sm font-medium">{t.account.editProfile}</p>
            <ProfileForm fullName={p.fullName ?? ""} phone={p.phone ?? ""} locale={p.locale} />
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle>{t.account.accessHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {access.length === 0 ? (
            <p className="text-sm text-muted">{t.account.accessHistoryEmpty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {access.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <LogIn className="size-4 shrink-0 text-gold" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {describeUserAgent(a.userAgent)}
                    {a.ip && <span className="text-subtle"> · {a.ip}</span>}
                  </span>
                  <time dateTime={a.createdAt} className="shrink-0 text-xs text-subtle tabular">
                    {formatDateTime(a.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
