import { describe, expect, it } from "vitest";
import { allowedKm, baseCents, chargeDays, quote } from "@/lib/rentals/calc";
import { effectiveRentalStatus } from "@/lib/rentals/constants";
import { isoToMadridLocal, madridLocalToIso } from "@/lib/rentals/datetime";
import { depositSettleSchema, paymentSchema, rentalSchema, returnSchema } from "@/lib/validation/rentals";
import { toFieldErrors } from "@/lib/auth/validation";

// Os mesmos casos do teste de banco (004_rentals_test.sql): a prévia precisa bater com o banco.
describe("cálculo do contrato (espelho do PostgreSQL)", () => {
  it("dias cobrados", () => {
    expect(chargeDays("2026-11-10T09:00:00Z", "2026-11-14T09:00:00Z")).toBe(4);
    expect(chargeDays("2026-11-10T09:00:00Z", "2026-11-14T09:01:00Z")).toBe(5);
    expect(chargeDays("2026-11-10T09:00:00Z", "2026-11-14T09:59:00Z", 60)).toBe(4);
    expect(chargeDays("2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z")).toBe(1);
    expect(chargeDays(madridLocalToIso("2026-03-28", "10:00")!, madridLocalToIso("2026-03-30", "11:00")!)).toBe(2);
  });
  it("valor base por modalidade", () => {
    expect(baseCents("daily", 3500, 3)).toBe(10500);
    expect(baseCents("weekly", 28000, 10)).toBe(40000);
    expect(baseCents("monthly", 90000, 15)).toBe(45000);
    expect(baseCents("weekly", 25000, 3)).toBe(10714);
    expect(baseCents("custom", 19999, 9)).toBe(19999);
  });
  it("quilometragem incluída", () => {
    expect(allowedKm("unlimited", null, 5)).toBeNull();
    expect(allowedKm("daily", 200, 3)).toBe(600);
    expect(allowedKm("weekly", 1000, 10)).toBe(2000);
    expect(allowedKm("monthly", 3000, 31)).toBe(6000);
    expect(allowedKm("custom", 750, 9)).toBe(750);
  });
  it("contrato completo com extras, desconto e km excedente", () => {
    const q = quote({
      pickupIso: madridLocalToIso("2026-11-10", "10:00")!,
      returnIso: madridLocalToIso("2026-11-13", "10:00")!,
      mode: "daily",
      unitCents: 3500,
      discountCents: 500,
      extraFeesCents: 0,
      extras: [
        { amountCents: 650, quantity: 1, chargeType: "per_day" },
        { amountCents: 3000, quantity: 1, chargeType: "per_rental" },
      ],
      policy: "daily",
      limitKm: 200,
      excessKmPriceCents: 25,
      startMileage: 31500,
      endMileage: 32300,
    });
    expect(q).toMatchObject({ days: 3, baseCents: 10500, extrasCents: 4950, allowedKm: 600, excessKm: 200, excessCents: 5000, totalCents: 19950 });
    expect(q.discountTooHigh).toBe(false);
  });
  it("desconto acima do aluguel é sinalizado", () => {
    const q = quote({ pickupIso: "2026-11-10T09:00:00Z", returnIso: "2026-11-11T09:00:00Z", mode: "daily", unitCents: 3500, discountCents: 4000, extraFeesCents: 0, extras: [], policy: "unlimited", limitKm: null, excessKmPriceCents: 0 });
    expect(q.discountTooHigh).toBe(true);
  });
});

describe("datas e horas de Madri", () => {
  it("converte hora local em UTC respeitando CET/CEST", () => {
    expect(madridLocalToIso("2026-11-10", "10:00")).toBe("2026-11-10T09:00:00.000Z");
    expect(madridLocalToIso("2026-07-10", "10:00")).toBe("2026-07-10T08:00:00.000Z");
    expect(madridLocalToIso("2026-13-10", "10:00")).toBeNull();
    expect(madridLocalToIso("2026-11-10", "25:00")).toBeNull();
  });
  it("ida e volta", () => {
    expect(isoToMadridLocal("2026-07-10T08:00:00.000Z")).toEqual({ date: "2026-07-10", time: "10:00" });
    expect(isoToMadridLocal(null)).toEqual({ date: "", time: "" });
  });
  it("status atrasado é derivado", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    expect(effectiveRentalStatus("in_progress", "2026-11-14T09:00:00Z", now)).toBe("late");
    expect(effectiveRentalStatus("in_progress", "2026-11-16T09:00:00Z", now)).toBe("in_progress");
    expect(effectiveRentalStatus("completed", "2026-11-14T09:00:00Z", now)).toBe("completed");
  });
});

describe("validação do contrato", () => {
  const base = {
    customer_id: "11111111-1111-4111-8111-111111111111",
    vehicle_id: "22222222-2222-4222-8222-222222222222",
    status: "confirmed",
    pickup_date: "2026-11-10",
    pickup_time: "10:00",
    return_date: "2026-11-13",
    return_time: "10:00",
    pricing_mode: "daily",
    unit_price: "35,00",
    mileage_policy: "unlimited",
    contract_locale: "es-ES",
    payment_method: "",
  };
  it("normaliza valores e datas", () => {
    const r = rentalSchema.parse({ ...base, extras: JSON.stringify([{ name: "Silla", amount: "5.00", charge_type: "per_day", quantity: 2 }]) });
    expect(r.pickup_at).toBe("2026-11-10T09:00:00.000Z");
    expect(r.unit_price).toBe("35.00");
    expect(r.discount_amount).toBe("0.00");
    expect(r.payment_method).toBeNull();
    expect(r.mileage_limit_km).toBeNull();
    expect(r.extras).toHaveLength(1);
  });
  it("devolução antes da retirada e limite de km", () => {
    const r = rentalSchema.safeParse({ ...base, return_date: "2026-11-09", mileage_policy: "daily" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = toFieldErrors(r.error);
      expect(fe.return_date).toBe("returnBeforePickup");
      expect(fe.mileage_limit_km).toBe("mileageLimitRequired");
    }
  });
  it("extras malformados são recusados", () => {
    expect(rentalSchema.safeParse({ ...base, extras: "[{\"name\":\"x\",\"amount\":\"-1\"}]" }).success).toBe(false);
  });
  it("devolução, pagamento e caução", () => {
    const ret = returnSchema.parse({ rental_id: base.vehicle_id, end_mileage: "32.300", end_fuel_level: "75", return_date: "2026-11-13", return_time: "09:40" });
    expect(ret).toMatchObject({ end_mileage: 32300, end_fuel_level: 75, actual_return_at: "2026-11-13T08:40:00.000Z", late_fee: "0.00" });
    expect(returnSchema.safeParse({ rental_id: base.vehicle_id, end_mileage: "x", end_fuel_level: "120", return_date: "2026-11-13", return_time: "09:40" }).success).toBe(false);
    expect(paymentSchema.safeParse({ rental_id: base.vehicle_id, kind: "payment", amount: "0", paid_at: "2026-11-10", method: "card" }).success).toBe(false);
    const dep = depositSettleSchema.safeParse({ rental_id: base.vehicle_id, amount_returned: "250", amount_retained: "50", returned_at: "2026-11-13", returned_method: "card" });
    expect(!dep.success && toFieldErrors(dep.error).retention_reason).toBe("retentionReasonRequired");
  });
});
