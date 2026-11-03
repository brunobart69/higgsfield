import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { MANUAL_EXPENSE, MANUAL_INCOME } from "@/lib/finance/constants";
import { optionalDate, optionalInt, optionalPercent, optionalText, requiredMoney } from "./common";

const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const optId = z.preprocess(blankToNull, z.guid().nullable());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate");

/** Lançamento manual (receita ou despesa), opcionalmente em parcelas mensais. */
export const entrySchema = z
  .object({
    id: optId,
    type: z.enum(["income", "expense"]),
    category: z.string(),
    description: z.string().trim().min(2, "required").max(300, "tooLong"),
    amount: requiredMoney(),
    vat_rate: optionalPercent,
    competence_date: date,
    due_date: optionalDate,
    status: z.enum(["pending", "paid"]),
    paid_at: optionalDate,
    payment_method: z.preprocess(blankToNull, z.enum(PAYMENT_METHODS).nullable()),
    vehicle_id: optId,
    reference: optionalText(120),
    notes: optionalText(2000),
    installments: optionalInt(1, 120),
  })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = v.type === "income" ? MANUAL_INCOME : MANUAL_EXPENSE;
    if (!allowed.includes(v.category)) ctx.addIssue({ code: "custom", message: "invalid", path: ["category"] });
    if (v.status === "paid" && !v.paid_at) ctx.addIssue({ code: "custom", message: "required", path: ["paid_at"] });
    if ((v.installments ?? 1) > 1 && v.status === "paid") ctx.addIssue({ code: "custom", message: "installmentsPending", path: ["installments"] });
    if ((v.installments ?? 1) > 1 && v.id) ctx.addIssue({ code: "custom", message: "invalid", path: ["installments"] });
  });

export const payEntrySchema = z.object({
  id: z.guid("invalid"),
  paid_at: date,
  payment_method: z.preprocess(blankToNull, z.enum(PAYMENT_METHODS).nullable()),
});

export const openingBalanceSchema = z.object({
  cash_opening_balance: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = v.replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
      if (!/^-?\d+(\.\d{1,2})?$/.test(n)) {
        ctx.addIssue({ code: "custom", message: "invalidAmount" });
        return z.NEVER;
      }
      return n;
    }),
  cash_opening_date: date,
});

export const vehicleSaleSchema = z.object({
  vehicle_id: z.guid("invalid"),
  sold_at: date,
  sale_price: requiredMoney(),
  sale_notes: optionalText(1000),
});
