"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { todayInMadrid } from "@/lib/periods";
import { saveOpeningBalanceAction } from "@/app/(app)/financial/actions";

function Fields({ balance, date }: { balance: number | null; date: string | null }) {
  const { t } = useI18n();
  const c = t.financial.cashflow;
  const err = useFieldError();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label={c.openingDate} name="cash_opening_date" type="date" defaultValue={date ?? `${todayInMadrid().slice(0, 4)}-01-01`} required error={err("cash_opening_date")} />
      <TextField
        label={c.openingAmount}
        name="cash_opening_balance"
        defaultValue={balance === null ? "" : balance.toFixed(2).replace(".", ",")}
        inputMode="decimal"
        required
        error={err("cash_opening_balance")}
      />
    </div>
  );
}

export function OpeningBalanceDialog({ balance, date }: { balance: number | null; date: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const c = t.financial.cashflow;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Landmark /> {c.openingSave}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={c.opening} closeLabel={t.common.close}>
          {open && (
            <ActionForm
              action={saveOpeningBalanceAction}
              successMessage={c.openingSaved}
              onSuccess={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              <Fields balance={balance} date={date} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
