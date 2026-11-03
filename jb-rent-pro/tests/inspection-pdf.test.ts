import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { buildComparisonPdf, buildInspectionPdf, type PdfInspection } from "@/lib/contracts/inspection-pdf";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { sampleCompany } from "./contract-pdf.test";

const photo = new Uint8Array(readFileSync(path.join(__dirname, "fixtures/photo.jpg")));

const delivery: PdfInspection = {
  inspection_type: "delivery",
  performed_at: "2026-11-01T09:00:00Z",
  completed_at: "2026-11-01T09:10:00Z",
  mileage: 18210,
  fuel_level: 100,
  checklist: { front: { condition: "ok" }, left_side: { condition: "minor", notes: "Arañazo leve en puerta trasera" }, wheels_tyres: { condition: "ok" }, interior: { condition: "ok" } },
  customer_present: true,
  customer_name: "María García Núñez",
  existing_damages_confirmed: true,
  observations: "Vehículo limpio, depósito lleno.",
  inspector: "João Bartolomeu",
  photos: [
    { area: "front", bytes: photo, type: "jpg" },
    { area: "left_side", bytes: photo, type: "jpg" },
  ],
};
const ret: PdfInspection = {
  ...delivery,
  inspection_type: "return",
  performed_at: "2026-11-05T09:00:00Z",
  completed_at: "2026-11-05T09:20:00Z",
  mileage: 19480,
  fuel_level: 75,
  checklist: { ...delivery.checklist, front: { condition: "damaged", notes: "Abolladura en el paragolpes" } },
  photos: [{ area: "front", bytes: photo, type: "jpg" }],
};
const damages = [
  { id: "d1", vehicle_id: "v", rental_id: "r", detected_at: "2026-11-05", area: "front", category: "dent", severity: "high", status: "pending", description: "Abolladura en el paragolpes delantero", estimated_cost: 380, actual_cost: null, vehicle: "Toyota Corolla", plate: "1234 LKM", contract: "JB-2026-00015" },
] as const;

describe("relatórios de inspeção em PDF", () => {
  for (const locale of ["es-ES", "pt-BR"] as const) {
    it(`inspeção com fotos (${locale})`, async () => {
      const bytes = await buildInspectionPdf({
        inspection: delivery,
        vehicle: { brand: "Toyota", model: "Corolla", plate: "1234 LKM" },
        contractNumber: "JB-2026-00015",
        customer: "María García Núñez",
        damages: [],
        company: sampleCompany,
        logo: null,
        t: getDictionary(locale),
        locale,
      });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      if (process.env.CONTRACT_PDF_OUT) writeFileSync(`${process.env.CONTRACT_PDF_OUT}/inspecao-${locale}.pdf`, bytes);
    });
    it(`comparação entrega × devolução (${locale})`, async () => {
      const bytes = await buildComparisonPdf({
        delivery,
        ret,
        vehicle: { brand: "Toyota", model: "Corolla", plate: "1234 LKM" },
        contractNumber: "JB-2026-00015",
        customer: "María García Núñez",
        damages: damages as never,
        company: sampleCompany,
        logo: null,
        t: getDictionary(locale),
        locale,
      });
      expect((await PDFDocument.load(bytes)).getTitle()).toContain("JB-2026-00015");
      if (process.env.CONTRACT_PDF_OUT) writeFileSync(`${process.env.CONTRACT_PDF_OUT}/comparacao-${locale}.pdf`, bytes);
    });
  }
});
