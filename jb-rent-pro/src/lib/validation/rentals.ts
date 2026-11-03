import { z } from "zod";
import { MILEAGE_POLICIES, PAYMENT_METHODS, PRICING_MODES } from "@/lib/rentals/constants";
import { madridLocalToIso } from "@/lib/rentals/datetime";
import { optionalInt, optionalMoney, optionalText, requiredMoney } from "./common";

const id = z.guid("invalid");

const fuel = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = Number(v);
    if (v === "" || !Number.isInteger(n) || n < 0 || n > 100) {
      ctx.addIssue({ code: "custom", message: "invalidFuel" });
      return z.NEVER;
    }
    return n;
  });

const mileage = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = Number(v.replace(/[.\s]/g, ""));
    if (v === "" || !Number.isInteger(n) || n < 0 || n > 9_999_999) {
      ctx.addIssue({ code: "custom", message: "invalidNumber" });
      return z.NEVER;
    }
    return n;
  });

/** Extras enviados como JSON pelo formulário. */
const extrasJson = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return [];
    try {
      const arr = z
        .array(
          z.object({
            fee_id: z.guid().nullable().optional(),
            name: z.string().trim().min(1).max(120),
            amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
            charge_type: z.enum(["per_rental", "per_day"]),
            quantity: z.number().int().min(1).max(99),
          }),
        )
        .max(30)
        .parse(JSON.parse(v));
      return arr;
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid" });
      return z.NEVER;
    }
  });

export const rentalSchema = z
  .object({
    customer_id: id,
    vehicle_id: id,
    status: z.enum(["reservation", "confirmed"]).default("confirmed"),
    pickup_date: z.string().min(1, "required"),
    pickup_time: z.string().min(1, "required"),
    return_date: z.string().min(1, "required"),
    return_time: z.string().min(1, "required"),
    pricing_mode: z.enum(PRICING_MODES),
    unit_price: requiredMoney(999_999.99),
    discount_amount: optionalMoney().transform((v) => v ?? "0.00"),
    extra_fees_amount: optionalMoney().transform((v) => v ?? "0.00"),
    deposit_amount: optionalMoney().transform((v) => v ?? "0.00"),
    payment_method: z.preprocess((v) => (v === "" ? null : v), z.enum(PAYMENT_METHODS).nullable()),
    mileage_policy: z.enum(MILEAGE_POLICIES),
    mileage_limit_km: optionalInt(1, 1_000_000),
    excess_km_price: optionalMoney(999),
    contract_locale: z.enum(["pt-BR", "es-ES"]),
    pickup_location: optionalText(200),
    return_location: optionalText(200),
    notes: optionalText(4000),
    extras: extrasJson,
  })
  .superRefine((v, ctx) => {
    const p = madridLocalToIso(v.pickup_date, v.pickup_time);
    const r = madridLocalToIso(v.return_date, v.return_time);
    if (!p) ctx.addIssue({ code: "custom", message: "invalidDate", path: ["pickup_date"] });
    if (!r) ctx.addIssue({ code: "custom", message: "invalidDate", path: ["return_date"] });
    if (p && r && r <= p) ctx.addIssue({ code: "custom", message: "returnBeforePickup", path: ["return_date"] });
    if (v.mileage_policy !== "unlimited" && v.mileage_limit_km === null) {
      ctx.addIssue({ code: "custom", message: "mileageLimitRequired", path: ["mileage_limit_km"] });
    }
  })
  .transform(({ pickup_date, pickup_time, return_date, return_time, ...rest }) => ({
    ...rest,
    pickup_at: madridLocalToIso(pickup_date, pickup_time)!,
    return_at: madridLocalToIso(return_date, return_time)!,
    mileage_limit_km: rest.mileage_policy === "unlimited" ? null : rest.mileage_limit_km,
  }));

export type RentalInput = z.infer<typeof rentalSchema>;

export const pickupSchema = z.object({
  rental_id: id,
  start_mileage: mileage,
  start_fuel_level: fuel,
  notes: optionalText(2000),
});

export const returnSchema = z
  .object({
    rental_id: id,
    end_mileage: mileage,
    end_fuel_level: fuel,
    return_date: z.string().min(1, "required"),
    return_time: z.string().min(1, "required"),
    late_fee: optionalMoney().transform((v) => v ?? "0.00"),
    return_notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (!madridLocalToIso(v.return_date, v.return_time)) ctx.addIssue({ code: "custom", message: "invalidDate", path: ["return_date"] });
  })
  .transform(({ return_date, return_time, ...rest }) => ({ ...rest, actual_return_at: madridLocalToIso(return_date, return_time)! }));

export const cancelSchema = z.object({ rental_id: id, cancelled_reason: z.string().trim().min(3, "required").max(500, "tooLong") });

export const paymentSchema = z.object({
  rental_id: id,
  kind: z.enum(["payment", "refund"]),
  amount: requiredMoney(999_999.99).refine((v) => Number(v) > 0, "invalidAmount"),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(120),
});

export const voidPaymentSchema = z.object({ payment_id: id, void_reason: z.string().trim().min(3, "required").max(300, "tooLong") });

export const depositReceiveSchema = z.object({
  rental_id: id,
  amount_received: requiredMoney(999_999.99).refine((v) => Number(v) > 0, "invalidAmount"),
  received_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
  received_method: z.enum(PAYMENT_METHODS),
});

export const depositSettleSchema = z
  .object({
    rental_id: id,
    amount_returned: optionalMoney().transform((v) => v ?? "0.00"),
    amount_retained: optionalMoney().transform((v) => v ?? "0.00"),
    returned_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
    returned_method: z.preprocess((v) => (v === "" ? null : v), z.enum(PAYMENT_METHODS).nullable()),
    retention_reason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (Number(v.amount_retained) > 0 && !v.retention_reason) {
      ctx.addIssue({ code: "custom", message: "retentionReasonRequired", path: ["retention_reason"] });
    }
    if (Number(v.amount_returned) + Number(v.amount_retained) === 0) {
      ctx.addIssue({ code: "custom", message: "invalidAmount", path: ["amount_returned"] });
    }
  });

