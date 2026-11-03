// Testes E2E de fumaça: login, navegação pelas telas principais (computador e celular),
// ausência de erros de página e de rolagem horizontal, proteção de rotas e exportações.
// Uso: npm run test:e2e   (veja e2e/run.sh)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const ROUTES = [
  "/dashboard", "/calendar", "/calendar?view=fleet&date=2026-11-01", "/notifications",
  "/rentals", "/rentals/eeeeeeee-0000-0000-0000-000000000001", "/rentals/new", "/customers", "/customers/cccccccc-0000-0000-0000-000000000001",
  "/deposits", "/inspections", "/vehicles", "/vehicles/aaaaaaaa-0000-0000-0000-000000000001",
  "/vehicles/aaaaaaaa-0000-0000-0000-000000000001?tab=maintenance", "/vehicles/aaaaaaaa-0000-0000-0000-000000000001?tab=fines",
  "/maintenance", "/maintenance?tab=plans", "/insurance", "/insurance/33330000-0000-4000-8000-000000000001",
  "/fines", "/fines?tab=accidents&all=1", "/fines/77770000-0000-4000-8000-000000000001", "/fines/accidents/88880000-0000-4000-8000-000000000001",
  "/documents", "/financial", "/financial?tab=entries", "/financial?tab=open", "/financial?tab=cashflow", "/assets",
  "/reports", "/reports?report=entries", "/reports?report=roi", "/users", "/activity", "/settings", "/account",
  "/portal", "/portal/rentals/eeeeeeee-0000-0000-0000-000000000001", "/portal/documents", "/portal/request",
];

const failures = [];
const fail = (m) => {
  failures.push(m);
  console.error("  ✗", m);
};

const browser = await chromium.launch();
try {
  // rotas protegidas sem sessão
  {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/dashboard`);
    if (!pg.url().includes("/login")) fail(`/dashboard sem sessão não redirecionou ao login (${pg.url()})`);
    await pg.goto(`${BASE}/portal`);
    if (!pg.url().includes("/portal/login")) fail(`/portal sem sessão não redirecionou ao login do portal (${pg.url()})`);
    const api = await ctx.request.get(`${BASE}/api/reports/pnl?format=csv`, { maxRedirects: 0 });
    if (api.status() < 300 || api.status() >= 400) fail(`/api/reports sem sessão deveria redirecionar (status ${api.status()})`);
    await ctx.close();
  }

  for (const [label, vp] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "pt-BR", timezoneId: "Europe/Madrid" });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(e.message));
    await pg.goto(`${BASE}/login`);
    await pg.fill("input[name=email]", "joao@jbrent.es");
    await pg.fill("input[name=password]", "SenhaForte123");
    await pg.click("button[type=submit]");
    await pg.waitForURL(/dashboard/, { timeout: 30000 });
    for (const r of ROUTES) {
      errors.length = 0;
      const res = await pg.goto(`${BASE}${r}`, { waitUntil: "networkidle" });
      const status = res?.status() ?? 0;
      if (status >= 400) fail(`[${label}] ${r} → HTTP ${status}`);
      const h1 = await pg.locator("h1").count();
      if (!h1) fail(`[${label}] ${r} sem título (h1)`);
      const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) fail(`[${label}] ${r} rolagem horizontal de ${overflow}px`);
      if (errors.length) fail(`[${label}] ${r} erro de página: ${errors[0]}`);
      if (!failures.length) process.stdout.write(".");
    }
    if (label === "desktop") {
      const csv = await ctx.request.get(`${BASE}/api/reports/entries?format=csv`);
      const body = await csv.text();
      if (!csv.headers()["content-type"]?.includes("text/csv") || !body.startsWith("﻿")) fail("exportação CSV inválida");
      const pdf = await ctx.request.get(`${BASE}/api/reports/pnl?format=pdf`);
      if (!(await pdf.body()).subarray(0, 5).toString().startsWith("%PDF")) fail("exportação PDF inválida");
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n✗ ${failures.length} falha(s) E2E` : `\n✔ E2E: ${ROUTES.length} telas × 2 tamanhos sem erros`);
process.exit(failures.length ? 1 : 0);
