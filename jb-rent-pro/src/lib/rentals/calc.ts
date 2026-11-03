/**
 * Espelho das fórmulas do banco (app.rental_charge_days, app.rental_base_amount,
 * app.rental_allowed_km, app.compute_rental) para a PRÉVIA do formulário.
 * O valor oficial é sempre o calculado pelo PostgreSQL ao salvar.
 * Toda a aritmética é feita em centavos inteiros.
 */
import type { MileagePolicy, PricingMode } from "./constants";

export function chargeDays(pickupIso: string, returnIso: string, graceMinutes = 0): number {
  const secs = (new Date(returnIso).getTime() - new Date(pickupIso).getTime()) / 1000;
  if (!Number.isFinite(secs)) return 1;
  return Math.max(1, Math.ceil(Math.max(0, secs - graceMinutes * 60) / 86400));
}

/** round half away from zero, como numeric round() do PostgreSQL. */
function roundCents(x: number) {
  return Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
}

export function baseCents(mode: PricingMode, unitCents: number, days: number): number {
  switch (mode) {
    case "daily":
      return unitCents * days;
    case "weekly":
      return roundCents((unitCents * days) / 7);
    case "monthly":
      return roundCents((unitCents * days) / 30);
    default:
      return unitCents;
  }
}

export function allowedKm(policy: MileagePolicy, limit: number | null, days: number): number | null {
  if (policy === "unlimited" || limit === null) return null;
  switch (policy) {
    case "daily":
      return limit * days;
    case "weekly":
      return limit * Math.ceil(days / 7);
    case "monthly":
      return limit * Math.ceil(days / 30);
    default:
      return limit;
  }
}

export type ExtraLine = { amountCents: number; quantity: number; chargeType: "per_rental" | "per_day" };

export type QuoteInput = {
  pickupIso: string;
  returnIso: string;
  graceMinutes?: number;
  mode: PricingMode;
  unitCents: number;
  discountCents: number;
  extraFeesCents: number;
  extras: ExtraLine[];
  policy: MileagePolicy;
  limitKm: number | null;
  excessKmPriceCents: number;
  startMileage?: number | null;
  endMileage?: number | null;
};

export type Quote = {
  days: number;
  baseCents: number;
  extrasCents: number;
  allowedKm: number | null;
  excessKm: number;
  excessCents: number;
  totalCents: number;
  discountTooHigh: boolean;
};

export function quote(i: QuoteInput): Quote {
  const days = chargeDays(i.pickupIso, i.returnIso, i.graceMinutes ?? 0);
  const base = baseCents(i.mode, i.unitCents, days);
  const extras = i.extras.reduce((acc, e) => acc + e.amountCents * e.quantity * (e.chargeType === "per_day" ? days : 1), 0);
  const allowed = allowedKm(i.policy, i.limitKm, days);
  let excessKm = 0;
  if (allowed !== null && i.startMileage != null && i.endMileage != null) {
    excessKm = Math.max(0, i.endMileage - i.startMileage - allowed);
  }
  const excess = excessKm * i.excessKmPriceCents;
  const discountTooHigh = i.discountCents > base + i.extraFeesCents;
  const total = base + i.extraFeesCents - i.discountCents + extras + excess;
  return { days, baseCents: base, extrasCents: extras, allowedKm: allowed, excessKm, excessCents: excess, totalCents: Math.max(0, total), discountTooHigh };
}
