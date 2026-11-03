"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { errorText } from "@/lib/i18n/errors";
import { anonymizeCustomerAction, setCustomerArchivedAction } from "@/app/(app)/customers/actions";

export function CustomerHeaderActions({ id, name, archived, anonymized }: { id: string; name: string; archived: boolean; anonymized: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function toggle() {
    startTransition(async () => {
      const res = await setCustomerArchivedAction(id, !archived);
      if (res.ok) {
        toast.success(archived ? t.customers.restoredOk : t.customers.archivedOk);
        router.refresh();
      } else toast.error(errorText(t, res.error));
      setConfirm(false);
    });
  }

  if (anonymized) return null;
  return (
    <>
      {!archived && (
        <Button asChild>
          <Link href={`/customers/${id}/edit`}>
            <Pencil /> {t.common.edit}
          </Link>
        </Button>
      )}
      <Button variant="ghost" onClick={() => (archived ? toggle() : setConfirm(true))} disabled={pending}>
        {archived ? <ArchiveRestore /> : <Archive />} {archived ? t.common.restore : t.common.archive}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={interpolate(t.customers.confirmArchive, { name })}
        description={t.customers.confirmArchiveBody}
        confirmLabel={t.common.archive}
        destructive
        pending={pending}
        onConfirm={toggle}
      />
    </>
  );
}

/** Anonimização RGPD (somente administrador principal; confirmação obrigatória). */
export function AnonymizeButton({ id, name }: { id: string; name: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" className="border-danger/40 text-danger hover:bg-danger/10" onClick={() => setOpen(true)}>
        <UserX /> {t.customers.gdpr.anonymize}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={interpolate(t.customers.gdpr.confirm, { name })}
        description={t.customers.gdpr.body}
        confirmLabel={t.customers.gdpr.anonymize}
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await anonymizeCustomerAction(id);
            if (res.ok) {
              toast.success(t.customers.gdpr.done);
              router.refresh();
            } else toast.error(errorText(t, res.error));
            setOpen(false);
          })
        }
      />
    </>
  );
}
