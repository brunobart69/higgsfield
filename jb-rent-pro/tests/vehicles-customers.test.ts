import { describe, expect, it } from "vitest";
import { spanishIdChecksumOk } from "@/lib/validation/common";
import { vehicleSchema } from "@/lib/validation/vehicles";
import { customerSchema, toCustomerRow } from "@/lib/validation/customers";
import { toFieldErrors } from "@/lib/auth/validation";
import { buildStoragePath, extFor, formatBytes, sniffMime } from "@/lib/files/sniff";
import { parsePage, sanitizeSearch } from "@/lib/search";

describe("DNI / NIE", () => {
  it("aceita documentos com letra de controle correta", () => {
    expect(spanishIdChecksumOk("12345678Z")).toBe(true);
    expect(spanishIdChecksumOk("00000000T")).toBe(true);
    expect(spanishIdChecksumOk("X1234567L")).toBe(true);
    expect(spanishIdChecksumOk("Y1234567X")).toBe(true);
    expect(spanishIdChecksumOk("12.345.678-z")).toBe(true);
  });
  it("rejeita letra errada ou formato inválido", () => {
    expect(spanishIdChecksumOk("12345678A")).toBe(false);
    expect(spanishIdChecksumOk("X12345678L")).toBe(false);
    expect(spanishIdChecksumOk("1234567Z")).toBe(false);
  });
});

describe("veículo", () => {
  const base = { brand: "Toyota", model: "Corolla", plate: " 1234   abc ", status: "available" };
  it("normaliza matrícula, VIN, quilometragem e valores", () => {
    const v = vehicleSchema.parse({ ...base, vin: "jtdkb20u 093123456", current_mileage: "45.300", daily_price: "45,00", year: "2023" });
    expect(v.plate).toBe("1234 ABC");
    expect(v.vin).toBe("JTDKB20U093123456");
    expect(v.current_mileage).toBe(45300);
    expect(v.daily_price).toBe("45.00");
    expect(v.year).toBe(2023);
    expect(v.fuel).toBeNull();
  });
  it("valida VIN, ano, datas e campos obrigatórios", () => {
    const r = vehicleSchema.safeParse({ ...base, brand: "", vin: "123", year: "1900" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = toFieldErrors(r.error);
      expect(fe.brand).toBe("required");
      expect(fe.vin).toBe("invalidVin");
      expect(fe.year).toBe("invalidNumber");
    }
    const dates = vehicleSchema.safeParse({ ...base, acquisition_date: "2026-05-01", fleet_entry_date: "2026-04-01" });
    expect(!dates.success && toFieldErrors(dates.error).fleet_entry_date).toBe("entryBeforeAcquisition");
    expect(vehicleSchema.safeParse({ ...base, vin: "JTDKB20U0931234IO" }).success).toBe(false); // I e O não existem em VIN
    expect(vehicleSchema.safeParse({ ...base, fuel: "steam" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...base, itv_due_date: "2026-02-30" }).success).toBe(false);
  });
});

describe("cliente", () => {
  const ind = { customer_type: "individual", full_name: "María García", gdpr_informed: "on" };
  it("pessoa física com DNI válido", () => {
    const r = customerSchema.parse({ ...ind, id_document_type: "dni", id_document_number: "12345678Z", email: "MARIA@MAIL.ES", country: "es" });
    const row = toCustomerRow(r, null);
    expect(row.full_name).toBe("María García");
    expect(row.email).toBe("maria@mail.es");
    expect(row.country).toBe("ES");
    expect(row.company_name).toBeNull();
    expect(row.gdpr_consent_at).toBeTruthy();
  });
  it("mantém a data original do consentimento ao editar", () => {
    const r = customerSchema.parse(ind);
    expect(toCustomerRow(r, "2026-01-01T10:00:00Z").gdpr_consent_at).toBe("2026-01-01T10:00:00Z");
  });
  it("rejeita DNI com letra errada, documento sem tipo e falta de aviso RGPD", () => {
    const r = customerSchema.safeParse({ customer_type: "individual", full_name: "Ana", id_document_type: "dni", id_document_number: "12345678A" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = toFieldErrors(r.error);
      expect(fe.id_document_number).toBe("invalidDni");
      expect(fe.gdpr_informed).toBe("gdprRequired");
    }
    const noType = customerSchema.safeParse({ ...ind, id_document_type: "", id_document_number: "AB123" });
    expect(!noType.success && toFieldErrors(noType.error).id_document_type).toBe("required");
    expect(customerSchema.safeParse({ ...ind, id_document_type: "passport", id_document_number: "PA1234567" }).success).toBe(true);
  });
  it("pessoa jurídica com dados de faturação", () => {
    const r = customerSchema.parse({
      customer_type: "company",
      company_name: "Transportes Sol S.L.",
      tax_id: "b-12345678",
      billing_email: "facturas@sol.es",
      gdpr_informed: "on",
    });
    const row = toCustomerRow(r, null);
    expect(row.tax_id).toBe("B12345678");
    expect(row.billing_details).toEqual({ email: "facturas@sol.es" });
    expect(row.full_name).toBeNull();
  });
  it("data de nascimento no futuro é inválida", () => {
    const r = customerSchema.safeParse({ ...ind, birth_date: "2999-01-01" });
    expect(!r.success && toFieldErrors(r.error).birth_date).toBe("invalidDate");
  });
});

describe("arquivos e busca", () => {
  it("identifica o tipo real pelo conteúdo", () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // executável
  });
  it("caminho no bucket começa pela pasta da empresa", () => {
    const p = buildStoragePath("comp", "vehicles", "veh", "photos", extFor("image/jpeg"));
    expect(p).toMatch(/^comp\/vehicles\/veh\/photos\/[0-9a-f-]+\.jpg$/);
    expect(formatBytes(1536)).toBe("2 KB");
  });
  it("sanitiza a busca para os filtros da API", () => {
    expect(sanitizeSearch("1234 ABC")).toBe("1234 ABC");
    expect(sanitizeSearch("a,b)or(id.eq.1*")).toBe("a b or id.eq.1");
    expect(sanitizeSearch(undefined)).toBe("");
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("3")).toBe(3);
  });
});
