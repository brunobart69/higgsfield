"use client";
import { useState, useTransition } from "react";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { errorText } from "@/lib/i18n/errors";
import { formatCurrency } from "@/lib/format";
import type { Fee } from "@/lib/settings/queries";
import { deleteFeeAction, saveFeeAction } from "@/app/(app)/settings/actions";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { moneyInput } from "./settings-forms";

function FeeFields({ fee }: { fee?: Fee }) {
  const { t } = useI18n();
  const ft = t.settings.fees;
  const err = useFieldError();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={fee?.id ?? ""} />
      <TextField label={ft.namePt} name="name_pt" defaultValue={fee?.name_pt} required error={err("name_pt")} />
      <TextField label={ft.nameEs} name="name_es" defaultValue={fee?.name_es} required error={err("name_es")} />
      <TextField label={`${ft.amount} (€)`} name="amount" defaultValue={moneyInput(fee?.amount)} inputMode="decimal" required error={err("amount")} />
      <SelectField
        label={ft.chargeType}
        name="charge_type"
        defaultValue={fee?.charge_type ?? "per_rental"}
        options={[
          { value: "per_rental", label: ft.perRental },
          { value: "per_day", label: ft.perDay },
        ]}
      />
      <TextField
        label={ft.vat}
        name="vat_rate"
        defaultValue={fee?.vat_rate === null || fee?.vat_rate === undefined ? "" : String(fee.vat_rate).replace(".", ",")}
        inputMode="decimal"
        optionalLabel={t.common.optional}
        error={err("vat_rate")}
      />
      <SelectField
        label={t.users.status}
        name="is_active"
        defaultValue={String(fee?.is_active ?? true)}
        options={[
          { value: "true", label: t.common.active },
          { value: "false", label: t.common.inactive },
        ]}
      />
    </div>
  );
}

export function FeesManager({ fees }: { fees: Fee[] }) {
  const { t, locale } = useI18n();
  const ft = t.settings.fees;
  const [editing, setEditing] = useState<Fee | "new" | null>(null);
  const [removing, setRemoving] = useState<Fee | null>(null);
  const [pending, startTransition] = useTransition();
  const label = (f: Fee) => (locale === "es-ES" ? f.name_es : f.name_pt);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> {ft.new}
        </Button>
      </div>

      {fees.length === 0 ? (
        <EmptyState icon={Receipt} title={ft.empty} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {fees.map((fee) => (
            <li key={fee.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{label(fee)}</p>
                  {!fee.is_active && <Badge variant="neutral">{t.common.inactive}</Badge>}
                </div>
                <p className="text-xs text-muted tabular">
                  {formatCurrency(fee.amount, locale)} · {fee.charge_type === "per_day" ? ft.perDay : ft.perRental}
                  {fee.vat_rate !== null && ` · IVA ${String(fee.vat_rate).replace(".", ",")} %`}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setEditing(fee)} aria-label={`${t.common.edit}: ${label(fee)}`}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setRemoving(fee)} aria-label={`${t.common.remove}: ${label(fee)}`}>
                <Trash2 className="text-danger" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent title={editing === "new" ? ft.new : ft.editTitle} closeLabel={t.common.close}>
          {editing !== null && (
            <ActionForm action={saveFeeAction} successMessage={ft.saved} onSuccess={() => setEditing(null)}>
              <FeeFields fee={editing === "new" ? undefined : editing} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={removing ? interpolate(ft.confirmRemove, { name: label(removing) }) : ""}
        confirmLabel={t.common.remove}
        destructive
        pending={pending}
        onConfirm={() => {
          if (!removing) return;
          const id = removing.id;
          startTransition(async () => {
            const res = await deleteFeeAction(id);
            if (res.ok) toast.success(ft.removed);
            else toast.error(errorText(t, res.error));
            setRemoving(null);
          });
        }}
      />
    </div>
  );
}
