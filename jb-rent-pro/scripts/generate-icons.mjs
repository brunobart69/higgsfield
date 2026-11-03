// Gera os ícones PNG do PWA a partir de public/icons/icon.svg (requer Playwright).
// Uso: node scripts/generate-icons.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const svg = await readFile(path.join(root, "public/icons/icon.svg"), "utf8");
const targets = [
  { file: "icon-192.png", size: 192, pad: 0.12 },
  { file: "icon-512.png", size: 512, pad: 0.12 },
  { file: "icon-maskable-512.png", size: 512, pad: 0.24 },
  { file: "apple-touch-icon.png", size: 180, pad: 0.14 },
];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { file, size, pad } of targets) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#1d1e22,#09090b 70%)">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg", `<svg width="${inner}" height="${inner}"`)}</div></body></html>`);
  await page.screenshot({ path: path.join(root, "public/icons", file), omitBackground: false });
  console.log("✔", file);
}
await browser.close();
