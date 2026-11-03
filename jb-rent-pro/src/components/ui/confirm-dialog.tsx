"use client";
import * as React from "react";
import { Button } from "./button";
import { Dialog, DialogContent } from "./dialog";
import { useI18n } from "@/lib/i18n/provider";

/** Confirmação obrigatória para operações importantes. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent title={title} description={description} closeLabel={t.common.close}>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button variant={destructive ? "danger" : "default"} onClick={onConfirm} loading={pending}>
            {confirmLabel ?? t.common.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
