import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/rentals/constants";
import { MAINTENANCE_TYPES } from "@/lib/maintenance/constants";
import { checkbox, optionalDate, optionalInt, optionalMoney, optionalText } from "./common";

const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const id = z.guid("required");
const optId = z.preprocess(blankToNull, z.guid().nullable());

/** Ordem de manutenção (criação/edição). A mudança de situação usa os esquemas abaixo. */
export const maintenanceSchema = z
  .object({
    id: optId,
    vehicle_id: id,
    plan_id: optId,
    damage_id: optId,
    maintenance_type: z.enum(MAINTENANCE_TYPES),
    title: z.string().trim().min(2, "required").max(160, "tooLong"),
    description: optionalText(4000),
    scheduled_date: optionalDate,
    workshop: optionalText(160),
    cost: optionalMoney(),
    blocks_vehicle: checkbox,
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (!v.id && !v.scheduled_date) ctx.addIssue({ code: "custom", message: "required", path: ["scheduled_date"] });
  });

export const completeMaintenanceSchema = z
  .object({
    id,
    completed_date: optionalDate,
    mileage: optionalInt(0, 9_999_999),
    workshop: optionalText(160),
    cost: optionalMoney(),
    invoice_number: optionalText(60),
    paid_at: optionalDate,
    payment_method: z.preprocess(blankToNull, z.enum(PAYMENT_METHODS).nullable()),
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (!v.completed_date) ctx.addIssue({ code: "custom", message: "required", path: ["completed_date"] });
    if (v.paid_at && !v.cost) ctx.addIssue({ code: "custom", message: "required", path: ["cost"] });
  });

/** Pagamento/fatura de uma manutenção já concluída. */
export const maintenancePaymentSchema = completeMaintenanceSchema;

export const planSchema = z
  .object({
    id: optId,
    vehicle_id: id,
    name: z.string().trim().min(2, "required").max(120, "tooLong"),
    maintenance_type: z.enum(MAINTENANCE_TYPES),
    interval_km: optionalInt(100, 500_000),
    interval_months: optionalInt(1, 120),
    last_done_date: optionalDate,
    last_done_mileage: optionalInt(0, 9_999_999),
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (!v.interval_km && !v.interval_months) ctx.addIssue({ code: "custom", message: "intervalRequired", path: ["interval_km"] });
    if (v.interval_months && !v.last_done_date) ctx.addIssue({ code: "custom", message: "required", path: ["last_done_date"] });
    if (v.interval_km && v.last_done_mileage === null) ctx.addIssue({ code: "custom", message: "required", path: ["last_done_mileage"] });
  });
