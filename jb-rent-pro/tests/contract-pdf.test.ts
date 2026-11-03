import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { buildContractPdf, pdfSafe } from "@/lib/contracts/pdf";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { RentalDetail } from "@/lib/rentals/queries";
import type { CompanySettings } from "@/lib/settings/queries";

export const sampleRental = {
  id: "r1",
  contract_number: "JB-2026-00015",
  status: "confirmed",
  customer_id: "c1",
  vehicle_id: "v1",
  pickup_at: "2026-11-10T09:00:00Z",
  return_at: "2026-11-13T09:00:00Z",
  actual_return_at: null,
  picked_up_at: null,
  pricing_mode: "daily",
  unit_price: 35,
  rental_days: 3,
  base_amount: 105,
  extras_amount: 49.5,
  extra_fees_amount: 0,
  discount_amount: 5,
  excess_km: 0,
  excess_mileage_amount: 0,
  total_amount: 149.5,
  deposit_amount: 300,
  payment_method: "card",
  mileage_policy: "daily",
  mileage_limit_km: 200,
  allowed_km: 600,
  excess_km_price: 0.25,
  start_mileage: null,
  end_mileage: null,
  start_fuel_level: null,
  end_fuel_level: null,
  contract_locale: "es-ES",
  signature_status: "unsigned",
  pickup_location: "Aeropuerto Madrid-Barajas T4",
  return_location: "Oficina Calle de Alcalá, 100",
  notes: "Cliente solicita silla infantil instalada.",
  return_notes: null,
  cancelled_reason: null,
  created_at: "2026-11-01T10:00:00Z",
  customer: {
    id: "c1", customer_type: "individual", full_name: "María García Núñez", company_name: null, legal_name: null,
    id_document_type: "dni", id_document_number: "12345678Z", tax_id: null, driving_licence_number: "12345678Z",
    driving_licence_expiry: "2031-06-30", address: "Calle Mayor, 15, 3º B", postal_code: "28013", city: "Madrid",
    country: "ES", phone: "+34 611 22 33 44", email: "maria@example.es", representative_name: null,
  },
  vehicle: { id: "v1", brand: "Seat", model: "Ibiza", version: "1.0 TSI FR", plate: "5678 MNB", vin: "VSSZZZKJZPR012345", color: "Rojo", current_mileage: 31200, daily_price: 35, year: 2023 },
  extras: [
    { id: "e1", fee_id: null, name: "Conductor adicional", amount: 6.5, charge_type: "per_day", quantity: 1 },
    { id: "e2", fee_id: null, name: "Entrega en aeropuerto", amount: 30, charge_type: "per_rental", quantity: 1 },
  ],
  payments: [],
  deposit: null,
  paid: 0,
  balance: 149.5,
} as unknown as RentalDetail;

export const sampleCompany = {
  id: "co", name: "JB RENT", legal_name: "JB Rent S.L.", tax_id: "B12345678", address: "Calle de Alcalá, 100", city: "Madrid",
  postal_code: "28009", province: "Madrid", phone: "+34 910 000 000", email: "info@jbrent.es", website: null, logo_path: null,
  default_locale: "es-ES", currency: "EUR", timezone: "Europe/Madrid", vat_rate: 21, prices_include_vat: true, iban: null,
  fiscal_notes: null, document_retention_years: 6, default_daily_price: 45, default_weekly_price: null, default_monthly_price: null,
  default_deposit_amount: 300, default_mileage_policy: "daily", default_mileage_limit_km: 200, default_excess_km_price: 0.25,
  rental_conditions_pt: "1. O locatário declara ter mais de 21 anos.\n2. É proibido fumar no veículo.",
  rental_conditions_es: "1. El arrendatario declara ser mayor de 21 años.\n2. Está prohibido fumar en el vehículo.\n3. El vehículo no puede salir de España sin autorización escrita.",
  contract_footer: "JB Rent S.L. · CIF B12345678 · Inscrita en el Registro Mercantil de Madrid",
} as unknown as CompanySettings;

describe("contrato em PDF", () => {
  it("remove caracteres fora da codificação do PDF", () => {
    expect(pdfSafe("10:00 → 12:00")).toBe("10:00 -> 12:00");
    expect(pdfSafe("1.234,50 €")).toBe("1.234,50 €");
    expect(pdfSafe("Peña · Ação · 3º")).toBe("Peña · Ação · 3º");
    expect(pdfSafe("emoji 🚗 ok")).toBe("emoji  ok");
  });

  for (const locale of ["es-ES", "pt-BR"] as const) {
    it(`gera um PDF válido em ${locale}`, async () => {
      const bytes = await buildContractPdf({ rental: sampleRental, company: sampleCompany, logo: null, t: getDictionary(locale), locale });
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      expect(doc.getTitle()).toContain("JB-2026-00015");
      if (process.env.CONTRACT_PDF_OUT) writeFileSync(`${process.env.CONTRACT_PDF_OUT}/contrato-${locale}.pdf`, bytes);
    });
  }

  it("contrato longo quebra em várias páginas sem erro", async () => {
    const long = { ...sampleCompany, rental_conditions_es: Array.from({ length: 80 }, (_, i) => `${i + 1}. Cláusula de ejemplo con texto suficiente para ocupar una línea completa del documento.`).join("\n") };
    const bytes = await buildContractPdf({ rental: sampleRental, company: long, logo: null, t: getDictionary("es-ES"), locale: "es-ES" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
