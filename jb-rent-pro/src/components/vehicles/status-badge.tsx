"use client";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import { STATUS_VARIANT, type VehicleStatus } from "@/lib/vehicles/constants";

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.vehicles.status[status]}
    </Badge>
  );
}
