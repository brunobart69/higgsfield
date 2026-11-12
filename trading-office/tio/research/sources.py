"""Fontes de pesquisa (rodam no computador do usuário, com internet).

* YouTube Data API v3 — vídeos-aula (requer chave gratuita YOUTUBE_API_KEY);
* Wikipédia (pt/en) — definição de indicadores (sem chave);
* arXiv — estudos acadêmicos sobre análise técnica (sem chave).

Sem chave do YouTube, o pesquisador gera links de busca que o usuário abre no navegador.
Todo material recebe uma nota de credibilidade: conteúdo de opções binárias frequentemente
promete lucro garantido ou é propaganda de corretora/afiliado — isso é sinalizado, nunca
aceito como verdade. Ideias encontradas viram HIPÓTESES testadas no laboratório.
"""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Optional

from .indicators_lab import CATALOG

UA = {"User-Agent": "trading-intelligence-office/1.0 (pesquisa educacional)"}

QUERIES = [
    "opções binárias M1 price action aula", "opções binárias M5 estratégia explicada", "suporte e resistência M1 opções binárias",
    "gestão de risco opções binárias payout", "indicador estocástico opções binárias teste", "bandas de bollinger M1 estratégia",
    "liquidez e varredura price action aula", "fibonacci retração explicação trading", "backtest estratégia trading explicação",
    "martingale por que não funciona trading",
]

RED_FLAGS = [
    (r"\b(9\d|100)\s?%", "promete taxa de acerto irreal"), (r"sem\s+loss|nunca\s+perde|infal[ií]vel", "promete não perder"),
    (r"garantid", "lucro garantido"), (r"fique\s+rico|ficar\s+rico|renda\s+(extra|passiva)\s+f[aá]cil", "promessa de enriquecimento"),
    (r"lucro\s+(di[aá]rio|todo\s+dia)|r\$\s?\d+[\d.]*\s*(por|em)\s+(dia|minutos?)", "promessa de lucro diário"),
    (r"rob[oô]|bot\s+autom|sinais\s+vip|grupo\s+vip", "venda de robô/sinais"),
    (r"link\s+(na\s+)?(bio|descri)|cadastre|b[oô]nus|afiliad|c[oó]digo\s+promo", "propaganda de corretora/afiliado"),
    (r"martingale|soros|gale\b", "usa progressão de recuperação (martingale)"),
]
GOOD_SIGNS = [(r"backtest|estat[ií]stic", "menciona teste/estatística"), (r"gest[aã]o\s+de\s+risco|stop|risco", "fala de risco"),
              (r"explica|aula|conceito|fundamento", "foco educacional"), (r"perd[ae]|(?<!sem )loss|erro", "discute perdas")]


def credibility(text: str) -> dict:
    t = text.lower()
    flags = sorted({msg for pat, msg in RED_FLAGS if re.search(pat, t)})
    good = sorted({msg for pat, msg in GOOD_SIGNS if re.search(pat, t)})
    score = max(0.0, min(1.0, 0.5 + 0.1 * len(good) - 0.2 * len(flags)))
    label = "confiável para estudo" if score >= 0.6 and not flags else "usar com cautela" if score >= 0.35 else "suspeito"
    return {"score": round(score, 2), "label": label, "flags": flags, "good": good}


PARAM_PATTERNS = {
    "rsi": [r"(?:rsi|ifr)\s*(?:de\s*|\()?\s*(\d{1,2})"],
    "bollinger": [r"bollinger\D{0,12}(\d{1,2})\D{1,6}(\d(?:[.,]\d)?)"],
    "ema_cross": [r"(?:ema|mme|m[ée]dias?)\D{0,8}(\d{1,3})\D{1,6}(\d{1,3})"],
    "stochastic": [r"(?:estoc[aá]stico|stoch\w*)\D{0,6}(\d{1,2})"],
    "cci": [r"cci\D{0,4}(\d{1,2})"],
}


def extract_mentions(text: str) -> list[dict]:
    """Indicadores citados (e parâmetros, quando escritos) num título/descrição/texto."""
    t = " " + text.lower() + " "
    out = []
    for key, spec in CATALOG.items():
        if any(a in t for a in spec["aliases"]):
            params = {}
            for pat in PARAM_PATTERNS.get(key, []):
                m = re.search(pat, t)
                if not m:
                    continue
                g = [x.replace(",", ".") for x in m.groups()]
                try:
                    if key == "rsi" and 2 <= int(g[0]) <= 50:
                        params = {"n": int(g[0])}
                    elif key == "bollinger" and 5 <= int(g[0]) <= 60 and 0.5 <= float(g[1]) <= 4:
                        params = {"n": int(g[0]), "k": float(g[1])}
                    elif key == "ema_cross" and 2 <= int(g[0]) < int(g[1]) <= 300:
                        params = {"a": int(g[0]), "b": int(g[1])}
                    elif key == "stochastic" and 3 <= int(g[0]) <= 50:
                        params = {"n": int(g[0])}
                    elif key == "cci" and 5 <= int(g[0]) <= 60:
                        params = {"n": int(g[0])}
                except (ValueError, IndexError):
                    params = {}
            out.append({"key": key, "params": params})
    return out


def _get(url: str, timeout: int = 15) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def youtube_search(query: str, api_key: str, max_results: int = 8) -> list[dict]:
    q = urllib.parse.urlencode({"part": "snippet", "q": query, "type": "video", "maxResults": max_results,
                                "relevanceLanguage": "pt", "key": api_key})
    js = json.loads(_get(f"https://www.googleapis.com/youtube/v3/search?{q}"))
    out = []
    for it in js.get("items", []):
        sn = it["snippet"]
        vid = it["id"].get("videoId")
        if not vid:
            continue
        out.append({"source": "YouTube", "kind": "vídeo", "title": sn.get("title", ""), "channel": sn.get("channelTitle", ""),
                    "published": sn.get("publishedAt", ""), "url": f"https://www.youtube.com/watch?v={vid}",
                    "summary": sn.get("description", ""), "query": query})
    return out


def wikipedia_summary(term: str, lang: str = "pt") -> Optional[dict]:
    title = urllib.parse.quote(term.replace(" ", "_"))
    try:
        js = json.loads(_get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"))
    except Exception:
        return None
    if js.get("type") == "disambiguation" or not js.get("extract"):
        return None
    return {"source": f"Wikipédia ({lang})", "kind": "artigo", "title": js.get("title", term), "channel": "Wikipédia",
            "published": js.get("timestamp", ""), "url": js.get("content_urls", {}).get("desktop", {}).get("page", ""),
            "summary": js["extract"], "query": term}


def arxiv_search(query: str, max_results: int = 5) -> list[dict]:
    q = urllib.parse.urlencode({"search_query": f"all:{query}", "start": 0, "max_results": max_results})
    root = ET.fromstring(_get(f"http://export.arxiv.org/api/query?{q}"))
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out = []
    for e in root.findall("a:entry", ns):
        out.append({"source": "arXiv", "kind": "estudo acadêmico", "title": " ".join((e.findtext("a:title", "", ns)).split()),
                    "channel": ", ".join(a.findtext("a:name", "", ns) for a in e.findall("a:author", ns))[:120],
                    "published": e.findtext("a:published", "", ns), "url": e.findtext("a:id", "", ns),
                    "summary": " ".join((e.findtext("a:summary", "", ns)).split())[:1200], "query": query})
    return out


def youtube_search_link(query: str) -> str:
    return "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": query})


WIKI_TERMS = {"bollinger": ("Bandas de Bollinger", "pt"), "stochastic": ("Stochastic oscillator", "en"), "macd": ("MACD", "pt"),
              "cci": ("Commodity channel index", "en"), "williams": ("Williams %R", "en"), "rsi": ("Índice de força relativa", "pt"),
              "supertrend": ("Supertrend", "en"), "donchian": ("Donchian channel", "en"), "keltner": ("Keltner channel", "en"),
              "heikin": ("Heikin-Ashi", "en"), "psar": ("Parabolic SAR", "en"), "ichimoku": ("Ichimoku Kinkō Hyō", "en"),
              "adx": ("Average directional movement index", "en"), "ema_cross": ("Média móvel", "pt"), "ao": ("Awesome oscillator", "en"),
              "roc": ("Momentum (technical analysis)", "en")}
