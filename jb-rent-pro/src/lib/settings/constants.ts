/** Constantes compartilhadas com componentes cliente (sem importar zod no navegador). */
export const MILEAGE_POLICIES = ["unlimited", "daily", "weekly", "monthly", "custom"] as const;
export type MileagePolicy = (typeof MILEAGE_POLICIES)[number];
