"""Gera uma versão estática (um único HTML) do dashboard com respostas pré-calculadas.

Uso: python scripts/build_static_demo.py SAIDA.html [--provider synthetic|csv|...]
A página resultante não precisa de servidor: as chamadas /api/* são respondidas
por um instantâneo embutido. Backtest e aprendizado mostram resultados já calculados.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--provider", default="synthetic")
    args = ap.parse_args()
    os.environ["TIO_DB"] = str(Path(tempfile.mkdtemp()) / "demo.db")
    from tio.data.providers import get_provider
    from tio.memory import Memory
    from tio.models import ASSETS
    from tio.service import OfficeService

    TFS = ["M1", "M5", "M15"]
    svc = OfficeService(provider=get_provider(args.provider), memory=Memory(os.environ["TIO_DB"]), tfs=TFS)
    print("backtest…", file=sys.stderr)
    bt = svc.run_backtest({"assets": ["EURUSD"], "strategy": "comite", "expiry_bars": 4, "step": 4})
    print("aprendizado…", file=sys.stderr)
    svc.learn({"assets": ["EURUSD", "USDJPY", "EURJPY"], "step": 8, "min_trades": 30, "max_candidates": 3})
    print("treinamento…", file=sys.stderr)
    train = svc.train({"assets": ["EURUSD", "USDJPY"], "timeframe": "M1", "step": 3, "min_trades": 10, "study_mode": "1"})
    snap = {
        "status": svc.status(), "agents": svc.agents_catalog(), "overview": {t: svc.overview(t) for t in TFS},
        "analysis": {t: {a: svc.analyze(a, t) for a in ASSETS} for t in TFS},
        "scan": {t: svc.scan(t) for t in TFS}, "mt5": svc.mt5_info(), "hours": svc.hours(), "mistakes": svc.mistakes(), "ranking": svc.ranking(), "train": train, "history": svc.history(),
        "news": {"loaded": svc.news.loaded, "events": [e.to_dict() for e in svc.news.events[-200:]]},
        "memory": svc.memory_view(), "backtest": bt,
        "chat": {a: svc.chat(f"Qual é a situação do {a[:3]}/{a[3:]}?") for a in ASSETS},
        "chat_perf": svc.chat("desempenho dos agentes"), "chat_news": svc.chat("notícias"), "chat_help": svc.chat("oi"),
    }
    web = ROOT / "tio" / "web"
    html = (web / "index.html").read_text()
    body = html[html.index("<body>") + 6: html.index('<script src="app.js">')]
    os.environ.setdefault("TIO_DATA_DIR", tempfile.mkdtemp())
    css = (web / "style.css").read_text()
    css += """
:root { color-scheme: dark; }
body { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.top { top: env(safe-area-inset-top, 0px); margin-inline: calc(-1 * max(16px, env(safe-area-inset-left, 0px))); padding-inline: max(16px, env(safe-area-inset-left, 0px)); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 11; background: var(--bg); }
.tab { padding-left: 0; padding-right: 0; }
.banner { margin-left: 0; margin-right: 0; }
.demo { margin: 10px 0 0; padding: 10px 14px; border: 1px solid rgba(242,181,58,.45); background: rgba(242,181,58,.07); color: var(--amber); border-radius: 8px; font-size: 13px; }
"""
    shim = """
const SNAP = __SNAP__;
const _json = (o) => Promise.resolve(new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } }));
window.fetch = (url, opts) => {
  const u = new URL(String(url), "http://demo.local/"); const p = u.pathname; const q = u.searchParams;
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  if (p.endsWith("/api/status")) return _json(SNAP.status);
  if (p.endsWith("/api/agents")) return _json(SNAP.agents);
  const tf = SNAP.scan[q.get("tf")] ? q.get("tf") : "M15";
  if (p.endsWith("/api/overview")) return _json(SNAP.overview[tf]);
  if (p.endsWith("/api/scan")) return _json(SNAP.scan[tf]);
  if (p.endsWith("/api/mt5")) return _json(SNAP.mt5);
  if (p.endsWith("/api/hours")) return _json(SNAP.hours);
  if (p.endsWith("/api/mistakes")) return _json(q.get("mode") === "live" ? [] : SNAP.mistakes);
  if (p.endsWith("/api/ranking")) return _json(SNAP.ranking);
  if (p.endsWith("/api/train")) return _json({ job: "train" });
  if (p.endsWith("/api/broker")) return _json(SNAP.status.broker_rules);
  if (p.endsWith("/api/analysis")) return _json(SNAP.analysis[tf][q.get("asset")] || SNAP.analysis[tf].EURUSD);
  if (p.endsWith("/api/history")) return _json(SNAP.history);
  if (p.endsWith("/api/news")) return _json(SNAP.news);
  if (p.endsWith("/api/memory")) return _json(SNAP.memory);
  if (p.endsWith("/api/backtest")) return _json({ job: "bt" });
  if (p.endsWith("/api/learn")) return _json({ job: "learn" });
  if (p.endsWith("/api/job")) return _json(q.get("id") === "bt"
      ? { status: "done", progress: [], result: SNAP.backtest }
      : q.get("id") === "train" ? { status: "done", progress: SNAP.train.stages.map((s) => `Ciclo ${s.n}/10 · ${s.name}: ${s.text}`), result: SNAP.train }
      : { status: "done", progress: [], result: {} });
  if (p.endsWith("/api/chat")) {
    const m = (body.message || "").toUpperCase();
    const hit = m.match(/([A-Z]{3})\\s*[\\/\\-]?\\s*([A-Z]{3})/g) || [];
    for (const h of hit) { const k = h.replace(/[^A-Z]/g, ""); if (SNAP.chat[k]) return _json(SNAP.chat[k]); }
    if (/DESEMPENHO|AGENTES|ACERTO/.test(m)) return _json(SNAP.chat_perf);
    if (/NOT[IÍ]CIA|CALEND/.test(m)) return _json(SNAP.chat_news);
    return _json(SNAP.chat_help);
  }
  return _json({ error: "indisponível na demonstração" });
};
""".replace("__SNAP__", json.dumps(snap, ensure_ascii=False, default=str).replace("</", "<\\/"))
    demo_note = ('<div class="demo">Versão de demonstração: esta página mostra um instantâneo já calculado pelo sistema. '
                 'O Laboratório exibe um backtest pré-calculado (EUR/USD, M15) e o chat responde sobre os 8 ativos '
                 'monitorados. A ligação com o MT5 e o treino automático só funcionam no programa instalado. Para análises novas e dados reais, o programa precisa rodar num computador.</div>')
    body = body.replace('<div id="banner"', demo_note + '\n<div id="banner"', 1)
    page = f"""<title>Trading Intelligence Office</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>{css}</style>
{body}
<script>{shim}</script>
<script>{(web / "app.js").read_text()}</script>
<script>{(web / "office.js").read_text()}</script>
"""
    Path(args.out).write_text(page)
    print(f"{args.out}: {len(page) / 1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
