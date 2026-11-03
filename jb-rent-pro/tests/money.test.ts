import { describe, expect, it } from "vitest";
import { centsToDecimalString, sumCents, toCents } from "@/lib/money";

describe("money", () => {
  it("converte strings decimais sem erro de ponto flutuante", () => {
    expect(toCents("0.1") + toCents("0.2")).toBe(30);
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("1.234,56")).toBe(123456);
    expect(toCents("12,5")).toBe(1250);
    expect(toCents("1 000,00 €")).toBe(100000);
    expect(toCents("-15.40")).toBe(-1540);
  });

  it("arredonda meio para cima na terceira casa", () => {
    expect(toCents("10.005")).toBe(1001);
    expect(toCents("10.004")).toBe(1000);
    expect(toCents(1.005)).toBe(101);
  });

  it("soma valores do banco com exatidão", () => {
    expect(centsToDecimalString(sumCents(["1000.10", "0.20", "-300.05"]))).toBe("700.25");
    const many = Array.from({ length: 1000 }, () => "0.10");
    expect(sumCents(many)).toBe(10000);
  });

  it("rejeita valores inválidos", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
    expect(() => toCents(Number.NaN)).toThrow();
  });

  it("formata para o banco", () => {
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(-1540)).toBe("-15.40");
  });
});
