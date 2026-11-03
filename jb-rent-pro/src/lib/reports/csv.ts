import type { Cell, Column, ReportDoc } from "./types";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * CSV para Excel/LibreOffice em PT/ES: separador ";", decimal com vírgula,
 * datas DD/MM/AAAA, UTF-8 com BOM. Células que começam com = + - @ (fórmulas)
 * são neutralizadas para evitar injeção de fórmulas em planilhas.
 */
export function csvCell(value: Cell, type: Column["type"]): string {
  let s: string;
  if (value === null || value === undefined || value === "") s = "";
  else if (type === "money") s = Number(value).toFixed(2).replace(".", ",");
  else if (type === "number" || type === "percent") s = String(Math.round(Number(value) * 100) / 100).replace(".", ",");
  else if (type === "date") s = formatDate(String(value));
  else if (type === "datetime") s = formatDateTime(String(value));
  else {
    s = String(value).replace(/\r?\n/g, " ");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(doc: ReportDoc): string {
  const lines: string[] = [];
  const multi = doc.sections.length > 1;
  for (const sec of doc.sections) {
    if (multi) lines.push(csvCell(sec.title, "text"));
    lines.push(sec.columns.map((c) => csvCell(c.label, "text")).join(";"));
    for (const r of sec.rows) lines.push(sec.columns.map((c) => csvCell(r[c.key] ?? null, c.type)).join(";"));
    if (sec.totals) lines.push(sec.columns.map((c) => csvCell(sec.totals![c.key] ?? null, c.type)).join(";"));
    if (multi) lines.push("");
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
