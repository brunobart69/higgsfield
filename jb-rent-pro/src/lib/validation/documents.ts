import { z } from "zod";
import { optionalDate, optionalText } from "./common";

export const DOCUMENT_CATEGORIES = [
  "insurance_policy",
  "contract",
  "vehicle_document",
  "technical_sheet",
  "circulation_permit",
  "itv",
  "invoice",
  "receipt",
  "inspection",
  "maintenance_invoice",
  "fine_notice",
  "accident_report",
  "other",
] as const;

const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

/** Documento da central (empresa, veículo, contrato ou apólice). */
export const documentSchema = z.object({
  path: z.string().min(10).max(300),
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().min(1, "required").max(200, "tooLong"),
  mime_type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  size_bytes: z.number().int().positive(),
  vehicle_id: z.preprocess(blankToNull, z.guid().nullable()),
  rental_id: z.preprocess(blankToNull, z.guid().nullable()),
  insurance_policy_id: z.preprocess(blankToNull, z.guid().nullable()),
  maintenance_id: z.preprocess(blankToNull, z.guid().nullable()),
  fine_id: z.preprocess(blankToNull, z.guid().nullable()),
  accident_id: z.preprocess(blankToNull, z.guid().nullable()),
  issued_at: optionalDate,
  expires_at: optionalDate,
  notes: optionalText(2000),
});
