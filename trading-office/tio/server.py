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


class Boot:
    """Estado da inicialização: o site responde desde o primeiro segundo, mesmo antes de o escritório carregar."""

    def __init__(self, svc=None):
        self.svc = svc
        self.stage = "iniciando"
        self.error = None
        self.log: list[str] = []

    def step(self, text: str) -> None:
        self.stage = text
        self.log.append(text)
        print(" ·", text, flush=True)


LOADING = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trading Intelligence Office</title><meta http-equiv="refresh" content="{refresh}">
<style>body{{margin:0;background:#07090b;color:#d9e1e7;font:15px/1.5 system-ui,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh}}
.b{{max-width:760px;padding:24px}}h1{{font-size:18px;color:#19d27c}}pre{{white-space:pre-wrap;background:#141a1f;border:1px solid #2a343c;padding:12px;border-radius:8px;color:#ffb3bb;font-size:12px}}
li{{color:#7d8a95}}</style></head><body><div class="b"><h1>{title}</h1><p>{msg}</p><ul>{log}</ul>{err}</div></body></html>"""


def make_handler(svc_or_boot):
    box = svc_or_boot if isinstance(svc_or_boot, Boot) else Boot(svc_or_boot)

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

        def _loading(self):
            import html as _h
            log = "".join(f"<li>{_h.escape(x)}</li>" for x in box.log[-12:])
            if box.error:
                page = LOADING.format(refresh=30, title="O escritório não conseguiu iniciar",
                                      msg="Tire uma foto desta tela e envie. O erro abaixo mostra exatamente o que falhou.",
                                      log=log, err=f"<pre>{_h.escape(box.error)}</pre>")
            else:
                page = LOADING.format(refresh=2, title="Abrindo o escritório…",
                                      msg=f"Carregando: {_h.escape(box.stage)}. Esta página atualiza sozinha.", log=log, err="")
            if urlparse(self.path).path.startswith("/api/"):
                return self._json({"error": box.error or f"carregando: {box.stage}"}, 503)
            data = page.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            svc = box.svc
            if svc is None:
                return self._loading()
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
                if u.path == "/api/markings":
                    return self._json(svc.markings(q.get("asset", "EURUSD").upper(), tf or svc.base_tf))
                if u.path == "/api/research":
                    return self._json(svc.research_view())
                if u.path == "/api/mistakes":
                    return self._json(svc.mistakes(q.get("mode") or None, int(q.get("since", 0) or 0)))
                if u.path == "/api/ranking":
                    return self._json(svc.ranking())
                if u.path == "/api/hours":
                    return self._json(svc.hours())
                if u.path == "/api/mt5/diagnose":
                    return self._json(svc.mt5_diagnose(q.get("asset")))
                if u.path == "/api/mt5":
                    return self._json(svc.mt5_info())
                if u.path == "/api/analysis":
                    asset = q.get("asset", "EURUSD").upper()
                    if asset not in svc.assets and asset not in ASSETS:
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
            svc = box.svc
            if svc is None:
                return self._loading()
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


def serve(host: str = "127.0.0.1", port: int = 8765, svc: OfficeService | None = None, autopilot: bool = False,
          factory=None, open_browser: bool = False) -> None:
    """Liga o site PRIMEIRO (página de carregamento) e carrega o escritório em segundo plano.

    Erros de inicialização aparecem na própria página (e em data/tio.log), em vez de fechar a janela.
    Se a porta estiver ocupada (ex.: janela antiga aberta), usa a próxima livre.
    """
    import threading
    import webbrowser
    box = Boot(svc)
    httpd = None
    for p in range(port, port + 15):
        try:
            httpd = ThreadingHTTPServer((host, p), make_handler(box))
            port = p
            break
        except OSError:
            print(f"Porta {p} ocupada (talvez uma janela antiga do escritório ainda esteja aberta); tentando a próxima…")
    if httpd is None:
        raise SystemExit("Nenhuma porta livre entre 8765 e 8780. Feche as janelas antigas do escritório e tente de novo.")
    url = f"http://{host}:{port}"
    print(f"AI Trading Intelligence Office em {url}", flush=True)
    print(f"Se o navegador não abrir sozinho, abra este endereço: {url}", flush=True)

    def init():
        try:
            if box.svc is None:
                box.step("conectando à fonte de dados")
                box.svc = None
                s = factory()
            else:
                s = box.svc
            box.step("carregando gráficos e temporalidades")
            st = s.status()
            if autopilot:
                s.start_autopilot()
                box.step(f"treino automático ligado: {len(st['assets'])} pares × {', '.join(s.tfs)} (operações apenas simuladas)")
            box.step(f"fonte de dados: {st['source']}" + ("  [SINTÉTICO — não é mercado real]" if st["synthetic"] else ""))
            box.svc = s
            box.step("pronto")
        except BaseException:
            box.error = traceback.format_exc()
            print(box.error, flush=True)
            try:
                from .data.providers import DATA_DIR
                (DATA_DIR / "tio.log").write_text(box.error, encoding="utf-8")
            except Exception:
                pass

    threading.Thread(target=init, daemon=True).start()
    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
