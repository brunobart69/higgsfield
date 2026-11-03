import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { interpolate } from "@/lib/i18n/config";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { RentalDetail } from "@/lib/rentals/queries";
import type { CompanySettings } from "@/lib/settings/queries";

export const A4 = { w: 595.28, h: 841.89 };
export const M = 48; // margem
export const GOLD = rgb(0.69, 0.55, 0.2);
export const INK = rgb(0.1, 0.1, 0.11);
export const MUTED = rgb(0.42, 0.42, 0.45);
export const LINE = rgb(0.85, 0.85, 0.87);

/**
 * As fontes padrão do PDF usam a codificação WinAnsi, que cobre português e
 * espanhol (á, ã, ç, ñ, €, º…). Caracteres fora dela são trocados por
 * equivalentes simples para o PDF nunca falhar.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[   ]/g, " ")
    .replace(/[→⇒]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[‐-‒−]/g, "-")
    .replace(/[^\x20-\x7e¡-ÿ€–—‘’“”•…\n]/g, "");
}

export type Ctx = { doc: PDFDocument; page: PDFPage; y: number; font: PDFFont; bold: PDFFont; footer: string; pages: PDFPage[] };

export function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([A4.w, A4.h]);
  ctx.pages.push(ctx.page);
  ctx.y = A4.h - M;
}

export function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < M + 30) newPage(ctx);
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function paragraph(ctx: Ctx, text: string, opts: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont; x?: number; width?: number; gap?: number } = {}) {
  const size = opts.size ?? 9.5;
  const font = opts.font ?? ctx.font;
  const x = opts.x ?? M;
  const width = opts.width ?? A4.w - 2 * M;
  const lh = size * 1.4;
  for (const line of wrap(text, font, size, width)) {
    ensure(ctx, lh);
    ctx.page.drawText(line, { x, y: ctx.y - size, size, font, color: opts.color ?? INK });
    ctx.y -= lh;
  }
  ctx.y -= opts.gap ?? 4;
}

export function heading(ctx: Ctx, text: string) {
  ensure(ctx, 34);
  ctx.y -= 8;
  ctx.page.drawText(pdfSafe(text).toUpperCase(), { x: M, y: ctx.y - 9, size: 9, font: ctx.bold, color: GOLD });
  ctx.y -= 14;
  ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: A4.w - M, y: ctx.y }, thickness: 0.6, color: LINE });
  ctx.y -= 8;
}

/** Pares rótulo/valor em duas colunas. */
export function fields(ctx: Ctx, items: Array<[string, string | null | undefined]>, cols = 2) {
  const width = (A4.w - 2 * M) / cols;
  const rows = items.filter(([, v]) => v);
  for (let i = 0; i < rows.length; i += cols) {
    const slice = rows.slice(i, i + cols);
    const heights = slice.map(([, v]) => wrap(v!, ctx.font, 9.5, width - 12).length);
    const h = 12 + Math.max(...heights) * 13 + 6;
    ensure(ctx, h);
    slice.forEach(([label, value], j) => {
      const x = M + j * width;
      ctx.page.drawText(pdfSafe(label), { x, y: ctx.y - 8, size: 7.5, font: ctx.font, color: MUTED });
      wrap(value!, ctx.font, 9.5, width - 12).forEach((line, k) => {
        ctx.page.drawText(line, { x, y: ctx.y - 21 - k * 13, size: 9.5, font: ctx.font, color: INK });
      });
    });
    ctx.y -= h;
  }
}

export function moneyRow(ctx: Ctx, label: string, value: string, strong = false) {
  ensure(ctx, 16);
  const f = strong ? ctx.bold : ctx.font;
  const size = strong ? 11 : 9.5;
  ctx.page.drawText(pdfSafe(label), { x: M, y: ctx.y - size, size, font: f, color: strong ? INK : MUTED });
  const v = pdfSafe(value);
  ctx.page.drawText(v, { x: A4.w - M - f.widthOfTextAtSize(v, size), y: ctx.y - size, size, font: f, color: INK });
  ctx.y -= size + 6;
}

/** Cabeçalho com logotipo e dados da empresa + faixa com título e número. */
export async function drawDocHeader(ctx: Ctx, opts: { company: CompanySettings; logo: { bytes: Uint8Array; type: "png" | "jpg" } | null; title: string; reference: string; issuedLabel: string; taxLabel: string }) {
  const { company: co } = opts;
  let logo: PDFImage | null = null;
  if (opts.logo) {
    try {
      logo = opts.logo.type === "png" ? await ctx.doc.embedPng(opts.logo.bytes) : await ctx.doc.embedJpg(opts.logo.bytes);
    } catch {
      logo = null;
    }
  }
  let textX = M;
  if (logo) {
    const scale = Math.min(110 / logo.width, 48 / logo.height);
    ctx.page.drawImage(logo, { x: M, y: ctx.y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    textX = M + logo.width * scale + 14;
  }
  ctx.page.drawText(pdfSafe(co.legal_name || co.name), { x: textX, y: ctx.y - 14, size: 13, font: ctx.bold, color: INK });
  const coLine = [co.tax_id && `${opts.taxLabel} ${co.tax_id}`, [co.address, co.postal_code, co.city].filter(Boolean).join(", "), co.phone, co.email].filter(Boolean).join("  ·  ");
  wrap(coLine, ctx.font, 8, A4.w - M - textX).forEach((line, i) => ctx.page.drawText(line, { x: textX, y: ctx.y - 28 - i * 11, size: 8, font: ctx.font, color: MUTED }));
  ctx.y -= 62;
  ctx.page.drawRectangle({ x: M, y: ctx.y - 40, width: A4.w - 2 * M, height: 40, color: rgb(0.97, 0.96, 0.93), borderColor: GOLD, borderWidth: 0.6 });
  ctx.page.drawText(pdfSafe(opts.title), { x: M + 12, y: ctx.y - 17, size: 12, font: ctx.bold, color: INK });
  const ref = pdfSafe(opts.reference);
  ctx.page.drawText(ref, { x: A4.w - M - 12 - ctx.bold.widthOfTextAtSize(ref, 11), y: ctx.y - 17, size: 11, font: ctx.bold, color: GOLD });
  const issued = pdfSafe(opts.issuedLabel);
  ctx.page.drawText(issued, { x: A4.w - M - 12 - ctx.font.widthOfTextAtSize(issued, 8), y: ctx.y - 31, size: 8, font: ctx.font, color: MUTED });
  ctx.y -= 52;
}

/** Rodapé com texto e paginação em todas as páginas. */
export function drawFooters(ctx: Ctx, reference: string, pageLabel: string) {
  const total = ctx.pages.length;
  ctx.pages.forEach((p, i) => {
    const footer = pdfSafe([ctx.footer, reference, interpolate(pageLabel, { n: i + 1, total })].filter(Boolean).join("  ·  "));
    const lines = wrap(footer, ctx.font, 7, A4.w - 2 * M);
    lines.forEach((line, k) => p.drawText(line, { x: M, y: 26 + (lines.length - 1 - k) * 9, size: 7, font: ctx.font, color: MUTED }));
  });
}

export async function newDoc(title: string, author: string, locale: string, footer: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setCreator("JB RENT PRO");
  doc.setLanguage(locale);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([A4.w, A4.h]);
  return { doc, page, y: A4.h - M, font, bold, footer, pages: [page] };
}

export async function buildContractPdf(input: {
  rental: RentalDetail;
  company: CompanySettings;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  t: Dictionary;
  locale: Locale;
}): Promise<Uint8Array> {
  const { rental: r, company: co, t, locale } = input;
  const c = t.contract;
  const doc = await PDFDocument.create();
  doc.setTitle(`${c.title} ${r.contract_number}`);
  doc.setAuthor(co.name);
  doc.setCreator("JB RENT PRO");
  doc.setLanguage(locale);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, page: doc.addPage([A4.w, A4.h]), y: A4.h - M, font, bold, footer: co.contract_footer ?? "", pages: [] };
  ctx.pages.push(ctx.page);
  const money = (n: number) => formatCurrency(n, locale);

  // ---- cabeçalho
  let logo: PDFImage | null = null;
  if (input.logo) {
    try {
      logo = input.logo.type === "png" ? await doc.embedPng(input.logo.bytes) : await doc.embedJpg(input.logo.bytes);
    } catch {
      logo = null;
    }
  }
  let textX = M;
  if (logo) {
    const scale = Math.min(110 / logo.width, 48 / logo.height);
    ctx.page.drawImage(logo, { x: M, y: ctx.y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    textX = M + logo.width * scale + 14;
  }
  ctx.page.drawText(pdfSafe(co.legal_name || co.name), { x: textX, y: ctx.y - 14, size: 13, font: bold, color: INK });
  const coLine = [co.tax_id && `${c.taxId} ${co.tax_id}`, [co.address, co.postal_code, co.city].filter(Boolean).join(", "), co.phone, co.email]
    .filter(Boolean)
    .join("  ·  ");
  wrap(coLine, font, 8, A4.w - M - textX).forEach((line, i) => ctx.page.drawText(line, { x: textX, y: ctx.y - 28 - i * 11, size: 8, font, color: MUTED }));
  ctx.y -= 62;

  ctx.page.drawRectangle({ x: M, y: ctx.y - 40, width: A4.w - 2 * M, height: 40, color: rgb(0.97, 0.96, 0.93), borderColor: GOLD, borderWidth: 0.6 });
  ctx.page.drawText(pdfSafe(c.title), { x: M + 12, y: ctx.y - 17, size: 12, font: bold, color: INK });
  const num = pdfSafe(`${c.number} ${r.contract_number}`);
  ctx.page.drawText(num, { x: A4.w - M - 12 - bold.widthOfTextAtSize(num, 11), y: ctx.y - 17, size: 11, font: bold, color: GOLD });
  const issued = pdfSafe(`${c.issued} ${formatDate(new Date())}`);
  ctx.page.drawText(issued, { x: A4.w - M - 12 - font.widthOfTextAtSize(issued, 8), y: ctx.y - 31, size: 8, font, color: MUTED });
  ctx.y -= 52;

  // ---- partes
  const cu = r.customer;
  const customerName = (cu.customer_type === "company" ? cu.legal_name || cu.company_name : cu.full_name) ?? "—";
  const docType = cu.id_document_type ? t.customers.idTypes[cu.id_document_type as keyof typeof t.customers.idTypes] : "";
  heading(ctx, c.lessee);
  fields(ctx, [
    [c.lessee, customerName],
    [cu.customer_type === "company" ? c.taxId : c.idDocument, cu.customer_type === "company" ? cu.tax_id : [docType, cu.id_document_number].filter(Boolean).join(" ")],
    [t.customers.fields.address, [cu.address, cu.postal_code, cu.city, cu.country].filter(Boolean).join(", ")],
    [`${c.phone} / ${c.email}`, [cu.phone, cu.email].filter(Boolean).join("  ·  ")],
    [t.customers.fields.representative_name, cu.customer_type === "company" ? cu.representative_name : null],
    [
      c.licence,
      cu.driving_licence_number
        ? `${cu.driving_licence_number}${cu.driving_licence_expiry ? ` (${c.licenceValid} ${formatDate(cu.driving_licence_expiry)})` : ""}`
        : null,
    ],
  ]);

  // ---- veículo
  const v = r.vehicle;
  heading(ctx, c.vehicle);
  fields(
    ctx,
    [
      [c.vehicle, `${v.brand} ${v.model}${v.version ? ` ${v.version}` : ""}`],
      [c.plate, v.plate],
      [c.vin, v.vin],
      [t.vehicles.fields.color, v.color],
    ],
    2,
  );

  // ---- período
  heading(ctx, c.period);
  fields(ctx, [
    [c.pickup, `${formatDateTime(r.pickup_at)}${r.pickup_location ? ` · ${r.pickup_location}` : ""}`],
    [c.return, `${formatDateTime(r.return_at)}${r.return_location ? ` · ${r.return_location}` : ""}`],
    [c.days, String(r.rental_days)],
    [c.mode, t.rentals.modes[r.pricing_mode]],
  ]);

  // ---- preço
  heading(ctx, c.price);
  moneyRow(ctx, `${c.base} (${t.rentals.modes[r.pricing_mode]} · ${c.unitPrice} ${money(r.unit_price)})`, money(r.base_amount));
  for (const e of r.extras) {
    const qty = e.quantity * (e.charge_type === "per_day" ? r.rental_days : 1);
    moneyRow(ctx, `${c.extras}: ${e.name} (${qty} × ${money(e.amount)})`, money(Math.round(e.amount * 100 * qty) / 100));
  }
  if (r.extra_fees_amount) moneyRow(ctx, c.fees, money(r.extra_fees_amount));
  if (r.discount_amount) moneyRow(ctx, c.discount, `- ${money(r.discount_amount)}`);
  if (r.excess_mileage_amount) moneyRow(ctx, `${c.excess} (${formatNumber(r.excess_km, locale)} km)`, money(r.excess_mileage_amount));
  ensure(ctx, 24);
  ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: A4.w - M, y: ctx.y }, thickness: 0.6, color: LINE });
  ctx.y -= 6;
  moneyRow(ctx, c.total, money(r.total_amount), true);
  paragraph(
    ctx,
    [c.vatNote, co.vat_rate !== null ? `${co.prices_include_vat ? c.vatIncluded : c.vatExcluded} (${String(co.vat_rate).replace(".", ",")} %)` : "", r.payment_method ? `${c.payment}: ${t.paymentMethods[r.payment_method as keyof typeof t.paymentMethods]}` : ""]
      .filter(Boolean)
      .join(" · "),
    { size: 8, color: MUTED },
  );

  // ---- caução, quilometragem, combustível
  if (r.deposit_amount > 0) {
    heading(ctx, c.deposit);
    paragraph(ctx, interpolate(c.depositText, { amount: money(r.deposit_amount) }));
  }
  heading(ctx, c.mileage);
  paragraph(
    ctx,
    r.allowed_km === null
      ? c.mileageUnlimited
      : interpolate(c.mileageLimited, { km: formatNumber(r.allowed_km, locale), price: money(r.excess_km_price ?? 0) }),
  );
  fields(ctx, [
    [c.startMileage, r.start_mileage !== null ? `${formatNumber(r.start_mileage, locale)} km` : c.notRecorded],
    [c.endMileage, r.end_mileage !== null ? `${formatNumber(r.end_mileage, locale)} km` : c.notRecorded],
  ]);
  heading(ctx, c.fuel);
  paragraph(
    ctx,
    interpolate(c.fuelText, {
      start: r.start_fuel_level !== null ? `${r.start_fuel_level} %` : c.notRecorded,
      end: r.end_fuel_level !== null ? `${r.end_fuel_level} %` : c.notRecorded,
    }),
  );

  // ---- condições
  heading(ctx, c.returnConditions);
  paragraph(ctx, c.returnText);
  const conditions = locale === "es-ES" ? co.rental_conditions_es : co.rental_conditions_pt;
  heading(ctx, c.conditions);
  paragraph(ctx, conditions?.trim() || c.noConditions, { size: 8.5 });
  if (r.notes) paragraph(ctx, `${t.rentals.fields.notes}: ${r.notes}`, { size: 8.5, color: MUTED });

  // ---- assinaturas (estrutura pronta para assinatura eletrônica futura)
  ensure(ctx, 120);
  heading(ctx, c.signatures);
  ctx.y -= 50;
  const colW = (A4.w - 2 * M - 40) / 2;
  [c.signLessor, c.signLessee].forEach((label, i) => {
    const x = M + i * (colW + 40);
    ctx.page.drawLine({ start: { x, y: ctx.y }, end: { x: x + colW, y: ctx.y }, thickness: 0.8, color: INK });
    ctx.page.drawText(pdfSafe(label), { x, y: ctx.y - 12, size: 8, font, color: MUTED });
    ctx.page.drawText(pdfSafe(i === 0 ? co.legal_name || co.name : customerName), { x, y: ctx.y - 24, size: 9, font: bold, color: INK });
  });
  ctx.y -= 40;

  // ---- rodapé e paginação
  const total = ctx.pages.length;
  ctx.pages.forEach((p, i) => {
    const footer = pdfSafe([ctx.footer, `${r.contract_number}`, interpolate(c.page, { n: i + 1, total })].filter(Boolean).join("  ·  "));
    const lines = wrap(footer, font, 7, A4.w - 2 * M);
    lines.forEach((line, k) => p.drawText(line, { x: M, y: 26 + (lines.length - 1 - k) * 9, size: 7, font, color: MUTED }));
  });

  return doc.save();
}
