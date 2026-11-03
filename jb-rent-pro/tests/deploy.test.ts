import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "supabase");

describe("lotes de instalação (supabase/deploy)", () => {
  it("contêm todas as migrations, na ordem, sem alterações", () => {
    const migs = readdirSync(join(ROOT, "migrations")).sort();
    const bundles = ["1_install.sql", "2_install.sql", "3_install.sql"].map((f) => readFileSync(join(ROOT, "deploy", f), "utf8"));
    const all = bundles.join("\n");
    let pos = -1;
    for (const m of migs) {
      const body = readFileSync(join(ROOT, "migrations", m), "utf8");
      const at = all.indexOf(`-- >>>>> ${m}\n${body}`);
      expect(at, `${m} ausente ou desatualizada em supabase/deploy — regenere os lotes`).toBeGreaterThan(pos);
      pos = at;
    }
  });
  it("cada lote termina antes do uso de valores novos de enum", () => {
    const b1 = readFileSync(join(ROOT, "deploy", "1_install.sql"), "utf8");
    const b2 = readFileSync(join(ROOT, "deploy", "2_install.sql"), "utf8");
    expect(b1.trimEnd().endsWith("'accident_report';")).toBe(true);
    expect(b2.trimEnd()).toMatch(/'owner_withdrawal';[^\n]*$/);
  });
});
