import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Verificações estáticas de segurança executadas a cada `npm test`:
 * guardas nas Server Actions, rotas de API autenticadas, chave de serviço
 * isolada no servidor e nenhum segredo exposto ao navegador.
 */
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => relative(ROOT, f);

/** Corpo de cada função exportada (casamento de chaves simples). */
function exportedBodies(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = src.indexOf("{", src.indexOf(")", m.index));
    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    out.push({ name: m[1]!, body: src.slice(start, i + 1) });
  }
  return out;
}

describe("Server Actions", () => {
  const actionFiles = files.filter((f) => /^\s*["']use server["']/.test(read(f)));
  const PUBLIC = ["src/app/(auth)/actions.ts", "src/app/portal/login/actions.ts"];

  it("toda ação do painel verifica a sessão e o cargo (requireStaff/requireOwner)", () => {
    const missing: string[] = [];
    for (const f of actionFiles.filter((x) => !PUBLIC.includes(rel(x)) && !rel(x).startsWith("src/app/portal/"))) {
      const src = read(f);
      // funções internas já protegidas (ex.: saveCompanySection)
      const guardedHelpers = [...src.matchAll(/async function (\w+)[^{]*\{[^]*?require(?:Staff|Owner)\(/g)].map((x) => x[1]!);
      for (const { name, body } of exportedBodies(src)) {
        const ok = /require(Staff|Owner)\(/.test(body) || guardedHelpers.some((h) => new RegExp(`\\b${h}\\(`).test(body));
        if (!ok) missing.push(`${rel(f)} → ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("ações da área do cliente só usam funções do portal (controle no banco)", () => {
    for (const f of actionFiles.filter((x) => rel(x).startsWith("src/app/portal/(private)"))) {
      const src = read(f);
      expect(src).toMatch(/rpc\("portal_/);
      expect(src).not.toMatch(/\.from\("/);
    }
  });
});

describe("Rotas de API", () => {
  it("toda rota exige sessão da equipe ou posse verificada no banco (portal)", () => {
    const routes = files.filter((f) => rel(f).startsWith("src/app/api/") && f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(4);
    for (const f of routes) {
      const src = read(f);
      const staff = /getSession\(\)/.test(src) || /auth\.getUser\(\)/.test(src);
      const portal = /rpc\("portal_(owns_rental|file_path)"/.test(src);
      expect(staff || portal, rel(f)).toBe(true);
    }
  });
});

describe("Chave de serviço e segredos", () => {
  it("SUPABASE_SERVICE_ROLE_KEY só é lida no módulo do servidor", () => {
    const readers = files.filter((f) => read(f).includes("SUPABASE_SERVICE_ROLE_KEY") && /process\.env/.test(read(f)));
    expect(readers.map(rel)).toEqual(["src/lib/supabase/admin.ts"]);
    expect(read(join(SRC, "lib/supabase/admin.ts"))).toMatch(/import "server-only"/);
  });

  it("o cliente administrativo é usado apenas em pontos revisados", () => {
    const users = files.filter((f) => /createAdminClient\(/.test(read(f)) && !rel(f).endsWith("lib/supabase/admin.ts")).map(rel).sort();
    expect(users).toEqual(["src/app/(app)/customers/portal-actions.ts", "src/app/(app)/users/actions.ts", "src/app/api/portal/contract/[id]/route.ts"]);
  });

  it("nenhum componente do navegador importa módulos do servidor", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = read(f);
      if (!/^\s*["']use client["']/.test(src)) continue;
      // "import type" é apagado na compilação e pode ser usado livremente
      const valueImports = src.split("\n").filter((l) => /^import\s/.test(l) && !/^import\s+type\s/.test(l));
      if (valueImports.some((l) => /@\/lib\/supabase\/(admin|server)"|"server-only"|@\/lib\/[\w/]*queries"/.test(l))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });

  it("nenhuma variável pública com nome de segredo", () => {
    const pub = new Set(files.flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)].map((m) => m[0])));
    for (const v of pub) expect(v).not.toMatch(/SECRET|SERVICE|PASSWORD|PRIVATE/);
  });
});
