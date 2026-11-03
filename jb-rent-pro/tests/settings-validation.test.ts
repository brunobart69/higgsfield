import { describe, expect, it } from "vitest";
import { ibanChecksumOk, optionalIban, optionalMoney, optionalPercent, optionalSpanishTaxId } from "@/lib/validation/common";
import { companySchema, defaultsSchema, feeSchema, fiscalSchema } from "@/lib/validation/settings";
import { toFieldErrors } from "@/lib/auth/validation";

describe("valores monetários de formulário", () => {
  const m = optionalMoney();
  it("normaliza para decimal exato", () => {
    expect(m.parse("45")).toBe("45.00");
    expect(m.parse("45,5")).toBe("45.50");
    expect(m.parse("1.234,56")).toBe("1234.56");
    expect(m.parse("1234.56")).toBe("1234.56");
    expect(m.parse("€ 99,90")).toBe("99.90");
    expect(m.parse("")).toBeNull();
    expect(m.parse(undefined)).toBeNull();
  });
  it("rejeita valores inválidos", () => {
    expect(m.safeParse("12,345").success).toBe(false);
    expect(m.safeParse("-5").success).toBe(false);
    expect(m.safeParse("abc").success).toBe(false);
    expect(m.safeParse("99999999").success).toBe(false);
  });
});

describe("parâmetros fiscais", () => {
  it("percentual", () => {
    expect(optionalPercent.parse("21")).toBe("21");
    expect(optionalPercent.parse("10,5")).toBe("10.5");
    expect(optionalPercent.safeParse("101").success).toBe(false);
  });
  it("NIF/NIE/CIF (formato)", () => {
    expect(optionalSpanishTaxId.parse("12345678z")).toBe("12345678Z");
    expect(optionalSpanishTaxId.parse("X1234567L")).toBe("X1234567L");
    expect(optionalSpanishTaxId.parse("B-12345678")).toBe("B12345678");
    expect(optionalSpanishTaxId.safeParse("123").success).toBe(false);
  });
  it("IBAN com dígito de controle", () => {
    expect(ibanChecksumOk("ES9121000418450200051332")).toBe(true);
    expect(optionalIban.parse("es91 2100 0418 4502 0005 1332")).toBe("ES9121000418450200051332");
    expect(optionalIban.safeParse("ES9121000418450200051333").success).toBe(false);
  });
  it("seção fiscal completa", () => {
    const r = fiscalSchema.parse({ vat_rate: "21", prices_include_vat: "false", iban: "", fiscal_notes: "", document_retention_years: "6" });
    expect(r).toEqual({ vat_rate: "21", prices_include_vat: false, iban: null, fiscal_notes: null, document_retention_years: 6 });
  });
});

describe("empresa", () => {
  it("exige nome e valida código postal", () => {
    const r = companySchema.safeParse({ name: "", postal_code: "2800" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = toFieldErrors(r.error);
      expect(fe.name).toBe("required");
      expect(fe.postal_code).toBe("invalidPostalCode");
    }
    expect(companySchema.parse({ name: "JB", postal_code: "28001", email: "INFO@JB.ES" }).email).toBe("info@jb.es");
  });
});

describe("padrões de contrato", () => {
  const base = { default_locale: "es-ES", default_mileage_policy: "unlimited" };
  it("quilometragem ilimitada descarta o limite", () => {
    expect(defaultsSchema.parse({ ...base, default_mileage_limit_km: "300" }).default_mileage_limit_km).toBeNull();
  });
  it("limite obrigatório quando há política de limite", () => {
    const r = defaultsSchema.safeParse({ ...base, default_mileage_policy: "daily" });
    expect(!r.success && toFieldErrors(r.error).default_mileage_limit_km).toBe("mileageLimitRequired");
    expect(defaultsSchema.parse({ ...base, default_mileage_policy: "daily", default_mileage_limit_km: "250" }).default_mileage_limit_km).toBe(250);
  });
});

describe("taxas adicionais", () => {
  it("valida e normaliza", () => {
    const r = feeSchema.parse({ id: "", name_pt: "Cadeirinha", name_es: "Silla", amount: "5,00", charge_type: "per_day", vat_rate: "", is_active: "true" });
    expect(r).toMatchObject({ id: undefined, amount: "5.00", charge_type: "per_day", vat_rate: null, is_active: true });
    expect(feeSchema.safeParse({ name_pt: "x", name_es: "y", amount: "", charge_type: "per_day", is_active: "true" }).success).toBe(false);
  });
});
