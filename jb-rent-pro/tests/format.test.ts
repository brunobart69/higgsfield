import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatDateTime, formatMonthShort } from "@/lib/format";

const nb = (s: string) => s.replace(/ | /g, " ");

describe("format", () => {
  it("moeda EUR nos dois idiomas", () => {
    expect(nb(formatCurrency(1234.5, "es-ES"))).toBe("1234,50 €"); // CLDR es-ES não agrupa 4 dígitos
    expect(nb(formatCurrency(12345.5, "es-ES"))).toBe("12.345,50 €");
    expect(nb(formatCurrency(12345.5, "pt-BR"))).toBe("€ 12.345,50");
    expect(nb(formatCurrency("700.25", "pt-BR"))).toBe("€ 700,25");
  });

  it("datas DD/MM/YYYY sem deslocamento de fuso para datas civis", () => {
    expect(formatDate("2026-01-31")).toBe("31/01/2026");
    expect(formatDate(null)).toBe("—");
  });

  it("data/hora 24h em Europe/Madrid", () => {
    expect(formatDateTime("2026-07-01T13:05:00Z")).toBe("01/07/2026 15:05"); // CEST
    expect(formatDateTime("2026-01-01T23:30:00Z")).toBe("02/01/2026 00:30"); // CET
  });

  it("mês abreviado traduzido", () => {
    expect(formatMonthShort("2026-10-01", "pt-BR")).toBe("out/26");
    expect(formatMonthShort("2026-10-01", "es-ES")).toBe("oct/26");
  });
});
