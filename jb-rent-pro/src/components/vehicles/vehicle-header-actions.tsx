"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ChevronDown, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { errorText } from "@/lib/i18n/errors";
import { VEHICLE_STATUSES, type VehicleStatus } from "@/lib/vehicles/constants";
import { setVehicleArchivedAction, setVehicleStatusAction } from "@/app/(app)/vehicles/actions";

export function VehicleHeaderActions({ id, name, status, archived }: { id: string; name: string; status: VehicleStatus; archived: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function changeStatus(next: string) {
    if (next === status) return;
    startTransition(async () => {
      const res = await setVehicleStatusAction(id, next);
      if (res.ok) {
        toast.success(t.vehicles.statusChanged);
        router.refresh();
      } else toast.error(errorText(t, res.error));
    });
  }

  function toggleArchive() {
    startTransition(async () => {
      const res = await setVehicleArchivedAction(id, !archived);
      if (res.ok) {
        toast.success(archived ? t.vehicles.restoredOk : t.vehicles.archivedOk);
        router.refresh();
      } else toast.error(errorText(t, res.error));
      setConfirm(false);
    });
  }

  return (
    <>
      {!archived && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" loading={pending}>
              {t.vehicles.changeStatus} <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>{t.vehicles.statusHint}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={status} onValueChange={changeStatus}>
              {VEHICLE_STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {t.vehicles.status[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!archived && (
        <Button asChild>
          <Link href={`/vehicles/${id}/edit`}>
            <Pencil /> {t.common.edit}
          </Link>
        </Button>
      )}
      <Button variant="ghost" onClick={() => (archived ? toggleArchive() : setConfirm(true))} disabled={pending}>
        {archived ? <ArchiveRestore /> : <Archive />} {archived ? t.common.restore : t.common.archive}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={interpolate(t.vehicles.confirmArchive, { name })}
        description={t.vehicles.confirmArchiveBody}
        confirmLabel={t.common.archive}
        destructive
        pending={pending}
        onConfirm={toggleArchive}
      />
    </>
  );
}
