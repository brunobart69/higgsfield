/* JB RENT PRO — service worker
 * Estratégia conservadora: NUNCA armazena páginas autenticadas nem respostas
 * da API (dados pessoais / financeiros). Apenas recursos estáticos versionados
 * do Next (/_next/static) e ícones são cacheados. Sem rede, navegações mostram
 * uma página offline mínima.
 */
const VERSION = "jbrent-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_HTML = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JB RENT PRO</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#f5f5f4;font-family:system-ui;text-align:center;padding:24px"><div><div style="font-weight:600;letter-spacing:.2em;color:#c9a24b">JB RENT PRO</div><p>Sem conexão com a internet. / Sin conexión a internet.</p></div></body></html>`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      ),
    );
  }
});
