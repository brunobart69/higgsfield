"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import type { FormState } from "@/lib/auth/validation";

/** Arquivar com confirmação (registros financeiros nunca são excluídos). */
export function ArchiveButton({
  action,
  title,
  description,
  success,
  redirectTo,
  size = "default",
  iconOnly = false,
}: {
  action: () => Promise<FormState>;
  title: string;
  description?: string;
  success: string;
  redirectTo?: string;
  size?: "default" | "sm";
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)} aria-label={iconOnly ? t.common.archive : undefined}>
        <Archive /> {!iconOnly && t.common.archive}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={t.common.archive}
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const res = await action();
            setOpen(false);
            if (res.ok) {
              toast.success(success);
              if (redirectTo) router.push(redirectTo);
              router.refresh();
            } else toast.error(errorText(t, res.error));
          })
        }
      />
    </>
  );
}
