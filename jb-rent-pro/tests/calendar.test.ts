import { describe, expect, it } from "vitest";
import { barSpan, dayItems, hrefFor, monthMatrix, type CalEvent } from "@/lib/calendar/grid";

const ev = (o: Partial<CalEvent>): CalEvent => ({
  kind: "rental",
  id: "r1",
  vehicle_id: "v1",
  plate: "1234 LKM",
  title: "JB-2026-00015",
  subtitle: "Maria",
  starts_at: "2026-11-01T09:00:00Z",
  ends_at: "2026-11-05T09:00:00Z",
  all_day: false,
  status: "in_progress",
  ...o,
});

describe("grade do mês", () => {
  it("semanas de segunda a domingo cobrindo o mês", () => {
    const w = monthMatrix("2026-11");
    expect(w[0]![0]).toBe("2026-10-26"); // 1/11/2026 é domingo
    expect(w[0]![6]).toBe("2026-11-01");
    expect(w.at(-1)![6]! >= "2026-11-30").toBe(true);
    expect(w.every((x) => x.length === 7)).toBe(true);
    expect(monthMatrix("2027-02")[0]![0]).toBe("2027-02-01"); // começa numa segunda
  });
});

describe("itens por dia", () => {
  it("retirada e devolução no horário de Madri", () => {
    const m = dayItems([ev({})]);
    expect(m.get("2026-11-01")?.[0]).toMatchObject({ type: "pickup", time: "10:00" });
    expect(m.get("2026-11-05")?.[0]).toMatchObject({ type: "return", time: "10:00" });
  });
  it("oficina ocupa cada dia; prazos de multa no dia certo", () => {
    const m = dayItems([
      ev({ kind: "maintenance", id: "m1", all_day: true, starts_at: "2026-11-02T23:00:00Z", ends_at: "2026-11-04T23:00:00Z", status: "in_progress" }),
      ev({ kind: "fine_deadline", id: "f1", all_day: true, subtitle: "identification", starts_at: "2026-11-05T23:00:00Z", ends_at: "2026-11-06T23:00:00Z" }),
    ]);
    expect(m.get("2026-11-03")?.[0]?.type).toBe("maintenance");
    expect(m.get("2026-11-04")?.[0]?.type).toBe("maintenance");
    expect(m.get("2026-11-05")).toBeUndefined();
    expect(m.get("2026-11-06")?.[0]?.type).toBe("fine_identification");
  });
});

describe("linha do tempo", () => {
  it("recorta a barra no intervalo visível", () => {
    expect(barSpan(ev({}), "2026-11-03", 14)).toEqual({ from: 0, to: 2 });
    expect(barSpan(ev({}), "2026-10-30", 14)).toEqual({ from: 2, to: 6 });
    expect(barSpan(ev({}), "2026-11-10", 14)).toBeNull();
    // dia inteiro: fim exclusivo
    expect(barSpan(ev({ all_day: true, starts_at: "2026-11-02T23:00:00Z", ends_at: "2026-11-04T23:00:00Z" }), "2026-11-01", 7)).toEqual({ from: 2, to: 3 });
  });
  it("links por tipo", () => {
    expect(hrefFor(ev({}))).toBe("/rentals/r1");
    expect(hrefFor(ev({ kind: "itv", id: "v1" }))).toBe("/vehicles/v1?tab=documents");
  });
});
