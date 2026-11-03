"use client";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import { RENTAL_VARIANT, effectiveRentalStatus, type RentalStatus } from "@/lib/rentals/constants";

export function RentalStatusBadge({ status, returnAt }: { status: RentalStatus; returnAt: string }) {
  const { t } = useI18n();
  const s = effectiveRentalStatus(status, returnAt);
  return (
    <Badge variant={RENTAL_VARIANT[s]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.rentalStatus[s]}
    </Badge>
  );
}
