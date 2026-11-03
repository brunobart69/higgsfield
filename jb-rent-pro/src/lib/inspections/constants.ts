/** Áreas do checklist — mesma lista de app.inspection_areas() no banco. */
export const INSPECTION_AREAS = [
  "front",
  "rear",
  "left_side",
  "right_side",
  "roof",
  "glass",
  "lights",
  "wheels_tyres",
  "interior",
  "dashboard",
  "trunk",
  "safety_kit",
] as const;
export type InspectionArea = (typeof INSPECTION_AREAS)[number];

/** Agrupamento exibido (carroceria, pneus, interior) conforme o pedido do negócio. */
export const AREA_GROUPS: Array<{ key: "body" | "tyres" | "interior"; areas: InspectionArea[] }> = [
  { key: "body", areas: ["front", "rear", "left_side", "right_side", "roof", "glass", "lights"] },
  { key: "tyres", areas: ["wheels_tyres"] },
  { key: "interior", areas: ["interior", "dashboard", "trunk", "safety_kit"] },
];

export const CONDITIONS = ["ok", "minor", "damaged", "not_checked"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_RANK: Record<Condition, number> = { not_checked: -1, ok: 0, minor: 1, damaged: 2 };

export const INSPECTION_TYPES = ["delivery", "return", "periodic"] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const DAMAGE_CATEGORIES = ["scratch", "dent", "paint", "mechanical", "electrical", "tyres", "glass", "interior", "other"] as const;
export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];
export const DAMAGE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type DamageSeverity = (typeof DAMAGE_SEVERITIES)[number];
export const DAMAGE_STATUSES = ["pending", "in_repair", "resolved"] as const;
export type DamageStatus = (typeof DAMAGE_STATUSES)[number];

export const SEVERITY_VARIANT: Record<DamageSeverity, "neutral" | "warning" | "danger" | "info"> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
};
export const DAMAGE_STATUS_VARIANT: Record<DamageStatus, "warning" | "info" | "success"> = {
  pending: "warning",
  in_repair: "info",
  resolved: "success",
};

/** Categoria sugerida a partir da área (ponto de partida ao registrar a avaria). */
export function suggestCategory(area: InspectionArea): DamageCategory {
  if (area === "glass" || area === "lights") return "glass";
  if (area === "wheels_tyres") return "tyres";
  if (area === "interior" || area === "dashboard" || area === "trunk") return "interior";
  if (area === "safety_kit") return "other";
  return "scratch";
}

export type ChecklistEntry = { condition: Condition; notes?: string };
export type Checklist = Partial<Record<InspectionArea, ChecklistEntry>>;

export type AreaDiff = {
  area: InspectionArea;
  before: Condition;
  after: Condition;
  beforeNotes?: string;
  afterNotes?: string;
  worsened: boolean;
};

/**
 * Compara as inspeções de entrega e devolução: aponta as áreas cujo estado
 * piorou (possível nova avaria) e as diferenças de km e combustível.
 */
export function compareInspections(
  delivery: { checklist: Checklist; mileage: number | null; fuel_level: number | null },
  ret: { checklist: Checklist; mileage: number | null; fuel_level: number | null },
) {
  const areas: AreaDiff[] = INSPECTION_AREAS.map((area) => {
    const b = delivery.checklist[area];
    const a = ret.checklist[area];
    const before = b?.condition ?? "not_checked";
    const after = a?.condition ?? "not_checked";
    const worsened = before !== "not_checked" && after !== "not_checked" && CONDITION_RANK[after] > CONDITION_RANK[before];
    return { area, before, after, beforeNotes: b?.notes, afterNotes: a?.notes, worsened };
  });
  return {
    areas,
    worsened: areas.filter((x) => x.worsened),
    drivenKm: delivery.mileage !== null && ret.mileage !== null ? ret.mileage - delivery.mileage : null,
    fuelDiff: delivery.fuel_level !== null && ret.fuel_level !== null ? ret.fuel_level - delivery.fuel_level : null,
  };
}
