import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { checkbox, optionalDate, optionalMoney, optionalPhone, optionalText } from "./common";

const blankToNull = (v: unknown) => (v === "" ? null : v);

export const insuranceSchema = z
  .object({
    id: z.preprocess(blankToNull, z.guid().nullable()),
    vehicle_id: z.guid("required"),
    renewed_from_id: z.preprocess(blankToNull, z.guid().nullable()),
    insurer: z.string().trim().min(2, "required").max(120, "tooLong"),
    policy_number: z.string().trim().min(2, "required").max(60, "tooLong"),
    coverage_type: optionalText(160),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
    premium_amount: optionalMoney(),
    deductible_amount: optionalMoney(),
    roadside_assistance: checkbox,
    assistance_phone: optionalPhone,
    paid_at: optionalDate,
    payment_method: z.preprocess(blankToNull, z.enum(PAYMENT_METHODS).nullable()),
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (v.end_date < v.start_date) ctx.addIssue({ code: "custom", message: "endBeforeStart", path: ["end_date"] });
    if (v.paid_at && !v.premium_amount) ctx.addIssue({ code: "custom", message: "required", path: ["premium_amount"] });
  });

export type InsuranceInput = z.infer<typeof insuranceSchema>;
