import { rgb, type PDFImage } from "pdf-lib";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { interpolate } from "@/lib/i18n/config";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { CompanySettings } from "@/lib/settings/queries";
import { AREA_GROUPS, compareInspections, type Checklist, type Condition, type InspectionArea } from "@/lib/inspections/constants";
import type { DamageListItem } from "@/lib/inspections/queries";
import { A4, INK, LINE, M, MUTED, drawDocHeader, drawFooters, ensure, fields, heading, newDoc, paragraph, pdfSafe, type Ctx } from "./pdf";

export type PdfPhoto = { area: string; bytes: Uint8Array; type: "png" | "jpg" };
export type PdfInspection = {
  inspection_type: "delivery" | "return" | "periodic";
  performed_at: string;
  completed_at: string | null;
  mileage: number | null;
  fuel_level: number | null;
  checklist: Checklist;
  customer_present: boolean;
  customer_name: string | null;
  existing_damages_confirmed: boolean;
  observations: string | null;
  inspector: string | null;
  photos: PdfPhoto[];
};
type Vehicle = { brand: string; model: string; plate: string };

const COND_COLOR: Record<Condition, ReturnType<typeof rgb>> = {
  ok: rgb(0.13, 0.55, 0.3),
  minor: rgb(0.72, 0.52, 0.04),
  damaged: rgb(0.75, 0.15, 0.15),
  not_checked: MUTED,
};

async function embed(ctx: Ctx, p: PdfPhoto): Promise<PDFImage | null> {
  try {
    return p.type === "png" ? await ctx.doc.embedPng(p.bytes) : await ctx.doc.embedJpg(p.bytes);
  } catch {
    return null;
  }
}

/** Grade de fotos (3 por linha) com legenda da área. */
async function photoGrid(ctx: Ctx, photos: PdfPhoto[], label: (area: string) => string) {
  const cols = 3;
  const gap = 10;
  const w = (A4.w - 2 * M - gap * (cols - 1)) / cols;
  const h = w * 0.72;
  for (let i = 0; i < photos.length; i += cols) {
    ensure(ctx, h + 22);
    const row = photos.slice(i, i + cols);
    for (const [j, p] of row.entries()) {
      const img = await embed(ctx, p);
      const x = M + j * (w + gap);
      ctx.page.drawRectangle({ x, y: ctx.y - h, width: w, height: h, color: rgb(0.95, 0.95, 0.96) });
      if (img) {
        const s = Math.min(w / img.width, h / img.height);
        const iw = img.width * s;
        const ih = img.height * s;
        ctx.page.drawImage(img, { x: x + (w - iw) / 2, y: ctx.y - h + (h - ih) / 2, width: iw, height: ih });
      }
      ctx.page.drawText(pdfSafe(label(p.area)), { x, y: ctx.y - h - 10, size: 7.5, font: ctx.font, color: MUTED });
    }
    ctx.y -= h + 22;
  }
}

function checklistTable(ctx: Ctx, t: Dictionary, checklist: Checklist) {
  const it = t.inspections;
  for (const g of AREA_GROUPS) {
    ensure(ctx, 30);
    ctx.page.drawText(pdfSafe(it.groups[g.key]), { x: M, y: ctx.y - 9, size: 9, font: ctx.bold, color: INK });
    ctx.y -= 16;
    for (const area of g.areas) {
      const e = checklist[area];
      const c = (e?.condition ?? "not_checked") as Condition;
      ensure(ctx, 16);
      ctx.page.drawText(pdfSafe(it.areas[area]), { x: M + 8, y: ctx.y - 9, size: 9, font: ctx.font, color: INK });
      const cond = pdfSafe(it.conditions[c]);
      ctx.page.drawText(cond, { x: M + 230, y: ctx.y - 9, size: 9, font: ctx.bold, color: COND_COLOR[c] });
      ctx.y -= 14;
      if (e?.notes) paragraph(ctx, e.notes, { size: 8, color: MUTED, x: M + 16, width: A4.w - 2 * M - 16, gap: 2 });
    }
    ctx.y -= 4;
  }
}

function damagesTable(ctx: Ctx, t: Dictionary, locale: Locale, damages: DamageListItem[]) {
  if (damages.length === 0) {
    paragraph(ctx, t.damages.empty, { color: MUTED });
    return;
  }
  for (const d of damages) {
    const head = `${t.damages.categories[d.category]}${d.area ? ` · ${t.inspections.areas[d.area as InspectionArea]}` : ""} · ${t.damages.severities[d.severity]} · ${t.damages.statuses[d.status]}`;
    const cost = d.actual_cost ?? d.estimated_cost;
    paragraph(ctx, `${formatDate(d.detected_at)} — ${head}${cost !== null ? ` · ${formatCurrency(cost, locale)}` : ""}`, { size: 9, font: ctx.bold, gap: 0 });
    paragraph(ctx, d.description, { size: 8.5, color: MUTED });
  }
}

function signatures(ctx: Ctx, t: Dictionary, lessor: string, customer: string | null) {
  ensure(ctx, 110);
  heading(ctx, t.contract.signatures);
  ctx.y -= 46;
  const colW = (A4.w - 2 * M - 40) / 2;
  [t.inspections.inspector, t.contract.signLessee].forEach((label, i) => {
    const x = M + i * (colW + 40);
    ctx.page.drawLine({ start: { x, y: ctx.y }, end: { x: x + colW, y: ctx.y }, thickness: 0.8, color: INK });
    ctx.page.drawText(pdfSafe(label), { x, y: ctx.y - 12, size: 8, font: ctx.font, color: MUTED });
    const name = i === 0 ? lessor : (customer ?? "");
    if (name) ctx.page.drawText(pdfSafe(name), { x, y: ctx.y - 24, size: 9, font: ctx.bold, color: INK });
  });
  ctx.y -= 34;
}

export async function buildInspectionPdf(input: {
  inspection: PdfInspection;
  vehicle: Vehicle;
  contractNumber: string | null;
  customer: string | null;
  damages: DamageListItem[];
  company: CompanySettings;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  t: Dictionary;
  locale: Locale;
}): Promise<Uint8Array> {
  const { inspection: ins, vehicle: v, t, locale, company } = input;
  const it = t.inspections;
  const title = `${it.title.split(" ")[0]} · ${it.types[ins.inspection_type]}`;
  const ref = input.contractNumber ?? v.plate;
  const ctx = await newDoc(`${title} ${ref}`, company.name, locale, company.contract_footer ?? "");
  await drawDocHeader(ctx, { company, logo: input.logo, title, reference: ref, issuedLabel: `${t.contract.issued} ${formatDate(new Date())}`, taxLabel: t.contract.taxId });

  heading(ctx, t.contract.vehicle);
  fields(ctx, [
    [t.contract.vehicle, `${v.brand} ${v.model}`],
    [t.contract.plate, v.plate],
    [t.damages.fields.rental, input.contractNumber],
    [t.contract.lessee, input.customer],
    [it.fields.performedAt, formatDateTime(ins.completed_at ?? ins.performed_at)],
    [it.inspector, ins.inspector],
    [it.fields.mileage, ins.mileage !== null ? `${formatNumber(ins.mileage, locale)} km` : null],
    [it.fields.fuel, ins.fuel_level !== null ? `${ins.fuel_level} %` : null],
  ]);
  heading(ctx, it.vehicleCondition);
  checklistTable(ctx, t, ins.checklist);
  if (ins.observations) {
    heading(ctx, it.fields.observations);
    paragraph(ctx, ins.observations);
  }
  heading(ctx, t.damages.title);
  paragraph(ctx, `${it.fields.existingConfirmed}: ${ins.existing_damages_confirmed ? t.common.yes : t.common.no}`, { size: 8.5, color: MUTED });
  damagesTable(ctx, t, locale, input.damages);
  if (ins.photos.length) {
    ensure(ctx, 190);
    heading(ctx, it.photos);
    await photoGrid(ctx, ins.photos, (a) => it.areas[a as keyof typeof it.areas] ?? a);
  }
  signatures(ctx, t, company.legal_name || company.name, ins.customer_present ? (ins.customer_name ?? input.customer) : null);
  drawFooters(ctx, ref, t.contract.page);
  return ctx.doc.save();
}

export async function buildComparisonPdf(input: {
  delivery: PdfInspection;
  ret: PdfInspection;
  vehicle: Vehicle;
  contractNumber: string;
  customer: string | null;
  damages: DamageListItem[];
  company: CompanySettings;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  t: Dictionary;
  locale: Locale;
}): Promise<Uint8Array> {
  const { t, locale, company, vehicle: v } = input;
  const it = t.inspections;
  const cmp = compareInspections(input.delivery, input.ret);
  const ctx = await newDoc(`${it.compareTitle} ${input.contractNumber}`, company.name, locale, company.contract_footer ?? "");
  await drawDocHeader(ctx, { company, logo: input.logo, title: it.compareTitle, reference: input.contractNumber, issuedLabel: `${t.contract.issued} ${formatDate(new Date())}`, taxLabel: t.contract.taxId });

  heading(ctx, t.contract.vehicle);
  fields(ctx, [
    [t.contract.vehicle, `${v.brand} ${v.model} · ${v.plate}`],
    [t.contract.lessee, input.customer],
    [`${it.before} · ${it.fields.performedAt}`, formatDateTime(input.delivery.completed_at ?? input.delivery.performed_at)],
    [`${it.after} · ${it.fields.performedAt}`, formatDateTime(input.ret.completed_at ?? input.ret.performed_at)],
    [it.driven, cmp.drivenKm !== null ? `${formatNumber(cmp.drivenKm, locale)} km` : null],
    [it.fuelDiff, cmp.fuelDiff !== null ? `${input.delivery.fuel_level} % -> ${input.ret.fuel_level} % (${cmp.fuelDiff > 0 ? "+" : ""}${cmp.fuelDiff} %)` : null],
  ]);

  heading(ctx, cmp.worsened.length ? interpolate(it.differences, { n: cmp.worsened.length }) : it.noDifferences);
  // tabela área | entrega | devolução
  const colX = [M + 8, M + 210, M + 350];
  ensure(ctx, 16);
  [it.before, it.after].forEach((h, i) => ctx.page.drawText(pdfSafe(h), { x: colX[i + 1]!, y: ctx.y - 8, size: 7.5, font: ctx.bold, color: MUTED }));
  ctx.y -= 14;
  for (const a of cmp.areas.filter((x) => x.before !== "not_checked" || x.after !== "not_checked")) {
    ensure(ctx, 18);
    if (a.worsened) ctx.page.drawRectangle({ x: M, y: ctx.y - 13, width: A4.w - 2 * M, height: 16, color: rgb(0.99, 0.93, 0.93) });
    ctx.page.drawText(pdfSafe(`${a.worsened ? "! " : ""}${it.areas[a.area]}`), { x: colX[0]!, y: ctx.y - 9, size: 9, font: a.worsened ? ctx.bold : ctx.font, color: INK });
    ctx.page.drawText(pdfSafe(it.conditions[a.before]), { x: colX[1]!, y: ctx.y - 9, size: 9, font: ctx.font, color: COND_COLOR[a.before] });
    ctx.page.drawText(pdfSafe(it.conditions[a.after]), { x: colX[2]!, y: ctx.y - 9, size: 9, font: ctx.bold, color: COND_COLOR[a.after] });
    ctx.y -= 16;
    const notes = [a.beforeNotes && `${it.before}: ${a.beforeNotes}`, a.afterNotes && `${it.after}: ${a.afterNotes}`].filter(Boolean).join("  ·  ");
    if (notes) paragraph(ctx, notes, { size: 7.5, color: MUTED, x: M + 16, width: A4.w - 2 * M - 16, gap: 2 });
  }
  ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: A4.w - M, y: ctx.y }, thickness: 0.6, color: LINE });

  heading(ctx, t.damages.title);
  damagesTable(ctx, t, locale, input.damages);

  // fotos das áreas que pioraram: entrega e devolução lado a lado
  // por área: primeiro a(s) foto(s) da entrega, depois a(s) da devolução
  const pairs = cmp.worsened.flatMap((w) => [
    ...input.delivery.photos.filter((p) => p.area === w.area).map((p) => ({ ...p, area: `${p.area}|${it.before}` })),
    ...input.ret.photos.filter((p) => p.area === w.area).map((p) => ({ ...p, area: `${p.area}|${it.after}` })),
  ]);
  if (pairs.length) {
    ensure(ctx, 190);
    heading(ctx, `${it.photos} · ${it.worsened}`);
    await photoGrid(ctx, pairs, (key) => {
      const [area, when] = key.split("|");
      return `${it.areas[area as keyof typeof it.areas] ?? area} · ${when}`;
    });
  }
  signatures(ctx, t, company.legal_name || company.name, input.customer);
  drawFooters(ctx, input.contractNumber, t.contract.page);
  return ctx.doc.save();
}
