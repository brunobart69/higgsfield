import { describe, expect, it } from "vitest";
import { addMonthsKeepDay, isOperational, splitInstallments, vehicleReturns, MANUAL_EXPENSE, MANUAL_INCOME } from "@/lib/finance/constants";
import { entrySchema, openingBalanceSchema, vehicleSaleSchema } from "@/lib/validation/finance";

describe("parcelas", () => {
  it("divide em centavos e ajusta a última", () => {
    expect(splitInstallments("1000.00", 3)).toEqual(["333.33", "333.33", "333.34"]);
    expect(splitInstallments("120.00", 12).every((v) => v === "10.00")).toBe(true);
    const parts = splitInstallments("999.99", 7);
    expect(parts.reduce((a, v) => a + Math.round(Number(v) * 100), 0)).toBe(99999);
  });
  it("mantém o dia do mês (ajustando ao fim do mês)", () => {
    expect(addMonthsKeepDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsKeepDay("2027-12-15", 2)).toBe("2028-02-15");
    expect(addMonthsKeepDay("2028-01-31", 1)).toBe("2028-02-29");
  });
});

describe("classificação", () => {
  it("compra/venda de veículo e financiamento ficam fora do resultado", () => {
    expect(isOperational("vehicle_purchase")).toBe(false);
    expect(isOperational("vehicle_sale")).toBe(false);
    expect(isOperational("loan_repayment")).toBe(false);
    expect(isOperational("maintenance")).toBe(true);
    expect(isOperational("rental")).toBe(true);
  });
  it("categorias automáticas não aparecem nos lançamentos manuais", () => {
    expect(MANUAL_INCOME).not.toContain("rental");
    expect(MANUAL_INCOME).not.toContain("vehicle_sale");
    expect(MANUAL_EXPENSE).not.toContain("vehicle_purchase");
    expect(MANUAL_EXPENSE).toContain("loan_repayment");
  });
});

describe("rentabilidade do veículo", () => {
  it("ROI, retorno total e recuperação", () => {
    const r = vehicleReturns({ purchase_price: 20000, current_value: 16000, profit: 6000, months_in_fleet: 12 });
    expect(r).toMatchObject({ depreciation: 4000, monthlyProfit: 500, roi: 30, totalReturn: 10, paybackMonths: 0 });
    const s = vehicleReturns({ purchase_price: 20000, current_value: 16000, profit: 1000, months_in_fleet: 4 });
    // faltam 3.000 para cobrir a depreciação, a 250/mês → 12 meses
    expect(s.paybackMonths).toBe(12);
    expect(vehicleReturns({ purchase_price: null, current_value: null, profit: 100, months_in_fleet: 2 })).toMatchObject({ roi: null, paybackMonths: null });
    expect(vehicleReturns({ purchase_price: 10000, current_value: 9000, profit: -50, months_in_fleet: 3 }).paybackMonths).toBeNull();
  });
});

describe("validação de lançamentos", () => {
  const base = { type: "expense", category: "fuel", description: "Gasóleo", amount: "60,50", competence_date: "2026-11-03", status: "pending" };
  it("aceita lançamento manual e converte valores", () => {
    const r = entrySchema.safeParse({ ...base, vat_rate: "21", installments: "" });
    expect(r.success && r.data).toMatchObject({ amount: "60.50", vat_rate: "21", installments: null, vehicle_id: null });
  });
  it("rejeita categoria automática ou de outro tipo", () => {
    expect(entrySchema.safeParse({ ...base, category: "vehicle_purchase" }).success).toBe(false);
    expect(entrySchema.safeParse({ ...base, type: "income" }).success).toBe(false);
  });
  it("pago exige data; parcelas só pendentes", () => {
    expect(entrySchema.safeParse({ ...base, status: "paid" }).error?.issues[0]?.path).toEqual(["paid_at"]);
    expect(entrySchema.safeParse({ ...base, status: "paid", paid_at: "2026-11-03", installments: "3" }).error?.issues[0]?.message).toBe("installmentsPending");
    expect(entrySchema.safeParse({ ...base, installments: "121" }).success).toBe(false);
  });
  it("saldo inicial aceita negativo; venda exige valor", () => {
    expect(openingBalanceSchema.parse({ cash_opening_balance: "-1.250,40", cash_opening_date: "2026-01-01" }).cash_opening_balance).toBe("-1250.40");
    expect(vehicleSaleSchema.safeParse({ vehicle_id: "aaaaaaaa-0000-0000-0000-000000000009", sold_at: "2026-11-03", sale_price: "" }).success).toBe(false);
  });
});
