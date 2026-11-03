"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeEuro, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { todayInMadrid } from "@/lib/periods";
import { sellVehicleAction, undoVehicleSaleAction } from "@/app/(app)/financial/actions";

function Fields({ vehicleId, suggested }: { vehicleId: string; suggested: number | null }) {
  const { t } = useI18n();
  const s = t.assets.sale;
  const err = useFieldError();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="vehicle_id" value={vehicleId} />
      <TextField label={s.sold_at} name="sold_at" type="date" defaultValue={todayInMadrid()} required error={err("sold_at")} />
      <TextField label={s.sale_price} name="sale_price" defaultValue={suggested === null ? "" : suggested.toFixed(2).replace(".", ",")} inputMode="decimal" required error={err("sale_price")} />
      <TextAreaField label={s.sale_notes} name="sale_notes" rows={2} optionalLabel={t.common.optional} className="sm:col-span-2" />
    </div>
  );
}

/** Registrar ou desfazer a venda do veículo (administrador principal). */
export function VehicleSale({ vehicleId, sold, suggested }: { vehicleId: string; sold: boolean; suggested: number | null }) {
  const { t } = useI18n();
  const s = t.assets.sale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (sold)
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Undo2 /> {s.undo}
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={s.undoConfirm}
          description={s.undoBody}
          confirmLabel={s.undo}
          destructive
          pending={pending}
          onConfirm={() =>
            start(async () => {
              const res = await undoVehicleSaleAction(vehicleId);
              setOpen(false);
              if (res.ok) {
                toast.success(s.undone);
                router.refresh();
              } else toast.error(errorText(t, res.error));
            })
          }
        />
      </>
    );
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <BadgeEuro /> {s.action}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={s.title} description={s.hint} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={sellVehicleAction}
              successMessage={s.saved}
              onSuccess={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              <Fields vehicleId={vehicleId} suggested={suggested} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
