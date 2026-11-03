import { describe, expect, it } from "vitest";
import { chartWindow, endOfMonth, isIsoDate, resolvePeriod, todayInMadrid } from "@/lib/periods";

// 31/12/2026 23:30 UTC = 01/01/2027 00:30 em Madrid (CET, UTC+1)
const newYearMadrid = new Date("2026-12-31T23:30:00Z");
// 15/03/2026 12:00 UTC
const mid = new Date("2026-03-15T12:00:00Z");

describe("periods (Europe/Madrid)", () => {
  it("usa a data civil de Madrid e não UTC", () => {
    expect(todayInMadrid(newYearMadrid)).toBe("2027-01-01");
    // horário de verão: 30/06 22:30 UTC = 01/07 00:30 CEST
    expect(todayInMadrid(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
  });

  it("resolve os filtros do dashboard", () => {
    expect(resolvePeriod("today", undefined, mid)).toMatchObject({ from: "2026-03-15", to: "2026-03-15" });
    expect(resolvePeriod("last7", undefined, mid)).toMatchObject({ from: "2026-03-09", to: "2026-03-15" });
    expect(resolvePeriod("last30", undefined, mid)).toMatchObject({ from: "2026-02-14", to: "2026-03-15" });
    expect(resolvePeriod("thisMonth", undefined, mid)).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(resolvePeriod("lastMonth", undefined, mid)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolvePeriod("thisYear", undefined, mid)).toMatchObject({ from: "2026-01-01", to: "2026-03-15" });
    expect(resolvePeriod("lastMonth", undefined, newYearMadrid)).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("valida o período personalizado", () => {
    expect(resolvePeriod("custom", { from: "2026-01-10", to: "2026-02-05" }, mid)).toMatchObject({
      key: "custom",
      from: "2026-01-10",
      to: "2026-02-05",
    });
    // invertido ou inválido → este mês
    expect(resolvePeriod("custom", { from: "2026-02-05", to: "2026-01-10" }, mid).key).toBe("thisMonth");
    expect(resolvePeriod("custom", { from: "2026-02-30", to: "2026-03-01" }, mid).key).toBe("thisMonth");
    expect(resolvePeriod("custom", { from: "'; drop table", to: "x" }, mid).key).toBe("thisMonth");
  });

  it("calcula fim de mês e anos bissextos", () => {
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(isIsoDate("2026-02-29")).toBe(false);
  });

  it("janela de gráficos = 12 meses", () => {
    expect(chartWindow({ from: "2026-03-01", to: "2026-03-15" })).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });
});
