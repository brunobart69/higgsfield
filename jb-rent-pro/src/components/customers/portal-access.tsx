"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/format";
import { invitePortalAction, setPortalDisabledAction } from "@/app/(app)/customers/portal-actions";

export type PortalAccountInfo = { invited_at: string; last_seen_at: string | null; disabled_at: string | null; email: string } | null;

export function PortalAccess({ customerId, account, portalUrl, canInvite }: { customerId: string; account: PortalAccountInfo; portalUrl: string; canInvite: boolean }) {
  const { t } = useI18n();
  const p = t.customers.portal;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; vars?: Record<string, string | number> }>, msg: (v?: Record<string, string | number>) => string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(msg(res.vars));
        router.refresh();
      } else toast.error(errorText(t, res.error));
    });
  return (
    <div className="space-y-3 text-sm">
      {!account ? (
        <p className="text-muted">{p.notInvited}</p>
      ) : account.disabled_at ? (
        <p className="text-danger">{p.disabled}</p>
      ) : (
        <>
          <p className="text-success">{interpolate(p.active, { date: formatDateTime(account.invited_at) })}</p>
          <p className="text-xs text-muted">{account.last_seen_at ? interpolate(p.lastSeen, { date: formatDateTime(account.last_seen_at) }) : p.never}</p>
          <p className="truncate text-xs text-subtle">{account.email}</p>
        </>
      )}
      <p className="text-xs text-subtle">{interpolate(p.inviteHint, { url: portalUrl })}</p>
      <div className="flex flex-wrap gap-2">
        {!account && canInvite && (
          <Button size="sm" loading={pending} onClick={() => run(() => invitePortalAction(customerId), (v) => interpolate(p.invited, { email: String(v?.email ?? "") }))}>
            <KeyRound /> {p.invite}
          </Button>
        )}
        {account && !account.disabled_at && (
          <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>
            <UserX /> {p.disable}
          </Button>
        )}
        {account?.disabled_at && (
          <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setPortalDisabledAction(customerId, false), () => p.enabledOk)}>
            <UserCheck /> {p.enable}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={p.confirmDisable}
        destructive
        confirmLabel={p.disable}
        pending={pending}
        onConfirm={() => {
          setConfirm(false);
          run(() => setPortalDisabledAction(customerId, true), () => p.disabledOk);
        }}
      />
    </div>
  );
}
