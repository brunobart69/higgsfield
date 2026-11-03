"use client";
import { startTransition, useActionState, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextField } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/config";
import type { FormState } from "@/lib/auth/validation";
import { inviteUserAction } from "@/app/(app)/users/actions";

export function InviteDialog({ disabledReason }: { disabledReason?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(inviteUserAction, {});
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) {
      toast.success(interpolate(t.users.inviteSent, state.vars ?? {}));
      setOpen(false);
    }
  }, [state, t]);

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!!disabledReason} title={disabledReason}>
        <UserPlus /> {t.users.invite}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t.users.inviteTitle} description={t.users.inviteBody} closeLabel={t.common.close}>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(() => action(fd));
            }}
          >
            <FormAlert message={errorText(t, state.error)} />
            <TextField label={t.users.fullName} name="full_name" autoComplete="off" required error={errorText(t, fe.full_name)} />
            <TextField
              label={t.auth.email}
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="off"
              required
              error={errorText(t, fe.email)}
            />
            <SelectField
              label={t.users.role}
              name="role"
              defaultValue="admin"
              options={[
                { value: "admin", label: t.roles.admin },
                { value: "owner", label: t.roles.owner },
              ]}
              hint={t.users.permissions.admin}
            />
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" loading={pending}>
                {t.users.sendInvite}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
