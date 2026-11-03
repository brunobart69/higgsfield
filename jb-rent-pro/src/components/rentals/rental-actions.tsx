"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, FileDown, KeyRound, Pencil, Undo2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { errorText } from "@/lib/i18n/errors";
import { formatCurrency, formatNumber } from "@/lib/format";
import { chargeDays } from "@/lib/rentals/calc";
import { isoToMadridLocal, madridLocalToIso } from "@/lib/rentals/datetime";
import type { RentalStatus } from "@/lib/rentals/constants";
import { cancelRentalAction, confirmRentalAction, pickupRentalAction, returnRentalAction } from "@/app/(app)/rentals/actions";

type Props = {
  id: string;
  contractNumber: string;
  status: RentalStatus;
  pickupAt: string;
  returnAt: string;
  startMileage: number | null;
  vehicleMileage: number;
  vehicleDailyPrice: number | null;
  allowedKm: number | null;
  excessKmPrice: number | null;
  graceMinutes: number;
};

function PickupFields({ id, vehicleMileage }: { id: string; vehicleMileage: number }) {
  const { t } = useI18n();
  const d = t.rentals.pickupDialog;
  const err = useFieldError();
  return (
    <>
      <input type="hidden" name="rental_id" value={id} />
      <p className="text-sm text-muted">{d.body}</p>
      <div className="grid grid-cols-2 gap-4">
        <TextField label={d.mileage} name="start_mileage" defaultValue={String(vehicleMileage)} inputMode="numeric" required error={err("start_mileage")} />
        <TextField label={d.fuel} name="start_fuel_level" defaultValue="100" inputMode="numeric" required error={err("start_fuel_level")} />
      </div>
    </>
  );
}

function ReturnFields(p: Props) {
  const { t, locale } = useI18n();
  const d = t.rentals.returnDialog;
  const err = useFieldError();
  const now = isoToMadridLocal(new Date().toISOString());
  const [date, setDate] = useState(now.date);
  const [time, setTime] = useState(now.time.slice(0, 5));
  const [km, setKm] = useState("");
  const actualIso = madridLocalToIso(date, time);
  const lateDays = useMemo(() => {
    if (!actualIso) return 0;
    const contracted = chargeDays(p.pickupAt, p.returnAt, p.graceMinutes);
    const actual = chargeDays(p.pickupAt, actualIso, p.graceMinutes);
    return Math.max(0, actual - contracted);
  }, [actualIso, p.pickupAt, p.returnAt, p.graceMinutes]);
  const suggestion = lateDays > 0 && p.vehicleDailyPrice ? lateDays * p.vehicleDailyPrice : 0;
  const driven = km && p.startMileage !== null ? Number(km.replace(/\D/g, "")) - p.startMileage : null;
  const excess = driven !== null && p.allowedKm !== null ? Math.max(0, driven - p.allowedKm) : 0;

  return (
    <>
      <input type="hidden" name="rental_id" value={p.id} />
      <div className="grid grid-cols-2 gap-4">
        <TextField label={d.mileage} name="end_mileage" value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" required error={err("end_mileage")} />
        <TextField label={d.fuel} name="end_fuel_level" defaultValue="100" inputMode="numeric" required error={err("end_fuel_level")} />
      </div>
      {driven !== null && driven >= 0 && p.allowedKm !== null && (
        <p className="rounded-md border border-border bg-surface-2 p-3 text-xs text-muted tabular">
          {interpolate(d.excessPreview, {
            driven: formatNumber(driven, locale),
            allowed: formatNumber(p.allowedKm, locale),
            excess: formatNumber(excess, locale),
            amount: formatCurrency(excess * (p.excessKmPrice ?? 0), locale),
          })}
        </p>
      )}
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <TextField label={d.when} name="return_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required error={err("return_date")} />
        <TextField label={t.rentals.fields.time} name="return_time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>
      <TextField
        label={d.lateFee}
        name="late_fee"
        key={suggestion}
        defaultValue={suggestion ? suggestion.toFixed(2).replace(".", ",") : ""}
        inputMode="decimal"
        hint={lateDays > 0 ? interpolate(d.lateHint, { n: lateDays, amount: formatCurrency(suggestion, locale) }) : undefined}
        optionalLabel={t.common.optional}
        error={err("late_fee")}
      />
      <TextAreaField label={d.notes} name="return_notes" rows={2} optionalLabel={t.common.optional} />
    </>
  );
}

function CancelFields({ id }: { id: string }) {
  const { t } = useI18n();
  const err = useFieldError();
  return (
    <>
      <input type="hidden" name="rental_id" value={id} />
      <TextAreaField label={t.rentals.cancelDialog.reason} name="cancelled_reason" rows={3} required error={err("cancelled_reason")} />
    </>
  );
}

export function RentalActions(p: Props) {
  const { t } = useI18n();
  const a = t.rentals.actions;
  const router = useRouter();
  const [dialog, setDialog] = useState<"pickup" | "return" | "cancel" | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => {
    setDialog(null);
    router.refresh();
  };
  const editable = p.status === "reservation" || p.status === "confirmed" || p.status === "in_progress" || p.status === "late";
  const active = p.status === "in_progress" || p.status === "late";

  return (
    <>
      {p.status === "reservation" && (
        <Button
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await confirmRentalAction(p.id);
              if (res.ok) {
                toast.success(t.rentals.confirmed);
                router.refresh();
              } else toast.error(errorText(t, res.error));
            })
          }
        >
          <CheckCircle2 /> {a.confirm}
        </Button>
      )}
      {(p.status === "reservation" || p.status === "confirmed") && (
        <Button onClick={() => setDialog("pickup")}>
          <KeyRound /> {a.pickup}
        </Button>
      )}
      {active && (
        <Button onClick={() => setDialog("return")}>
          <Undo2 /> {a.return}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <FileDown /> {a.pdf} <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={`/api/rentals/${p.id}/contract?lang=es-ES`} target="_blank" rel="noopener noreferrer">
              {a.pdfEs}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/rentals/${p.id}/contract?lang=pt-BR`} target="_blank" rel="noopener noreferrer">
              {a.pdfPt}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editable && (
        <Button asChild variant="ghost">
          <Link href={`/rentals/${p.id}/edit`}>
            <Pencil /> {t.common.edit}
          </Link>
        </Button>
      )}
      {(p.status === "reservation" || p.status === "confirmed") && (
        <Button variant="ghost" className="text-danger" onClick={() => setDialog("cancel")}>
          <XCircle /> {a.cancel}
        </Button>
      )}

      <Dialog open={dialog === "pickup"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={t.rentals.pickupDialog.title} description={p.contractNumber} closeLabel={t.common.close}>
          <ActionForm action={pickupRentalAction} submitLabel={a.pickup} successMessage={t.rentals.pickupDialog.done} onSuccess={close}>
            <PickupFields id={p.id} vehicleMileage={p.vehicleMileage} />
          </ActionForm>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "return"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={t.rentals.returnDialog.title} description={p.contractNumber} closeLabel={t.common.close}>
          <ActionForm action={returnRentalAction} submitLabel={a.return} successMessage={t.rentals.returnDialog.done} onSuccess={close}>
            <ReturnFields {...p} />
          </ActionForm>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "cancel"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent title={interpolate(t.rentals.cancelDialog.title, { number: p.contractNumber })} closeLabel={t.common.close}>
          <ActionForm action={cancelRentalAction} submitLabel={a.cancel} successMessage={t.rentals.cancelDialog.done} onSuccess={close}>
            <CancelFields id={p.id} />
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
