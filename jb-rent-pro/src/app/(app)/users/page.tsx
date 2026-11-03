import type { Metadata } from "next";
import { ShieldCheck, UserCog, Users } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { listCompanyUsers } from "@/lib/users/queries";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Forbidden } from "@/components/layout/forbidden";
import { UsersList } from "@/components/users/users-list";
import { InviteDialog } from "@/components/users/invite-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.users.title };
}

export default async function UsersPage() {
  const [{ t }, session] = await Promise.all([getI18n(), getSession()]);
  if (session.status !== "ok" || session.profile.role !== "owner") return <Forbidden message={t.errors.forbidden} />;

  const result = await listCompanyUsers();
  const adminReady = isAdminConfigured();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.nav.groups.admin}
        title={t.users.title}
        description={t.users.subtitle}
        actions={<InviteDialog disabledReason={adminReady ? undefined : t.errors.serviceKeyMissing} />}
      />

      {!adminReady && (
        <p role="status" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {t.errors.serviceKeyMissing}
        </p>
      )}

      {!result.ok ? (
        <Forbidden message={t.errors.loadFailed} />
      ) : (
        <>
          <UsersList users={result.users} currentUserId={session.profile.id} />
          {result.users.length <= 1 && <EmptyState icon={Users} title={t.users.empty} />}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.users.permissionsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold" />
            <div>
              <p className="text-sm font-medium">{t.roles.owner}</p>
              <p className="mt-1 text-sm text-muted">{t.users.permissions.owner}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <UserCog className="mt-0.5 size-5 shrink-0 text-info" />
            <div>
              <p className="text-sm font-medium">{t.roles.admin}</p>
              <p className="mt-1 text-sm text-muted">{t.users.permissions.admin}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
