import { z } from "zod";
import { CONDITIONS, DAMAGE_CATEGORIES, DAMAGE_SEVERITIES, DAMAGE_STATUSES, INSPECTION_AREAS, INSPECTION_TYPES } from "@/lib/inspections/constants";
import { checkbox, optionalDate, optionalInt, optionalMoney, optionalText } from "./common";

const id = z.guid("invalid");
const blankToNull = (v: unknown) => (v === "" ? null : v);

export const checklistSchema = z.partialRecord(
  z.enum(INSPECTION_AREAS),
  z.object({ condition: z.enum(CONDITIONS), notes: z.string().trim().max(500).optional() }),
);

export const createInspectionSchema = z.object({
  vehicle_id: id,
  rental_id: z.preprocess(blankToNull, id.nullable()),
  inspection_type: z.enum(INSPECTION_TYPES),
});

export const inspectionDraftSchema = z.object({
  id,
  mileage: optionalInt(0, 9_999_999),
  fuel_level: optionalInt(0, 100),
  checklist: z
    .string()
    .transform((v, ctx) => {
      try {
        return checklistSchema.parse(JSON.parse(v || "{}"));
      } catch {
        ctx.addIssue({ code: "custom", message: "invalid" });
        return z.NEVER;
      }
    }),
  existing_damages_confirmed: checkbox,
  customer_present: checkbox,
  customer_name: optionalText(160),
  observations: optionalText(4000),
  complete: z.enum(["0", "1"]).default("0"),
}).superRefine((v, ctx) => {
  if (v.complete === "1") {
    if (v.mileage === null) ctx.addIssue({ code: "custom", message: "required", path: ["mileage"] });
    if (v.fuel_level === null) ctx.addIssue({ code: "custom", message: "invalidFuel", path: ["fuel_level"] });
  }
});

export const inspectionPhotoSchema = z.object({
  inspection_id: id,
  path: z.string().min(10).max(300),
  area: z.union([z.enum(INSPECTION_AREAS), z.literal("general")]),
  size_bytes: z.number().int().positive(),
});

export const damageSchema = z.object({
  id: z.preprocess(blankToNull, id.nullable()),
  vehicle_id: id,
  rental_id: z.preprocess(blankToNull, id.nullable()),
  inspection_id: z.preprocess(blankToNull, id.nullable()),
  accident_id: z.preprocess((v) => (v === "" || v === undefined ? null : v), id.nullable()),
  detected_at: optionalDate.transform((v) => v ?? undefined),
  mileage: optionalInt(0, 9_999_999),
  area: z.preprocess(blankToNull, z.enum(INSPECTION_AREAS).nullable()),
  category: z.enum(DAMAGE_CATEGORIES),
  severity: z.enum(DAMAGE_SEVERITIES),
  description: z.string().trim().min(3, "required").max(2000, "tooLong"),
  estimated_cost: optionalMoney(),
  actual_cost: optionalMoney(),
  status: z.enum(DAMAGE_STATUSES),
  repair_shop: optionalText(160),
  notes: optionalText(4000),
});

export const damagePhotoSchema = z.object({
  damage_id: id,
  path: z.string().min(10).max(300),
  size_bytes: z.number().int().positive(),
});
