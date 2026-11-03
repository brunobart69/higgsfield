import { REGION } from "@/lib/i18n/config";

function madridParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REGION.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

/**
 * Data + hora civis de Madri ("2026-11-10", "10:00") → ISO UTC.
 * Testa os deslocamentos possíveis (CET +1 / CEST +2) e escolhe o que
 * reproduz exatamente a hora local informada.
 */
export function madridLocalToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const civil = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(civil.getTime()) || civil.toISOString().slice(0, 10) !== date) return null;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  if (hh > 23 || mm > 59) return null;
  for (const offset of [1, 2, 0]) {
    const utc = new Date(Date.UTC(y, m - 1, d, hh - offset, mm));
    const back = madridParts(utc);
    if (back.date === date && back.time === time) return utc.toISOString();
  }
  // hora inexistente (início do horário de verão): usa a hora seguinte válida
  const utc = new Date(Date.UTC(y, m - 1, d, hh - 1, mm));
  return Number.isNaN(utc.getTime()) ? null : utc.toISOString();
}

/** ISO → { date: "YYYY-MM-DD", time: "HH:mm" } em Madri (para preencher formulários). */
export function isoToMadridLocal(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return madridParts(d);
}
