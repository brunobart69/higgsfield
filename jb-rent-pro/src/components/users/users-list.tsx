"use client";
import { useState, useTransition } from "react";
import { KeyRound, MoreVertical, ShieldCheck, UserCheck, UserCog, UserX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/components/layout/user-menu";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { errorText } from "@/lib/i18n/errors";
import { formatDateTime } from "@/lib/format";
import type { CompanyUser } from "@/lib/users/queries";
import type { FormState } from "@/lib/auth/validation";
import { changeRoleAction, sendPasswordLinkAction, setUserActiveAction } from "@/app/(app)/users/actions";

type Pending =
  | { kind: "role"; user: CompanyUser; role: "owner" | "admin" }
  | { kind: "active"; user: CompanyUser; active: boolean }
  | null;

export function UsersList({ users, currentUserId }: { users: CompanyUser[]; currentUserId: string }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [pending, startTransition] = useTransition();

  function notify(res: FormState) {
    if (res.ok) {
      const key = res.message as keyof typeof t.users;
      toast.success(interpolate(String(t.users[key] ?? t.common.saved), res.vars ?? {}));
    } else {
      toast.error(errorText(t, res.error, res.vars));
    }
  }

  function run(fn: () => Promise<FormState>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      notify(res);
      after?.();
    });
  }

  const name = (u: CompanyUser) => u.fullName ?? u.email;

  return (
    <>
      <Card className="divide-y divide-border overflow-hidden">
        {users.map((u) => {
          const self = u.id === currentUserId;
          return (
            <div key={u.id} className="flex items-center gap-3 p-4 sm:gap-4 sm:px-5">
              <span
                className={
                  u.isActive
                    ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-gradient text-xs font-semibold text-gold-foreground"
                    : "flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-subtle"
                }
              >
                {initials(u.fullName, u.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">
                    {name(u)}
                    {self && <span className="ml-1 text-xs font-normal text-subtle">({t.common.you})</span>}
                  </p>
                  <Badge variant={u.role === "owner" ? "default" : "info"}>
                    {u.role === "owner" ? <ShieldCheck className="size-3" /> : <UserCog className="size-3" />}
                    {t.roles[u.role]}
                  </Badge>
                  {!u.isActive && <Badge variant="danger">{t.common.inactive}</Badge>}
                  {u.isActive && !u.lastSignInAt && <Badge variant="warning">{t.users.pending}</Badge>}
                </div>
                <p className="truncate text-xs text-muted">{u.email}</p>
                <p className="mt-0.5 text-[0.68rem] text-subtle tabular">
                  {t.users.lastSignIn}: {u.lastSignInAt ? formatDateTime(u.lastSignInAt) : t.common.never}
                </p>
              </div>
              {!self && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                    aria-label={`${t.common.actions}: ${name(u)}`}
                    disabled={pending}
                  >
                    <MoreVertical className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {u.isActive && (
                      <>
                        <DropdownMenuItem
                          onSelect={() => setConfirm({ kind: "role", user: u, role: u.role === "owner" ? "admin" : "owner" })}
                        >
                          {u.role === "owner" ? <UserCog /> : <ShieldCheck />}
                          {u.role === "owner" ? t.users.makeAdmin : t.users.makeOwner}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => run(() => sendPasswordLinkAction(u.id))}>
                          <KeyRound /> {t.users.sendReset}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-danger" onSelect={() => setConfirm({ kind: "active", user: u, active: false })}>
                          <UserX className="!text-danger" /> {t.users.deactivate}
                        </DropdownMenuItem>
                      </>
                    )}
                    {!u.isActive && (
                      <DropdownMenuItem onSelect={() => run(() => setUserActiveAction(u.id, true))}>
                        <UserCheck /> {t.users.reactivate}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </Card>

      <ConfirmDialog
        open={confirm?.kind === "role"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm ? interpolate(t.users.confirmRoleTitle, { name: name(confirm.user) }) : ""}
        description={
          confirm?.kind === "role"
            ? `${t.users.confirmRoleBody} ${confirm.role === "owner" ? t.users.permissions.owner : t.users.permissions.admin}`
            : undefined
        }
        confirmLabel={confirm?.kind === "role" ? (confirm.role === "owner" ? t.users.makeOwner : t.users.makeAdmin) : undefined}
        pending={pending}
        onConfirm={() => {
          if (confirm?.kind !== "role") return;
          const c = confirm;
          run(() => changeRoleAction(c.user.id, c.role), () => setConfirm(null));
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "active"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm ? interpolate(t.users.confirmDeactivateTitle, { name: name(confirm.user) }) : ""}
        description={t.users.confirmDeactivateBody}
        confirmLabel={t.users.deactivate}
        destructive
        pending={pending}
        onConfirm={() => {
          if (confirm?.kind !== "active") return;
          const c = confirm;
          run(() => setUserActiveAction(c.user.id, c.active), () => setConfirm(null));
        }}
      />
    </>
  );
}
