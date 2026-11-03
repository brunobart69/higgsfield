import { describe, expect, it } from "vitest";
import ptBR from "@/lib/i18n/dictionaries/pt-BR";
import esES from "@/lib/i18n/dictionaries/es-ES";
import { interpolate } from "@/lib/i18n/config";

function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}
function leaves(obj: unknown): Array<[string, string]> {
  if (typeof obj === "string") return [["", obj]];
  return Object.entries(obj as object).flatMap(([k, v]) => leaves(v).map(([p, s]) => [p ? `${k}.${p}` : k, s] as [string, string]));
}

describe("i18n", () => {
  it("pt-BR e es-ES têm exatamente as mesmas chaves", () => {
    expect(keys(esES).sort()).toEqual(keys(ptBR).sort());
  });

  it("nenhuma tradução vazia e mesmos placeholders", () => {
    const es = new Map(leaves(esES));
    for (const [key, pt] of leaves(ptBR)) {
      const other = es.get(key) ?? "";
      expect(pt.trim().length, key).toBeGreaterThan(0);
      expect(other.trim().length, key).toBeGreaterThan(0);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(other), key).toEqual(ph(pt));
    }
  });

  it("interpolação", () => {
    expect(interpolate("Olá, {name}", { name: "Ana" })).toBe("Olá, Ana");
    expect(interpolate("Fase {n}", {})).toBe("Fase {n}");
  });
});
