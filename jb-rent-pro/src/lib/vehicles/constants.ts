/** Constantes de veículos compartilhadas entre servidor e cliente (sem zod). */
export const VEHICLE_STATUSES = ["available", "reserved", "rented", "maintenance", "unavailable", "sold"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const FUEL_TYPES = ["gasoline", "diesel", "hybrid", "plugin_hybrid", "electric", "lpg", "other"] as const;
export const TRANSMISSIONS = ["manual", "automatic"] as const;
export const VEHICLE_TYPES = ["compact", "sedan", "suv", "estate", "minivan", "van", "convertible", "coupe", "pickup", "other"] as const;
export const PHOTO_KINDS = ["main", "exterior", "interior", "detail"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const VEHICLE_DOC_CATEGORIES = ["circulation_permit", "technical_sheet", "itv", "insurance_policy", "invoice", "vehicle_document", "other"] as const;

/** Cor do status (padrão do calendário: verde/azul/amarelo/vermelho/cinza). */
export const STATUS_VARIANT: Record<VehicleStatus, "success" | "info" | "warning" | "danger" | "neutral"> = {
  available: "success",
  rented: "info",
  reserved: "warning",
  maintenance: "danger",
  unavailable: "neutral",
  sold: "neutral",
};

export const VEHICLES_PAGE_SIZE = 24;
