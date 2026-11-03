import { describe, expect, it } from "vitest";
import { compareInspections, suggestCategory } from "@/lib/inspections/constants";
import { damageSchema, inspectionDraftSchema } from "@/lib/validation/inspections";
import { toFieldErrors } from "@/lib/auth/validation";

describe("comparação entrega × devolução", () => {
  it("aponta apenas áreas que pioraram", () => {
    const r = compareInspections(
      { checklist: { front: { condition: "ok" }, left_side: { condition: "minor" }, rear: { condition: "damaged" }, glass: { condition: "ok" } }, mileage: 12500, fuel_level: 100 },
      { checklist: { front: { condition: "damaged", notes: "Amassado" }, left_side: { condition: "minor" }, rear: { condition: "ok" }, glass: { condition: "not_checked" } }, mileage: 12890, fuel_level: 75 },
    );
    expect(r.worsened.map((w) => w.area)).toEqual(["front"]);
    expect(r.worsened[0]).toMatchObject({ before: "ok", after: "damaged", afterNotes: "Amassado" });
    expect(r.drivenKm).toBe(390);
    expect(r.fuelDiff).toBe(-25);
    // área não verificada em uma das inspeções nunca é acusada
    expect(r.areas.find((a) => a.area === "glass")?.worsened).toBe(false);
  });
  it("sugere a categoria da avaria pela área", () => {
    expect(suggestCategory("wheels_tyres")).toBe("tyres");
    expect(suggestCategory("glass")).toBe("glass");
    expect(suggestCategory("front")).toBe("scratch");
  });
});

describe("validação de inspeção e avaria", () => {
  const base = { id: "11111111-1111-4111-8111-111111111111", checklist: JSON.stringify({ front: { condition: "ok" } }) };
  it("rascunho aceita campos vazios; conclusão exige km e combustível", () => {
    expect(inspectionDraftSchema.safeParse(base).success).toBe(true);
    const r = inspectionDraftSchema.safeParse({ ...base, complete: "1" });
    expect(!r.success && toFieldErrors(r.error)).toMatchObject({ mileage: "required", fuel_level: "invalidFuel" });
    expect(inspectionDraftSchema.parse({ ...base, complete: "1", mileage: "12500", fuel_level: "75" }).fuel_level).toBe(75);
  });
  it("checklist inválido é recusado", () => {
    expect(inspectionDraftSchema.safeParse({ ...base, checklist: JSON.stringify({ motor: { condition: "ok" } }) }).success).toBe(false);
    expect(inspectionDraftSchema.safeParse({ ...base, checklist: "{quebrado" }).success).toBe(false);
  });
  it("avaria", () => {
    const d = damageSchema.parse({
      id: "",
      vehicle_id: base.id,
      rental_id: "",
      inspection_id: "",
      area: "front",
      category: "dent",
      severity: "high",
      description: "Amassado no para-choque",
      estimated_cost: "380,00",
      status: "pending",
    });
    expect(d).toMatchObject({ id: null, rental_id: null, estimated_cost: "380.00", actual_cost: null });
    expect(damageSchema.safeParse({ ...d, id: "", description: "x" }).success).toBe(false);
  });
});
