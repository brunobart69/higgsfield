"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, ShieldCheck } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayInMadrid } from "@/lib/periods";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import type { Deposit } from "@/lib/rentals/queries";
import { receiveDepositAction, settleDepositAction } from "@/app/(app)/rentals/actions";

const VARIANT = { not_received: "warning", held: "info", settled: "success" } as const;

function ReceiveFields({ rentalId, agreed }: { rentalId: string; agreed: number }) {
  const { t } = useI18n();
  const d = t.deposits;
  const err = useFieldError();
  return (
    <>
      <input type="hidden" name="rental_id" value={rentalId} />
      <div className="grid grid-cols-2 gap-4">
        <TextField label={d.amount} name="amount_received" defaultValue={agreed ? agreed.toFixed(2).replace(".", ",") : ""} inputMode="decimal" required error={err("amount_received")} />
        <TextField label={d.date} name="received_at" type="date" defaultValue={todayInMadrid()} required error={err("received_at")} />
        <SelectField label={d.method} name="received_method" defaultValue="card" options={PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))} />
      </div>
    </>
  );
}

function SettleFields({ rentalId, balance }: { rentalId: string; balance: number }) {
  const { t } = useI18n();
  const d = t.deposits;
  const err = useFieldError();
  return (
    <>
      <input type="hidden" name="rental_id" value={rentalId} />
      <div className="grid grid-cols-2 gap-4">
        <TextField label={d.returnedAmount} name="amount_returned" defaultValue={balance.toFixed(2).replace(".", ",")} inputMode="decimal" error={err("amount_returned")} />
        <TextField label={d.retainedAmount} name="amount_retained" defaultValue="" inputMode="decimal" error={err("amount_retained")} />
        <TextField label={d.date} name="returned_at" type="date" defaultValue={todayInMadrid()} required error={err("returned_at")} />
        <SelectField label={d.method} name="returned_method" defaultValue="card" options={PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))} />
      </div>
      <TextAreaField label={d.retentionReason} name="retention_reason" rows={2} optionalLabel={t.common.optional} error={err("retention_reason")} />
    </>
  );
}

export function DepositPanel({ rentalId, agreed, deposit, canEdit }: { rentalId: string; agreed: number; deposit: Deposit | null; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const d = t.deposits;
  const router = useRouter();
  const [dialog, setDialog] = useState<"receive" | "settle" | null>(null);
  const status = deposit?.status ?? "not_received";
  const done = () => {
    setDialog(null);
    router.refresh();
  };
  if (agreed === 0 && !deposit) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gold" /> {d.title}
        </CardTitle>
        <Badge variant={VARIANT[status]}>{d.status[status]}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm tabular sm:grid-cols-4">
          {(
            [
              [d.agreed, agreed],
              [d.received, deposit?.amount_received ?? 0],
              [d.returned, deposit?.amount_returned ?? 0],
              [d.retained, deposit?.amount_retained ?? 0],
            ] as Array<[string, number]>
          ).map(([label, v]) => (
            <div key={label}>
              <dt className="text-xs text-subtle">{label}</dt>
              <dd className="mt-1">{formatCurrency(v, locale)}</dd>
            </div>
          ))}
        </dl>
        {deposit?.received_at && (
          <p className="text-xs text-muted">
            {d.received}: {formatDate(deposit.received_at)}
            {deposit.returned_at ? ` · ${d.returned}: ${formatDate(deposit.returned_at)}` : ""}
            {deposit.retention_reason ? ` · ${deposit.retention_reason}` : ""}
          </p>
        )}
        <p className="flex items-start gap-2 text-xs text-subtle">
          <Info className="mt-0.5 size-3.5 shrink-0" /> {d.notIncome}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {status === "not_received" && agreed > 0 && (
              <Button size="sm" onClick={() => setDialog("receive")}>
                {d.receive}
              </Button>
            )}
            {status === "held" && (
              <Button size="sm" onClick={() => setDialog("settle")}>
                {d.settle}
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={dialog === "receive"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={d.receiveTitle} closeLabel={t.common.close}>
          <ActionForm action={receiveDepositAction} successMessage={d.saved} onSuccess={done}>
            <ReceiveFields rentalId={rentalId} agreed={agreed} />
          </ActionForm>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "settle"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={d.settleTitle} closeLabel={t.common.close}>
          <ActionForm action={settleDepositAction} successMessage={d.saved} onSuccess={done}>
            <SettleFields rentalId={rentalId} balance={deposit?.balance ?? 0} />
          </ActionForm>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
