/**
 * Prepara o termo de busca para filtros PostgREST `or=(...)`:
 * remove caracteres com significado na sintaxe (vírgula, parênteses, curingas).
 */
export function sanitizeSearch(raw: unknown, max = 60): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[,()*%\\:"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parsePage(raw: unknown): number {
  const n = Number.parseInt(typeof raw === "string" ? raw : "1", 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(10_000, n)) : 1;
}
