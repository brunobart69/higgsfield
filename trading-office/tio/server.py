"""Servidor HTTP (biblioteca padrão) com API JSON e dashboard estático."""
from __future__ import annotations

import json
import mimetypes
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .models import ASSETS, TF_SECONDS
from .service import OfficeService

WEB = Path(__file__).resolve().parent / "web"


def make_handler(svc: OfficeService):
    class H(BaseHTTPRequestHandler):
        server_version = "TradingIntelligenceOffice/1.0"

        def log_message(self, fmt, *args):  # silencioso
            pass

        def _json(self, obj, code: int = 200):
            body = json.dumps(obj, ensure_ascii=False, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def do_GET(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                if u.path == "/api/status":
                    return self._json(svc.status())
                if u.path == "/api/agents":
                    return self._json(svc.agents_catalog())
                tf = q.get("tf") if q.get("tf") in TF_SECONDS else None
                if u.path == "/api/overview":
                    return self._json(svc.overview(tf))
                if u.path == "/api/scan":
                    return self._json(svc.scan(tf))
                if u.path == "/api/research":
                    return self._json(svc.research_view())
                if u.path == "/api/mistakes":
                    return self._json(svc.mistakes(q.get("mode") or None, int(q.get("since", 0) or 0)))
                if u.path == "/api/ranking":
                    return self._json(svc.ranking())
                if u.path == "/api/hours":
                    return self._json(svc.hours())
                if u.path == "/api/mt5":
                    return self._json(svc.mt5_info())
                if u.path == "/api/analysis":
                    asset = q.get("asset", "EURUSD").upper()
                    if asset not in ASSETS:
                        return self._json({"error": "ativo não monitorado"}, 400)
                    return self._json(svc.analyze(asset, tf))
                if u.path == "/api/history":
                    return self._json(svc.history())
                if u.path == "/api/news":
                    return self._json({"loaded": svc.news.loaded, "events": [e.to_dict() for e in svc.news.events[-200:]]})
                if u.path == "/api/memory":
                    return self._json(svc.memory_view())
                if u.path == "/api/job":
                    j = svc.jobs.get(q.get("id", ""))
                    return self._json(j or {"error": "job inexistente"}, 200 if j else 404)
                return self._static(u.path)
            except Exception as e:  # pragma: no cover
                traceback.print_exc()
                return self._json({"error": repr(e)}, 500)

        def do_POST(self):
            u = urlparse(self.path)
            try:
                body = self._body()
                if u.path == "/api/chat":
                    return self._json(svc.chat(body.get("message", "")))
                if u.path == "/api/backtest":
                    return self._json({"job": svc.start_job("backtest", lambda pr: svc.run_backtest(body, pr))})
                if u.path == "/api/learn":
                    return self._json({"job": svc.start_job("learn", lambda pr: svc.learn(body, pr))})
                if u.path == "/api/mt5/indicators":
                    return self._json(svc.mt5_select(body.get("names") or []))
                if u.path == "/api/mt5/open":
                    return self._json(svc.mt5_open(body.get("what", "editor")))
                if u.path == "/api/research/run":
                    return self._json({"job": svc.start_job("research", lambda pr: svc.run_research(body, pr))})
                if u.path == "/api/research/text":
                    return self._json(svc.research_from_text(body.get("text", ""), body.get("assets")))
                if u.path == "/api/research/key":
                    return self._json(svc.set_research_key(body.get("key", "")))
                if u.path == "/api/broker":
                    return self._json(svc.set_rules(body))
                if u.path == "/api/train":
                    return self._json({"job": svc.start_job("train", lambda pr: svc.train(body, pr))})
                if u.path == "/api/hours/filter":
                    return self._json(svc.set_hour_filter(body))
                if u.path == "/api/settings":
                    return self._json(svc.settings(body))
                if u.path == "/api/news/reload":
                    svc.news.reload()
                    svc._analysis.clear()
                    return self._json({"events": len(svc.news.events)})
                if u.path == "/api/execute":
                    return self._json({"error": "Execução com dinheiro real é proibida. Sistema educacional."}, 403)
                return self._json({"error": "rota inexistente"}, 404)
            except Exception as e:  # pragma: no cover
                traceback.print_exc()
                return self._json({"error": repr(e)}, 500)

        def _static(self, path: str):
            if path in ("", "/"):
                path = "/index.html"
            f = (WEB / path.lstrip("/")).resolve()
            if not str(f).startswith(str(WEB)) or not f.is_file():
                return self._json({"error": "não encontrado"}, 404)
            data = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", (mimetypes.guess_type(f.name)[0] or "application/octet-stream") + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return H


def serve(host: str = "127.0.0.1", port: int = 8765, svc: OfficeService | None = None, autopilot: bool = False) -> None:
    svc = svc or OfficeService()
    st = svc.status()
    if autopilot:
        svc.start_autopilot()
        print(f"Treino automático ligado: {len(st['assets'])} pares × {', '.join(svc.tfs)} (operações apenas simuladas)")
    print(f"AI Trading Intelligence Office em http://{host}:{port}")
    print(f"Fonte de dados: {st['source']}{'  [SINTÉTICO — não é mercado real]' if st['synthetic'] else ''}")
    ThreadingHTTPServer((host, port), make_handler(svc)).serve_forever()
