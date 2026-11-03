import { addDays } from "@/lib/periods";
import { isoToMadridLocal } from "@/lib/rentals/datetime";

export type CalEvent = {
  kind: "rental" | "maintenance" | "insurance_end" | "itv" | "fine_deadline";
  id: string;
  vehicle_id: string;
  plate: string;
  title: string;
  subtitle: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: string;
};

/** Item de um dia no calendário mensal. */
export type DayItem = {
  key: string;
  type: "pickup" | "return" | "maintenance" | "insurance_end" | "itv" | "fine_identification" | "fine_payment";
  event: CalEvent;
  time: string | null;
};

/** Semanas (segunda a domingo) que cobrem o mês de `ym` ("YYYY-MM"). */
export function monthMatrix(ym: string): string[][] {
  const first = `${ym}-01`;
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = segunda
  let d = addDays(first, -dow);
  const weeks: string[][] = [];
  do {
    const w: string[] = [];
    for (let i = 0; i < 7; i++) {
      w.push(d);
      d = addDays(d, 1);
    }
    weeks.push(w);
  } while (d.slice(0, 7) === ym);
  return weeks;
}

/** Dia civil (Madri) de um instante; para eventos "dia inteiro" o fim é exclusivo. */
export function madridDay(iso: string): string {
  return isoToMadridLocal(iso).date;
}

/** Distribui os eventos pelos dias: retirada e devolução de contratos, oficina por dia, prazos. */
export function dayItems(events: CalEvent[]): Map<string, DayItem[]> {
  const map = new Map<string, DayItem[]>();
  const push = (day: string, item: DayItem) => {
    const list = map.get(day) ?? [];
    list.push(item);
    map.set(day, list);
  };
  for (const e of events) {
    if (e.kind === "rental") {
      const p = isoToMadridLocal(e.starts_at);
      const r = isoToMadridLocal(e.ends_at);
      push(p.date, { key: `${e.id}-p`, type: "pickup", event: e, time: p.time });
      push(r.date, { key: `${e.id}-r`, type: "return", event: e, time: r.time });
    } else if (e.kind === "maintenance") {
      const start = madridDay(e.starts_at);
      const end = addDays(madridDay(e.ends_at), -1);
      for (let d = start, i = 0; d <= end && i < 62; d = addDays(d, 1), i++) push(d, { key: `${e.id}-${d}`, type: "maintenance", event: e, time: null });
    } else if (e.kind === "fine_deadline") {
      push(madridDay(e.starts_at), { key: e.id, type: e.subtitle === "identification" ? "fine_identification" : "fine_payment", event: e, time: null });
    } else {
      push(madridDay(e.starts_at), { key: `${e.kind}-${e.id}`, type: e.kind, event: e, time: null });
    }
  }
  const order = { return: 0, pickup: 1, maintenance: 2, fine_identification: 3, fine_payment: 4, insurance_end: 5, itv: 6 } as const;
  for (const list of map.values()) list.sort((a, b) => (a.time ?? "99") .localeCompare(b.time ?? "99") || order[a.type] - order[b.type]);
  return map;
}

/** Barra de um evento na linha do tempo (colunas = dias de `start` a `start + days − 1`). */
export function barSpan(e: Pick<CalEvent, "starts_at" | "ends_at" | "all_day">, start: string, days: number): { from: number; to: number } | null {
  const s = madridDay(e.starts_at);
  // fim exclusivo para dia inteiro; para contratos, o dia da devolução também é ocupado
  const endDay = e.all_day ? addDays(madridDay(e.ends_at), -1) : madridDay(e.ends_at);
  const last = addDays(start, days - 1);
  if (endDay < start || s > last) return null;
  const idx = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  return { from: Math.max(0, idx(s)), to: Math.min(days - 1, idx(endDay)) };
}

export function hrefFor(e: CalEvent): string {
  switch (e.kind) {
    case "rental":
      return `/rentals/${e.id}`;
    case "maintenance":
      return `/maintenance/${e.id}`;
    case "insurance_end":
      return `/insurance/${e.id}`;
    case "itv":
      return `/vehicles/${e.id}?tab=documents`;
    case "fine_deadline":
      return `/fines/${e.id}`;
  }
}
