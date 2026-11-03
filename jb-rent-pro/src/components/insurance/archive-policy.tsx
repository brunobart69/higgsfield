"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { archiveInsuranceAction } from "@/app/(app)/insurance/actions";

export function ArchivePolicyButton({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Archive /> {t.common.archive}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t.insurance.confirmArchive}
        description={t.insurance.confirmArchiveBody}
        confirmLabel={t.common.archive}
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const res = await archiveInsuranceAction(id);
            setOpen(false);
            if (res.ok) {
              toast.success(t.insurance.archivedOk);
              router.push("/insurance");
              router.refresh();
            } else toast.error(errorText(t, res.error));
          })
        }
      />
    </>
  );
}
