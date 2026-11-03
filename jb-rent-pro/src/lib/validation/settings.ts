import { z } from "zod";
import {
  optionalEmail,
  optionalIban,
  optionalInt,
  optionalMoney,
  optionalPercent,
  optionalPhone,
  optionalSpanishTaxId,
  optionalText,
  requiredMoney,
} from "./common";

export const companySchema = z.object({
  name: z.string().trim().min(1, "required").max(200, "tooLong"),
  legal_name: optionalText(200),
  tax_id: optionalSpanishTaxId,
  address: optionalText(300),
  city: optionalText(120),
  postal_code: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!/^\d{5}$/.test(v)) {
        ctx.addIssue({ code: "custom", message: "invalidPostalCode" });
        return z.NEVER;
      }
      return v;
    }),
  province: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalText(200),
});

export const fiscalSchema = z.object({
  vat_rate: optionalPercent,
  prices_include_vat: z.enum(["true", "false"]).transform((v) => v === "true"),
  iban: optionalIban,
  fiscal_notes: optionalText(4000),
  document_retention_years: optionalInt(1, 30),
});

import { MILEAGE_POLICIES } from "@/lib/settings/constants";

export { MILEAGE_POLICIES };

export const defaultsSchema = z
  .object({
    default_locale: z.enum(["pt-BR", "es-ES"]),
    default_daily_price: optionalMoney(),
    default_weekly_price: optionalMoney(),
    default_monthly_price: optionalMoney(),
    default_deposit_amount: optionalMoney(),
    default_mileage_policy: z.enum(MILEAGE_POLICIES),
    default_mileage_limit_km: optionalInt(1, 1_000_000),
    default_excess_km_price: optionalMoney(999),
  })
  .superRefine((v, ctx) => {
    if (v.default_mileage_policy !== "unlimited" && v.default_mileage_limit_km === null) {
      ctx.addIssue({ code: "custom", message: "mileageLimitRequired", path: ["default_mileage_limit_km"] });
    }
  })
  .transform((v) =>
    v.default_mileage_policy === "unlimited" ? { ...v, default_mileage_limit_km: null } : v,
  );

export const contractSchema = z.object({
  rental_conditions_pt: optionalText(20000),
  rental_conditions_es: optionalText(20000),
  contract_footer: optionalText(2000),
});

export const feeSchema = z.object({
  id: z.guid().optional().or(z.literal("").transform(() => undefined)),
  name_pt: z.string().trim().min(1, "required").max(120, "tooLong"),
  name_es: z.string().trim().min(1, "required").max(120, "tooLong"),
  amount: requiredMoney(99_999.99),
  charge_type: z.enum(["per_rental", "per_day"]),
  vat_rate: optionalPercent,
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;
