import { z } from "zod";
import { CUSTOMER_DOC_TYPES, ID_DOCUMENT_TYPES } from "@/lib/customers/constants";
import {
  checkbox,
  optionalDate,
  optionalEmail,
  optionalPhone,
  optionalSpanishTaxId,
  optionalText,
  spanishIdChecksumOk,
} from "./common";

const country = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const c = v.toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) {
      ctx.addIssue({ code: "custom", message: "invalidCountry" });
      return z.NEVER;
    }
    return c;
  });

const base = {
  address: optionalText(300),
  city: optionalText(120),
  postal_code: optionalText(12),
  country: country,
  phone: optionalPhone,
  email: optionalEmail,
  notes: optionalText(4000),
  gdpr_informed: checkbox,
  marketing_consent: checkbox,
};

export const individualSchema = z
  .object({
    customer_type: z.literal("individual"),
    full_name: z.string().trim().min(2, "required").max(160, "tooLong"),
    birth_date: optionalDate,
    nationality: country,
    id_document_type: z.preprocess((v) => (v === "" ? null : v), z.enum(ID_DOCUMENT_TYPES).nullable().optional()),
    id_document_number: optionalText(30),
    driving_licence_number: optionalText(30),
    driving_licence_expiry: optionalDate,
    ...base,
  })
  .superRefine((v, ctx) => {
    if (v.id_document_number && !v.id_document_type) {
      ctx.addIssue({ code: "custom", message: "required", path: ["id_document_type"] });
    }
    if (v.id_document_number && (v.id_document_type === "dni" || v.id_document_type === "nie")) {
      if (!spanishIdChecksumOk(v.id_document_number)) {
        ctx.addIssue({ code: "custom", message: "invalidDni", path: ["id_document_number"] });
      }
    }
    if (v.birth_date) {
      const today = new Date().toISOString().slice(0, 10);
      if (v.birth_date >= today || v.birth_date < "1900-01-01") {
        ctx.addIssue({ code: "custom", message: "invalidDate", path: ["birth_date"] });
      }
    }
    if (!v.gdpr_informed) ctx.addIssue({ code: "custom", message: "gdprRequired", path: ["gdpr_informed"] });
  });

export const companySchema = z
  .object({
    customer_type: z.literal("company"),
    company_name: z.string().trim().min(2, "required").max(200, "tooLong"),
    legal_name: optionalText(200),
    tax_id: optionalSpanishTaxId,
    representative_name: optionalText(160),
    billing_email: optionalEmail,
    billing_address: optionalText(300),
    billing_notes: optionalText(1000),
    ...base,
  })
  .superRefine((v, ctx) => {
    if (!v.gdpr_informed) ctx.addIssue({ code: "custom", message: "gdprRequired", path: ["gdpr_informed"] });
  });

export const customerSchema = z.discriminatedUnion("customer_type", [individualSchema, companySchema]);
export type CustomerInput = z.infer<typeof customerSchema>;

/** Converte o formulário validado nas colunas da tabela customers. */
export function toCustomerRow(input: CustomerInput, alreadyConsentedAt: string | null) {
  const common = {
    customer_type: input.customer_type,
    address: input.address,
    city: input.city,
    postal_code: input.postal_code,
    country: input.country ?? "ES",
    phone: input.phone,
    email: input.email,
    notes: input.notes,
    marketing_consent: input.marketing_consent,
    gdpr_consent_at: alreadyConsentedAt ?? new Date().toISOString(),
  };
  if (input.customer_type === "individual") {
    return {
      ...common,
      full_name: input.full_name,
      birth_date: input.birth_date,
      nationality: input.nationality,
      id_document_type: input.id_document_number ? (input.id_document_type ?? null) : null,
      id_document_number: input.id_document_number,
      driving_licence_number: input.driving_licence_number,
      driving_licence_expiry: input.driving_licence_expiry,
      company_name: null,
      legal_name: null,
      tax_id: null,
      representative_name: null,
      billing_details: {},
    };
  }
  return {
    ...common,
    company_name: input.company_name,
    legal_name: input.legal_name,
    tax_id: input.tax_id,
    representative_name: input.representative_name,
    billing_details: {
      ...(input.billing_email ? { email: input.billing_email } : {}),
      ...(input.billing_address ? { address: input.billing_address } : {}),
      ...(input.billing_notes ? { notes: input.billing_notes } : {}),
    },
    full_name: null,
    birth_date: null,
    nationality: null,
    id_document_type: null,
    id_document_number: null,
    driving_licence_number: null,
    driving_licence_expiry: null,
  };
}

export const customerDocumentSchema = z.object({
  customer_id: z.guid("invalid"),
  path: z.string().min(10).max(300),
  doc_type: z.enum(CUSTOMER_DOC_TYPES),
  title: z.string().trim().min(1, "required").max(200, "tooLong"),
  mime_type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  size_bytes: z.number().int().positive(),
  expires_at: optionalDate,
});
