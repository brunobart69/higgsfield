"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { todayInMadrid } from "@/lib/periods";
import { cancelEntryAction, payEntryAction } from "@/app/(app)/financial/actions";

function PayFields({ id, method }: { id: string; method: string | null }) {
  const { t } = useI18n();
  const f = t.financial.fields;
  const err = useFieldError();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <TextField label={f.paid_at} name="paid_at" type="date" defaultValue={todayInMadrid()} required error={err("paid_at")} />
      <SelectField
        label={f.payment_method}
        name="payment_method"
        defaultValue={method ?? ""}
        optionalLabel={t.common.optional}
        options={[{ value: "", label: "—" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))]}
      />
    </div>
  );
}

/** Pagar/receber e anular um lançamento manual pendente. */
export function EntryActions({ id, type, method, canCancel = true }: { id: string; type: "income" | "expense"; method: string | null; canCancel?: boolean }) {
  const { t } = useI18n();
  const e = t.financial.entries;
  const router = useRouter();
  const [dialog, setDialog] = useState<"pay" | "cancel" | null>(null);
  const [pending, start] = useTransition();
  const payLabel = type === "income" ? e.payReceive : e.pay;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setDialog("pay")}>
        <CheckCircle2 /> <span className="hidden sm:inline">{payLabel}</span>
      </Button>
      {canCancel && (
        <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")} aria-label={e.cancel}>
          <XCircle />
        </Button>
      )}
      <Dialog open={dialog === "pay"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={payLabel} closeLabel={t.common.close}>
          {dialog === "pay" && (
            <ActionForm
              action={payEntryAction}
              successMessage={e.paidOk}
              onSuccess={() => {
                setDialog(null);
                router.refresh();
              }}
            >
              <PayFields id={id} method={method} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(v) => !v && setDialog(null)}
        title={e.confirmCancel}
        description={e.confirmCancelBody}
        confirmLabel={e.cancel}
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const res = await cancelEntryAction(id);
            setDialog(null);
            if (res.ok) {
              toast.success(e.cancelledOk);
              router.refresh();
            } else toast.error(errorText(t, res.error));
          })
        }
      />
    </>
  );
}
