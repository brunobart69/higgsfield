export const RENTAL_STATUSES = ["reservation", "confirmed", "in_progress", "late", "completed", "cancelled"] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];
export const PRICING_MODES = ["daily", "weekly", "monthly", "custom"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];
export const PAYMENT_METHODS = ["card", "cash", "bank_transfer", "bizum", "direct_debit", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const MILEAGE_POLICIES = ["unlimited", "daily", "weekly", "monthly", "custom"] as const;
export type MileagePolicy = (typeof MILEAGE_POLICIES)[number];
export const RENTALS_PAGE_SIZE = 25;

export const RENTAL_VARIANT: Record<RentalStatus, "warning" | "info" | "success" | "danger" | "neutral" | "default"> = {
  reservation: "warning",
  confirmed: "default",
  in_progress: "info",
  late: "danger",
  completed: "success",
  cancelled: "neutral",
};

/** "Atrasado" é derivado: em andamento com a devolução prevista já passada. */
export function effectiveRentalStatus(status: RentalStatus, returnAt: string, now: Date = new Date()): RentalStatus {
  if ((status === "in_progress" || status === "late") && new Date(returnAt).getTime() < now.getTime()) return "late";
  return status;
}
