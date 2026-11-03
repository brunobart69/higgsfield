/** Converte erros do PostgREST/PostgreSQL em chaves de tradução (errors.*). */
export function mapDbError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return "generic";
  const msg = err.message ?? "";
  if (msg.includes("LAST_OWNER")) return "lastOwner";
  if (msg.includes("cannot deactivate yourself") || msg.includes("cannot demote itself")) return "cannotChangeSelf";
  if (msg.includes("HARD_DELETE_FORBIDDEN")) return "hardDeleteForbidden";
  if (msg.includes("VEHICLE_NOT_RENTABLE")) return "vehicleNotRentable";
  if (msg.includes("MILEAGE_DECREASE")) return "mileageDecrease";
  if (msg.includes("INVALID_STATUS_TRANSITION")) return "invalidStatusTransition";
  if (msg.includes("PICKUP_DATA_REQUIRED")) return "pickupDataRequired";
  if (msg.includes("RETURN_DATA_REQUIRED")) return "returnDataRequired";
  if (msg.includes("CANCEL_REASON_REQUIRED")) return "cancelReasonRequired";
  if (msg.includes("RENTAL_LOCKED")) return "rentalLocked";
  if (msg.includes("DISCOUNT_TOO_HIGH")) return "discountTooHigh";
  if (msg.includes("PAYMENT_IMMUTABLE")) return "paymentImmutable";
  if (msg.includes("INSPECTION_LOCKED")) return "inspectionLocked";
  if (msg.includes("INSPECTION_RENTAL_MISMATCH")) return "inspectionRentalMismatch";
  if (msg.includes("INSPECTION_RENTAL_NOT_ACTIVE")) return "inspectionRentalNotActive";
  if (msg.includes("INSPECTION_DATA_REQUIRED")) return "inspectionDataRequired";
  if (msg.includes("DAMAGE_RENTAL_MISMATCH")) return "damageRentalMismatch";
  if (msg.includes("RENEWAL_MISMATCH")) return "renewalMismatch";
  if (msg.includes("VEHICLE_BUSY")) return "vehicleBusy";
  if (msg.includes("MAINTENANCE_LOCKED")) return "maintenanceLocked";
  if (msg.includes("MAINTENANCE_DATA_REQUIRED")) return "maintenanceDataRequired";
  if (msg.includes("MAINTENANCE_LINK_MISMATCH")) return "linkMismatch";
  if (msg.includes("FINE_NO_DRIVER") || msg.includes("ACCIDENT_NO_CUSTOMER")) return "customerRequired";
  if (msg.includes("FINE_RENTAL_MISMATCH") || msg.includes("ACCIDENT_RENTAL_MISMATCH") || msg.includes("ACCIDENT_POLICY_MISMATCH")) return "linkMismatch";
  if (msg.includes("CUSTOMER_HAS_ACTIVE_RENTALS")) return "customerHasActiveRentals";
  switch (err.code) {
    case "42501":
      return "forbidden";
    case "23505":
      return "duplicate";
    case "23P01":
      return "bookingConflict";
    case "23514":
    case "22P02":
      return "invalid";
    case "23503":
      return "inUse";
    case "PGRST116":
      return "notFound";
    default:
      return "generic";
  }
}

/** FormData → objeto de strings (ignora arquivos). */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
