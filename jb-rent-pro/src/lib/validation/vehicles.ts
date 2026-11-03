import { z } from "zod";
import { FUEL_TYPES, PHOTO_KINDS, TRANSMISSIONS, VEHICLE_DOC_CATEGORIES, VEHICLE_STATUSES, VEHICLE_TYPES } from "@/lib/vehicles/constants";
import { optionalDate, optionalInt, optionalMoney, optionalText } from "./common";

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!(values as readonly string[]).includes(v)) {
        ctx.addIssue({ code: "custom", message: "invalid" });
        return z.NEVER;
      }
      return v as T[number];
    });

export const vehicleSchema = z
  .object({
    brand: z.string().trim().min(1, "required").max(60, "tooLong"),
    model: z.string().trim().min(1, "required").max(60, "tooLong"),
    version: optionalText(80),
    year: optionalInt(1950, new Date().getFullYear() + 1),
    plate: z
      .string()
      .trim()
      .min(1, "required")
      .max(15, "tooLong")
      .transform((v) => v.toUpperCase().replace(/\s+/g, " "))
      .refine((v) => /^[A-Z0-9 -]{4,15}$/.test(v), "invalidPlate"),
    vin: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = v.toUpperCase().replace(/\s/g, "");
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(n)) {
          ctx.addIssue({ code: "custom", message: "invalidVin" });
          return z.NEVER;
        }
        return n;
      }),
    color: optionalText(40),
    vehicle_type: optionalEnum(VEHICLE_TYPES),
    fuel: optionalEnum(FUEL_TYPES),
    transmission: optionalEnum(TRANSMISSIONS),
    doors: optionalInt(1, 9),
    seats: optionalInt(1, 60),
    current_mileage: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return 0;
        const n = v.replace(/[.\s]/g, "");
        if (!/^\d{1,7}$/.test(n)) {
          ctx.addIssue({ code: "custom", message: "invalidNumber" });
          return z.NEVER;
        }
        return Number(n);
      }),
    acquisition_date: optionalDate,
    purchase_price: optionalMoney(),
    market_value: optionalMoney(),
    fleet_entry_date: optionalDate,
    category: optionalText(60),
    daily_price: optionalMoney(99_999.99),
    weekly_price: optionalMoney(99_999.99),
    monthly_price: optionalMoney(99_999.99),
    itv_due_date: optionalDate,
    status: z.enum(VEHICLE_STATUSES).default("available"),
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (v.acquisition_date && v.fleet_entry_date && v.fleet_entry_date < v.acquisition_date) {
      ctx.addIssue({ code: "custom", message: "entryBeforeAcquisition", path: ["fleet_entry_date"] });
    }
  });

export type VehicleInput = z.infer<typeof vehicleSchema>;

export const vehicleStatusSchema = z.object({ id: z.guid("invalid"), status: z.enum(VEHICLE_STATUSES) });

export const photoRegisterSchema = z.object({
  vehicle_id: z.guid("invalid"),
  path: z.string().min(10).max(300),
  kind: z.enum(PHOTO_KINDS),
  mime_type: z.enum(["image/jpeg", "image/png"]),
  size_bytes: z.number().int().positive(),
  caption: z.string().trim().max(200).optional().nullable(),
});

export const vehicleDocumentSchema = z.object({
  vehicle_id: z.guid("invalid"),
  path: z.string().min(10).max(300),
  category: z.enum(VEHICLE_DOC_CATEGORIES),
  title: z.string().trim().min(1, "required").max(200, "tooLong"),
  mime_type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  size_bytes: z.number().int().positive(),
  issued_at: optionalDate,
  expires_at: optionalDate,
});
