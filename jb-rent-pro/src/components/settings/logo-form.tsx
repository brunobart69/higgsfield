"use client";
import { useState, useTransition } from "react";
import { ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { removeLogoAction, uploadLogoAction } from "@/app/(app)/settings/actions";
import { ActionForm, useFieldError } from "./action-form";

function FileInput() {
  const { t } = useI18n();
  const err = useFieldError();
  const error = err("logo");
  return (
    <div className="space-y-1.5">
      <Label htmlFor="logo">{t.settings.fields.logo}</Label>
      <input
        id="logo"
        name="logo"
        type="file"
        accept="image/png,image/jpeg"
        aria-invalid={error ? true : undefined}
        className="block w-full cursor-pointer rounded-md border border-border bg-surface-2 text-sm text-muted file:mr-3 file:h-11 file:cursor-pointer file:border-0 file:bg-surface-3 file:px-4 file:text-foreground"
      />
      <p className="text-xs text-subtle">{t.settings.branding.hint}</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const { t } = useI18n();
  const b = t.settings.branding;
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-6 sm:grid-cols-[12rem_1fr]">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--surface-3)_0_50%)] bg-[length:20px_20px]">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária do Storage privado
          <img src={logoUrl} alt={t.settings.fields.logo} className="max-h-full max-w-full object-contain p-3" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center text-xs text-subtle">
            <ImageIcon className="size-6" />
            {b.none}
          </div>
        )}
      </div>
      <div className="space-y-4">
        <ActionForm action={uploadLogoAction} submitLabel={logoUrl ? b.replace : b.upload} successMessage={b.uploaded} resetOnSuccess>
          <FileInput />
        </ActionForm>
        {logoUrl && (
          <Button variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>
            <Trash2 /> {b.removeLogo}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`${b.removeLogo}?`}
        destructive
        confirmLabel={t.common.remove}
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await removeLogoAction();
            if (res.ok) toast.success(t.common.saved);
            else toast.error(errorText(t, res.error));
            setConfirm(false);
          })
        }
      />
    </div>
  );
}
