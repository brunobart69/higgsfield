export const INCOME_CATEGORIES = [
  "rental",
  "additional_fee",
  "excess_mileage",
  "extra_service",
  "fine_recharge",
  "damage_recovery",
  "other_income",
  "vehicle_sale",
  "loan_received",
  "owner_contribution",
] as const;
export const EXPENSE_CATEGORIES = [
  "maintenance",
  "repairs",
  "tyres",
  "cleaning",
  "fuel",
  "insurance",
  "itv",
  "tax",
  "documentation",
  "fines",
  "commission",
  "other_expense",
  "vehicle_purchase",
  "loan_repayment",
  "owner_withdrawal",
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type FinanceCategory = IncomeCategory | ExpenseCategory;

/** Fora do resultado operacional (investimento, venda de ativo, financiamento, sócios) — espelha app.is_operational_category. */
export const NON_OPERATIONAL = ["vehicle_purchase", "vehicle_sale", "loan_received", "owner_contribution", "loan_repayment", "owner_withdrawal"] as const;
export function isOperational(c: string): boolean {
  return !(NON_OPERATIONAL as readonly string[]).includes(c);
}

/** Categorias geradas automaticamente pelo sistema (não podem ser lançadas à mão). */
export const AUTO_ONLY: readonly string[] = ["rental", "additional_fee", "excess_mileage", "vehicle_purchase", "vehicle_sale"];
export const MANUAL_INCOME = INCOME_CATEGORIES.filter((c) => !AUTO_ONLY.includes(c));
export const MANUAL_EXPENSE = EXPENSE_CATEGORIES.filter((c) => !AUTO_ONLY.includes(c));

export const ENTRY_STATUSES = ["pending", "paid", "cancelled"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const ENTRY_STATUS_VARIANT: Record<EntryStatus, "warning" | "success" | "neutral"> = { pending: "warning", paid: "success", cancelled: "neutral" };

/** Mesma data em meses seguintes (dia ajustado ao fim do mês: 31/01 → 28/02). */
export function addMonthsKeepDay(iso: string, months: number): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Divide um valor em N parcelas em centavos; a diferença de arredondamento vai para a última. */
export function splitInstallments(amount: string, n: number): string[] {
  const cents = Math.round(Number(amount) * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => {
    const c = i === n - 1 ? cents - base * (n - 1) : base;
    return (c / 100).toFixed(2);
  });
}

/** Indicadores de rentabilidade de um veículo. */
export function vehicleReturns(r: { purchase_price: number | null; current_value: number | null; profit: number; months_in_fleet: number }) {
  const invested = r.purchase_price ?? 0;
  const value = r.current_value ?? invested;
  const depreciation = invested - value;
  const monthly = r.months_in_fleet > 0 ? r.profit / r.months_in_fleet : 0;
  const roi = invested > 0 ? (r.profit / invested) * 100 : null;
  const totalReturn = invested > 0 ? ((r.profit + value - invested) / invested) * 100 : null;
  // meses restantes para o lucro operacional recuperar o investimento (descontado o valor atual)
  const toRecover = invested - value - r.profit;
  const paybackMonths = invested <= 0 ? null : toRecover <= 0 ? 0 : monthly > 0 ? Math.ceil(toRecover / monthly) : null;
  return {
    invested,
    value,
    depreciation: Math.round(depreciation * 100) / 100,
    monthlyProfit: Math.round(monthly * 100) / 100,
    roi: roi === null ? null : Math.round(roi * 10) / 10,
    totalReturn: totalReturn === null ? null : Math.round(totalReturn * 10) / 10,
    paybackMonths,
  };
}
