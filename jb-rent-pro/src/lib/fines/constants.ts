export const FINE_STATUSES = ["pending", "driver_identified", "paid", "appealed", "cancelled"] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];
export const FINE_STATUS_VARIANT: Record<FineStatus, "warning" | "info" | "success" | "neutral"> = {
  pending: "warning",
  driver_identified: "info",
  paid: "success",
  appealed: "info",
  cancelled: "neutral",
};

export const ACCIDENT_STATUSES = ["reported", "under_review", "in_repair", "closed", "rejected"] as const;
export type AccidentStatus = (typeof ACCIDENT_STATUSES)[number];
export const ACCIDENT_STATUS_VARIANT: Record<AccidentStatus, "warning" | "info" | "success" | "neutral" | "danger"> = {
  reported: "warning",
  under_review: "info",
  in_repair: "info",
  closed: "success",
  rejected: "danger",
};
export const ACCIDENT_FAULTS = ["own", "third_party", "shared", "unknown"] as const;
export type AccidentFault = (typeof ACCIDENT_FAULTS)[number];

/** Dias até um prazo (negativo = vencido). */
export function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
