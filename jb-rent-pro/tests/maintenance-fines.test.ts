import { describe, expect, it } from "vitest";
import { financeCategoryFor, planDue } from "@/lib/maintenance/constants";
import { daysUntil } from "@/lib/fines/constants";
import { finesOverview } from "@/lib/fines/overview";
import type { Fine } from "@/lib/fines/queries";
import { completeMaintenanceSchema, maintenanceSchema, planSchema } from "@/lib/validation/maintenance";
import { accidentSchema, fineSchema } from "@/lib/validation/fines";

const today = "2026-11-03";
const V = "aaaaaaaa-0000-0000-0000-000000000002";

describe("vencimento de planos", () => {
  it("por km: em breve até 1.000 km, vencido ao atingir", () => {
    const p = { interval_km: 15000, interval_months: null, last_done_date: null, last_done_mileage: 18100 };
    expect(planDue(p, 30000, today)).toMatchObject({ nextKm: 33100, kmLeft: 3100, status: "ok" });
    expect(planDue(p, 32100, today)).toMatchObject({ kmLeft: 1000, status: "due_soon" });
    expect(planDue(p, 33100, today).status).toBe("overdue");
  });
  it("por data: meses de calendário, o que vencer primeiro", () => {
    const p = { interval_km: 15000, interval_months: 12, last_done_date: "2025-11-20", last_done_mileage: 20000 };
    expect(planDue(p, 21000, today)).toMatchObject({ nextDate: "2026-11-20", daysLeft: 17, status: "due_soon" });
    expect(planDue({ ...p, last_done_date: "2025-10-31" }, 21000, today)).toMatchObject({ nextDate: "2026-10-31", status: "overdue" });
    expect(planDue({ ...p, interval_months: 1, last_done_date: "2026-01-31" }, 21000, "2026-02-01").nextDate).toBe("2026-02-28");
  });
  it("categoria financeira por tipo", () => {
    expect(financeCategoryFor("bodywork")).toBe("repairs");
    expect(financeCategoryFor("repair")).toBe("repairs");
    expect(financeCategoryFor("tyres")).toBe("tyres");
    expect(financeCategoryFor("oil_change")).toBe("maintenance");
  });
});

describe("validação de manutenção", () => {
  it("nova ordem exige data agendada", () => {
    const base = { vehicle_id: V, maintenance_type: "oil_change", title: "Aceite" };
    expect(maintenanceSchema.safeParse(base).success).toBe(false);
    const ok = maintenanceSchema.safeParse({ ...base, scheduled_date: "2026-11-10", cost: "189,90", blocks_vehicle: "on" });
    expect(ok.success && ok.data).toMatchObject({ cost: "189.90", blocks_vehicle: true, plan_id: null });
  });
  it("conclusão: data obrigatória e pagamento exige custo", () => {
    const id = "66660000-0000-4000-8000-000000000001";
    expect(completeMaintenanceSchema.safeParse({ id }).success).toBe(false);
    const r = completeMaintenanceSchema.safeParse({ id, completed_date: "2026-11-03", paid_at: "2026-11-03" });
    expect(r.error?.issues[0]?.path).toEqual(["cost"]);
    expect(completeMaintenanceSchema.safeParse({ id, completed_date: "2026-11-03", mileage: "33250", cost: "10" }).success).toBe(true);
  });
  it("plano exige intervalo e referência", () => {
    const base = { vehicle_id: V, name: "Aceite", maintenance_type: "oil_change" };
    expect(planSchema.safeParse(base).error?.issues[0]?.message).toBe("intervalRequired");
    expect(planSchema.safeParse({ ...base, interval_km: "15000" }).error?.issues[0]?.path).toEqual(["last_done_mileage"]);
    expect(planSchema.safeParse({ ...base, interval_months: "12", last_done_date: "2026-01-01" }).success).toBe(true);
  });
});

describe("validação de multas e sinistros", () => {
  const fine = {
    vehicle_id: V,
    infraction_date: "2026-07-15",
    infraction_time: "18:40",
    authority: "DGT",
    infraction: "Exceso de velocidad",
    amount: "100",
    status: "pending",
  };
  it("converte data/hora de Madri (verão +2)", () => {
    const r = fineSchema.safeParse(fine);
    expect(r.success && r.data.infraction_at).toBe("2026-07-15T16:40:00.000Z");
  });
  it("multa paga exige data e vice-versa", () => {
    expect(fineSchema.safeParse({ ...fine, status: "paid" }).error?.issues[0]?.path).toEqual(["paid_at"]);
    expect(fineSchema.safeParse({ ...fine, paid_at: "2026-08-01" }).error?.issues[0]?.message).toBe("paidStatusRequired");
    expect(fineSchema.safeParse({ ...fine, amount: "" }).success).toBe(false);
  });
  it("sinistro: inverno +1 e valores recebidos exigem valor", () => {
    const a = { vehicle_id: V, occurred_date: "2026-12-01", occurred_time: "09:15", description: "Alcance", status: "reported", fault: "unknown" };
    const r = accidentSchema.safeParse({ ...a, third_party: "on" });
    expect(r.success && r.data).toMatchObject({ occurred_at: "2026-12-01T08:15:00.000Z", third_party: true, injuries: false });
    expect(accidentSchema.safeParse({ ...a, insurer_payout_at: "2027-01-10" }).error?.issues[0]?.path).toEqual(["insurer_payout"]);
  });
});

describe("prazos e resumo de multas", () => {
  it("dias até o prazo", () => {
    expect(daysUntil("2026-11-10", today)).toBe(7);
    expect(daysUntil("2026-11-01", today)).toBe(-2);
    expect(daysUntil(null, today)).toBeNull();
  });
  it("resumo: abertas, a identificar, a recuperar e pagas no ano", () => {
    const f = (o: Partial<Fine>): Fine => ({ status: "pending", amount: 100, identification_deadline: null, recharge_amount: null, recharge_paid_at: null, paid_at: null, paid_amount: null, ...o }) as Fine;
    const ov = finesOverview(
      [
        f({ identification_deadline: "2026-11-08" }),
        f({ identification_deadline: "2026-11-30" }),
        f({ status: "paid", paid_at: "2026-02-01", paid_amount: 45.1, recharge_amount: 65.2 }),
        f({ status: "paid", paid_at: "2025-12-01", paid_amount: 90, recharge_amount: 90, recharge_paid_at: "2025-12-05" }),
        f({ status: "cancelled", recharge_amount: 50 }),
      ],
      today,
    );
    expect(ov).toEqual({ open: 2, identifyDue: 1, toRecover: 65.2, paidYear: 45.1 });
  });
});
