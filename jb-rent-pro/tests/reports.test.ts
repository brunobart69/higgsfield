import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/reports/csv";
import { buildReportPdf, displayCell } from "@/lib/reports/pdf";
import type { ReportDoc } from "@/lib/reports/types";

const doc: ReportDoc = {
  key: "entries",
  title: "Lançamentos",
  subtitle: "Teste",
  period: "01/11/2026 – 30/11/2026",
  notes: ["Nota"],
  sections: [
    {
      title: "Lançamentos",
      columns: [
        { key: "d", label: "Data", type: "date" },
        { key: "desc", label: "Descrição", type: "text" },
        { key: "v", label: "Valor", type: "money" },
      ],
      rows: [
        { d: "2026-11-03", desc: "Peças; filtro \"premium\"", v: 189.9 },
        { d: "2026-11-04", desc: "=HYPERLINK(\"http://x\")", v: -45 },
      ],
      totals: { desc: "Total", v: 144.9 },
    },
  ],
};

describe("CSV", () => {
  it("formato para Excel PT/ES: BOM, ponto e vírgula, decimal com vírgula, datas DD/MM/AAAA", () => {
    const csv = toCsv(doc);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Data;Descrição;Valor");
    expect(lines[1]).toBe('03/11/2026;"Peças; filtro ""premium""";189,90');
    expect(lines[3]).toBe(";Total;144,90");
  });
  it("neutraliza fórmulas (injeção em planilhas)", () => {
    expect(csvCell("=1+1", "text")).toBe("'=1+1");
    expect(csvCell("+34 600", "text")).toBe("'+34 600");
    expect(csvCell("@SUM(A1)", "text")).toBe("'@SUM(A1)");
    expect(csvCell(-45, "money")).toBe("-45,00");
    expect(csvCell(null, "money")).toBe("");
  });
});

describe("PDF de relatório", () => {
  it("gera um PDF válido com várias páginas", async () => {
    const many: ReportDoc = { ...doc, sections: [{ ...doc.sections[0]!, rows: Array.from({ length: 120 }, (_, i) => ({ d: "2026-11-03", desc: `Linha ${i} → ñ €`, v: i })) }] };
    const bytes = await buildReportPdf(many, { company: "JB RENT S.L.", generatedLabel: "Gerado", pageLabel: (n, t) => `${n}/${t}`, locale: "es-ES" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });
  it("exibe valores no formato local", () => {
    expect(displayCell(12345.6, "money", "es-ES")).toMatch(/12\.345,60/);
    expect(displayCell("2026-11-03", "date", "pt-BR")).toBe("03/11/2026");
    expect(displayCell(null, "text", "pt-BR")).toBe("—");
  });
});
