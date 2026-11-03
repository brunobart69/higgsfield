"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Plus, RotateCcw, Wallet } from "lucide-react";
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
import type { RentalPayment } from "@/lib/rentals/queries";
import { addPaymentAction, voidPaymentAction } from "@/app/(app)/rentals/actions";
import { cn } from "@/lib/utils";

function PaymentFields({ rentalId, kind, suggested, defaultMethod }: { rentalId: string; kind: "payment" | "refund"; suggested: number; defaultMethod: string | null }) {
  const { t } = useI18n();
  const p = t.rentals.payments;
  const err = useFieldError();
  return (
    <>
      <input type="hidden" name="rental_id" value={rentalId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-2 gap-4">
        <TextField label={p.amount} name="amount" defaultValue={suggested > 0 ? suggested.toFixed(2).replace(".", ",") : ""} inputMode="decimal" required error={err("amount")} />
        <TextField label={p.date} name="paid_at" type="date" defaultValue={todayInMadrid()} required error={err("paid_at")} />
        <SelectField
          label={p.method}
          name="method"
          defaultValue={defaultMethod ?? "card"}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))}
        />
        <TextField label={p.reference} name="reference" optionalLabel={t.common.optional} error={err("reference")} />
      </div>
    </>
  );
}

function VoidFields({ paymentId }: { paymentId: string }) {
  const { t } = useI18n();
  const err = useFieldError();
  return (
    <>
      <input type="hidden" name="payment_id" value={paymentId} />
      <TextAreaField label={t.rentals.payments.voidReason} name="void_reason" rows={2} required error={err("void_reason")} />
    </>
  );
}

export function PaymentsPanel({
  rentalId,
  payments,
  total,
  paid,
  balance,
  defaultMethod,
  canAdd,
}: {
  rentalId: string;
  payments: RentalPayment[];
  total: number;
  paid: number;
  balance: number;
  defaultMethod: string | null;
  canAdd: boolean;
}) {
  const { t, locale } = useI18n();
  const p = t.rentals.payments;
  const s = t.rentals.summary;
  const router = useRouter();
  const [dialog, setDialog] = useState<{ mode: "payment" | "refund" } | { mode: "void"; id: string } | null>(null);
  const done = () => {
    setDialog(null);
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-4 text-gold" /> {t.rentals.sections.payments}
        </CardTitle>
        {canAdd && (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setDialog({ mode: "payment" })}>
              <Plus /> {p.add}
            </Button>
            {paid > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setDialog({ mode: "refund" })} aria-label={p.refund} title={p.refund}>
                <RotateCcw />
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-3 text-sm tabular">
          <div>
            <dt className="text-xs text-subtle">{s.total}</dt>
            <dd className="mt-1 font-medium">{formatCurrency(total, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">{s.paid}</dt>
            <dd className="mt-1 font-medium text-success">{formatCurrency(paid, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">{s.balance}</dt>
            <dd className={cn("mt-1 font-semibold", balance > 0 ? "text-warning" : balance < 0 ? "text-info" : "text-success")}>{formatCurrency(balance, locale)}</dd>
          </div>
        </dl>
        {payments.length === 0 ? (
          <p className="text-sm text-muted">{p.empty}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {payments.map((pay) => (
              <li key={pay.id} className={cn("flex items-center gap-3 py-2.5 text-sm", pay.voided_at && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(pay.voided_at && "line-through")}>{p.kinds[pay.kind]}</span>
                    {pay.voided_at && <Badge variant="neutral">{p.voided}</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {formatDate(pay.paid_at)} · {t.paymentMethods[pay.method as keyof typeof t.paymentMethods] ?? pay.method}
                    {pay.reference ? ` · ${pay.reference}` : ""}
                    {pay.void_reason ? ` · ${pay.void_reason}` : ""}
                  </p>
                </div>
                <span className={cn("tabular font-medium", pay.kind === "refund" ? "text-danger" : "", pay.voided_at && "line-through")}>
                  {pay.kind === "refund" ? "−" : ""}
                  {formatCurrency(pay.amount, locale)}
                </span>
                {!pay.voided_at && (
                  <Button size="icon" variant="ghost" onClick={() => setDialog({ mode: "void", id: pay.id })} aria-label={p.void} title={p.void}>
                    <Ban className="text-subtle" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialog !== null && dialog.mode !== "void"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={dialog?.mode === "refund" ? p.refund : p.add} closeLabel={t.common.close}>
          {dialog && dialog.mode !== "void" && (
            <ActionForm action={addPaymentAction} successMessage={p.saved} onSuccess={done}>
              <PaymentFields rentalId={rentalId} kind={dialog.mode} suggested={dialog.mode === "payment" ? balance : 0} defaultMethod={defaultMethod} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog?.mode === "void"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={p.voidTitle} closeLabel={t.common.close}>
          {dialog?.mode === "void" && (
            <ActionForm action={voidPaymentAction} submitLabel={p.void} successMessage={p.voidedOk} onSuccess={done}>
              <VoidFields paymentId={dialog.id} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
