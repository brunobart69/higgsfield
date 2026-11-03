"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Receipt, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { todayInMadrid } from "@/lib/periods";
import type { MaintenanceStatus } from "@/lib/maintenance/constants";
import { cancelMaintenanceAction, completeMaintenanceAction, startMaintenanceAction } from "@/app/(app)/maintenance/actions";

type Rec = {
  id: string;
  status: MaintenanceStatus;
  completed_date: string | null;
  mileage: number | null;
  workshop: string | null;
  cost: number | null;
  invoice_number: string | null;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
  currentKm: number;
};

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

function CompleteFields({ r }: { r: Rec }) {
  const { t } = useI18n();
  const f = t.maintenance.fields;
  const err = useFieldError();
  const opt = t.common.optional;
  const done = r.status === "completed";
  return (
    <>
      <input type="hidden" name="id" value={r.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={f.completed_date} name="completed_date" type="date" defaultValue={r.completed_date ?? todayInMadrid()} required disabled={done} error={err("completed_date")} />
        <TextField label={f.mileage} name="mileage" defaultValue={r.mileage ?? r.currentKm} inputMode="numeric" optionalLabel={opt} disabled={done} error={err("mileage")} />
        <TextField label={f.workshop} name="workshop" defaultValue={r.workshop ?? ""} optionalLabel={opt} error={err("workshop")} />
        <TextField label={f.cost} name="cost" defaultValue={money(r.cost)} inputMode="decimal" optionalLabel={opt} error={err("cost")} />
        <TextField label={f.invoice_number} name="invoice_number" defaultValue={r.invoice_number ?? ""} optionalLabel={opt} error={err("invoice_number")} />
        <TextField label={f.paid_at} name="paid_at" type="date" defaultValue={r.paid_at ?? ""} optionalLabel={opt} error={err("paid_at")} />
        <SelectField
          label={f.payment_method}
          name="payment_method"
          defaultValue={r.payment_method ?? ""}
          optionalLabel={opt}
          options={[{ value: "", label: "—" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))]}
        />
        <TextAreaField label={f.notes} name="notes" defaultValue={r.notes ?? ""} rows={2} optionalLabel={opt} className="sm:col-span-2" error={err("notes")} />
      </div>
      {done && (
        <>
          <input type="hidden" name="completed_date" value={r.completed_date ?? ""} />
          <input type="hidden" name="mileage" value={r.mileage ?? ""} />
        </>
      )}
      <p className="text-xs text-subtle">{t.maintenance.financeNote}</p>
    </>
  );
}

/** Botões de situação: levar à oficina, concluir, cancelar; depois de concluída, pagamento e fatura. */
export function MaintenanceActions({ r }: { r: Rec }) {
  const { t } = useI18n();
  const m = t.maintenance;
  const router = useRouter();
  const [dialog, setDialog] = useState<"start" | "complete" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const done = r.status === "completed";
  if (r.status === "cancelled") return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(msg);
        setDialog(null);
        router.refresh();
      } else toast.error(errorText(t, res.error));
    });

  return (
    <>
      {r.status === "scheduled" && (
        <Button variant="secondary" onClick={() => setDialog("start")}>
          <Wrench /> {m.actions.start}
        </Button>
      )}
      <Button variant={done ? "secondary" : "default"} onClick={() => setDialog("complete")}>
        {done ? <Receipt /> : <CheckCircle2 />} {done ? m.actions.payment : m.actions.complete}
      </Button>
      {!done && (
        <Button variant="ghost" onClick={() => setDialog("cancel")}>
          <XCircle /> {m.actions.cancel}
        </Button>
      )}

      <ConfirmDialog
        open={dialog === "start"}
        onOpenChange={(v) => !v && setDialog(null)}
        title={m.actions.confirmStart}
        description={m.actions.confirmStartBody}
        confirmLabel={m.actions.start}
        pending={pending}
        onConfirm={() => run(() => startMaintenanceAction(r.id), m.started)}
      />

      <Dialog open={dialog === "complete"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={done ? m.actions.payment : m.completeTitle} description={done ? undefined : m.completeHint} closeLabel={t.common.close}>
          {dialog === "complete" && (
            <ActionForm
              action={completeMaintenanceAction}
              successMessage={done ? t.common.saved : m.completed}
              onSuccess={() => {
                setDialog(null);
                router.refresh();
              }}
            >
              <CompleteFields r={r} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "cancel"} onOpenChange={(v) => !v && !pending && setDialog(null)}>
        <DialogContent title={m.actions.cancel} closeLabel={t.common.close}>
          <div className="space-y-4">
            <TextAreaField label={m.fields.cancel_reason} name="cancel_reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={() => run(() => cancelMaintenanceAction(r.id, reason), m.cancelled)}>
                {m.actions.cancel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
