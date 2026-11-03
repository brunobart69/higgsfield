import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { madridLocalToIso } from "@/lib/rentals/datetime";
import { ACCIDENT_FAULTS, ACCIDENT_STATUSES, FINE_STATUSES } from "@/lib/fines/constants";
import { checkbox, optionalDate, optionalInt, optionalMoney, optionalText, requiredMoney } from "./common";

const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const optId = z.preprocess(blankToNull, z.guid().nullable());
const date = z.string().min(1, "required");
const time = z.string().regex(/^\d{2}:\d{2}$/, "invalidDate");

export const fineSchema = z
  .object({
    id: optId,
    vehicle_id: z.guid("required"),
    rental_id: optId,
    customer_id: optId,
    infraction_date: date,
    infraction_time: time,
    authority: z.string().trim().min(2, "required").max(160, "tooLong"),
    reference: optionalText(80),
    infraction: z.string().trim().min(3, "required").max(1000, "tooLong"),
    location: optionalText(200),
    points: optionalInt(0, 15),
    amount: requiredMoney(),
    notified_at: optionalDate,
    identification_deadline: optionalDate,
    payment_deadline: optionalDate,
    status: z.enum(FINE_STATUSES),
    identified_at: optionalDate,
    paid_at: optionalDate,
    paid_amount: optionalMoney(),
    payment_method: z.preprocess(blankToNull, z.enum(PAYMENT_METHODS).nullable()),
    recharge_amount: optionalMoney(),
    recharge_paid_at: optionalDate,
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (!madridLocalToIso(v.infraction_date, v.infraction_time)) ctx.addIssue({ code: "custom", message: "invalidDate", path: ["infraction_date"] });
    if (v.status === "paid" && !v.paid_at) ctx.addIssue({ code: "custom", message: "required", path: ["paid_at"] });
    if (v.paid_at && v.status !== "paid") ctx.addIssue({ code: "custom", message: "paidStatusRequired", path: ["paid_at"] });
    if (v.recharge_paid_at && !v.recharge_amount) ctx.addIssue({ code: "custom", message: "required", path: ["recharge_amount"] });
  })
  .transform(({ infraction_date, infraction_time, ...rest }) => ({ ...rest, infraction_at: madridLocalToIso(infraction_date, infraction_time)! }));

export const accidentSchema = z
  .object({
    id: optId,
    vehicle_id: z.guid("required"),
    rental_id: optId,
    customer_id: optId,
    insurance_policy_id: optId,
    occurred_date: date,
    occurred_time: time,
    location: optionalText(200),
    description: z.string().trim().min(3, "required").max(4000, "tooLong"),
    status: z.enum(ACCIDENT_STATUSES),
    fault: z.enum(ACCIDENT_FAULTS),
    injuries: checkbox,
    third_party: checkbox,
    third_party_details: optionalText(2000),
    police_report: checkbox,
    police_report_number: optionalText(80),
    amicable_report: checkbox,
    insurer_claim_number: optionalText(80),
    reported_to_insurer_at: optionalDate,
    estimated_cost: optionalMoney(),
    deductible_amount: optionalMoney(),
    deductible_paid_at: optionalDate,
    insurer_payout: optionalMoney(),
    insurer_payout_at: optionalDate,
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (!madridLocalToIso(v.occurred_date, v.occurred_time)) ctx.addIssue({ code: "custom", message: "invalidDate", path: ["occurred_date"] });
    if (v.deductible_paid_at && !v.deductible_amount) ctx.addIssue({ code: "custom", message: "required", path: ["deductible_amount"] });
    if (v.insurer_payout_at && !v.insurer_payout) ctx.addIssue({ code: "custom", message: "required", path: ["insurer_payout"] });
  })
  .transform(({ occurred_date, occurred_time, ...rest }) => ({ ...rest, occurred_at: madridLocalToIso(occurred_date, occurred_time)! }));

export const accidentPhotoSchema = z.object({
  accident_id: z.guid("invalid"),
  path: z.string().min(10).max(300),
  size_bytes: z.number().int().positive(),
});
