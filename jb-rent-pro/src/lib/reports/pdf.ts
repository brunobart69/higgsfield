import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { GOLD, INK, LINE, MUTED, pdfSafe, wrap } from "@/lib/contracts/pdf";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import type { Cell, Column, ReportDoc } from "./types";

const M = 36;

export function displayCell(v: Cell, type: Column["type"], locale: Locale): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "money":
      return formatCurrency(Number(v), locale);
    case "number":
      return formatNumber(Number(v), locale, 2);
    case "percent":
      return `${formatNumber(Number(v), locale, 1)} %`;
    case "date":
      return formatDate(String(v));
    case "datetime":
      return formatDateTime(String(v));
    default:
      return String(v);
  }
}

function fit(text: string, font: PDFFont, size: number, width: number) {
  let s = pdfSafe(text);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > width) s = s.slice(0, -1);
  return `${s}…`;
}

/** Relatório tabular genérico (A4, retrato ou paisagem), com cabeçalho repetido e numeração de páginas. */
export async function buildReportPdf(doc: ReportDoc, opts: { company: string; generatedLabel: string; pageLabel: (n: number, total: number) => string; locale: Locale }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`${doc.title} · ${doc.period}`));
  pdf.setProducer("JB RENT PRO");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = doc.landscape ? [841.89, 595.28] : [595.28, 841.89];
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const add = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
    page.drawText(pdfSafe(opts.company), { x: M, y: y - 9, size: 9, font: bold, color: GOLD });
    const right = pdfSafe(`${doc.title} · ${doc.period}`);
    page.drawText(right, { x: W - M - font.widthOfTextAtSize(right, 8), y: y - 9, size: 8, font, color: MUTED });
    y -= 22;
  };
  add();
  page.drawText(pdfSafe(doc.title), { x: M, y: y - 16, size: 16, font: bold, color: INK });
  y -= 22;
  page.drawText(pdfSafe(`${doc.subtitle} · ${doc.period}`), { x: M, y: y - 9, size: 9, font, color: MUTED });
  y -= 22;

  const size = 8;
  const rowH = 14;
  for (const sec of doc.sections) {
    const width = W - 2 * M;
    // largura proporcional: texto ocupa mais
    const weights = sec.columns.map((c) => (c.type === "text" ? 2.2 : c.type === "datetime" ? 1.3 : 1));
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / sum) * width);
    // cabeçalho com quebra em até 2 linhas
    const labelLines = sec.columns.map((c, i) => wrap(c.label, bold, size, widths[i]! - 6).slice(0, 2));
    const headH = Math.max(...labelLines.map((l) => l.length)) * 10 + 5;
    const header = () => {
      page.drawRectangle({ x: M, y: y - headH, width, height: headH, color: rgb(0.96, 0.95, 0.92) });
      let x = M;
      sec.columns.forEach((c, i) => {
        const right = c.align === "right" || (c.type !== "text" && c.type !== "date" && c.type !== "datetime");
        labelLines[i]!.forEach((line, k) => {
          const txt = fit(line, bold, size, widths[i]! - 6);
          page.drawText(txt, { x: right ? x + widths[i]! - 3 - bold.widthOfTextAtSize(txt, size) : x + 3, y: y - 10 - k * 10, size, font: bold, color: INK });
        });
        x += widths[i]!;
      });
      y -= headH;
    };
    if (y < M + 60) add();
    page.drawText(pdfSafe(sec.title).toUpperCase(), { x: M, y: y - 9, size: 9, font: bold, color: GOLD });
    y -= 16;
    header();
    const rows = sec.totals ? [...sec.rows, sec.totals] : sec.rows;
    if (sec.rows.length === 0) {
      page.drawText(pdfSafe(sec.empty ?? "—"), { x: M + 3, y: y - 10, size, font, color: MUTED });
      y -= rowH;
    }
    rows.forEach((r, ri) => {
      if (y < M + 24) {
        add();
        header();
      }
      const isTotal = !!sec.totals && ri === rows.length - 1;
      const f = isTotal ? bold : font;
      let x = M;
      sec.columns.forEach((c, i) => {
        const raw = r[c.key];
        // na linha de totais, colunas sem total ficam em branco
        const txt = isTotal && (raw === undefined || raw === null) ? "" : fit(displayCell(raw ?? null, c.type, opts.locale), f, size, widths[i]! - 6);
        const right = c.align === "right" || (c.type !== "text" && c.type !== "date" && c.type !== "datetime");
        page.drawText(txt, { x: right ? x + widths[i]! - 3 - f.widthOfTextAtSize(txt, size) : x + 3, y: y - 10, size, font: f, color: INK });
        x += widths[i]!;
      });
      y -= rowH;
      page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: isTotal ? 0.8 : 0.3, color: isTotal ? GOLD : LINE });
    });
    y -= 14;
  }
  for (const n of doc.notes) {
    for (const line of wrap(n, font, 7.5, W - 2 * M)) {
      if (y < M + 30) add();
      page.drawText(line, { x: M, y: y - 8, size: 7.5, font, color: MUTED });
      y -= 10;
    }
    y -= 3;
  }
  const total = pages.length;
  pages.forEach((p, i) => {
    const label = pdfSafe(`${opts.generatedLabel} · ${opts.pageLabel(i + 1, total)}`);
    p.drawText(label, { x: M, y: 18, size: 7, font, color: MUTED });
  });
  return pdf.save();
}
