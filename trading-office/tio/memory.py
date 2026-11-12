"""Banco de conhecimento permanente (SQLite).

Toda informação gravada tem `available_at`: o instante (no tempo de mercado) em
que ela passa a ser conhecida. Consultas feitas durante um backtest filtram por
`available_at <= as_of`, impedindo que lições do futuro influenciem o passado.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any, Optional

from .indicators import wilson
from .params import ModelParams

DB_PATH = Path(os.environ.get("TIO_DB", Path(__file__).resolve().parents[1] / "data" / "office.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY, created TEXT, run_id TEXT, mode TEXT, asset TEXT, tf TEXT, as_of INTEGER,
  decision TEXT, direction INTEGER, confluence REAL, confluence_class TEXT, process_quality REAL,
  model_version TEXT, source TEXT, synthetic INTEGER, strategy TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY, decision_id INTEGER, run_id TEXT, mode TEXT, asset TEXT, tf TEXT, strategy TEXT,
  direction INTEGER, entry_ts INTEGER, entry_price REAL, expiry_ts INTEGER, exit_price REAL,
  result TEXT, payout REAL, stake REAL, pnl REAL, hour INTEGER, confluence REAL, confluence_class TEXT,
  process_quality REAL, review TEXT, synthetic INTEGER, status TEXT
);
CREATE TABLE IF NOT EXISTS agent_outcomes (
  id INTEGER PRIMARY KEY, decision_id INTEGER, trade_id INTEGER, run_id TEXT, mode TEXT, agent TEXT,
  asset TEXT, bias INTEGER, confidence REAL, correct INTEGER, available_at INTEGER
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY, created TEXT, run_id TEXT, mode TEXT, agent TEXT, asset TEXT, tag TEXT,
  outcome_class TEXT, description TEXT, decision_id INTEGER, trade_id INTEGER, available_at INTEGER
);
CREATE TABLE IF NOT EXISTS model_versions (
  id INTEGER PRIMARY KEY, version TEXT UNIQUE, parent TEXT, created TEXT, status TEXT, params TEXT,
  in_sample TEXT, out_sample TEXT, baseline_in TEXT, baseline_out TEXT, change TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, created TEXT, kind TEXT, title TEXT, body TEXT
);
CREATE TABLE IF NOT EXISTS backtests (
  id INTEGER PRIMARY KEY, created TEXT, run_id TEXT, config TEXT, metrics TEXT, synthetic INTEGER
);
CREATE TABLE IF NOT EXISTS fib_anchors (
  asset TEXT, tf TEXT, ref_ts INTEGER, low REAL, high REAL, dir INTEGER, created TEXT,
  PRIMARY KEY (asset, tf, ref_ts)
);
CREATE TABLE IF NOT EXISTS trading_mistakes (
  id INTEGER PRIMARY KEY, created TEXT, run_id TEXT, mode TEXT, asset TEXT, tf TEXT, direction INTEGER,
  signal_ts INTEGER, entry_ts INTEGER, expiry_ts INTEGER, entry_price REAL, exit_price REAL, result TEXT,
  hour INTEGER, condition TEXT, categories TEXT, cause TEXT, evidence TEXT, agents TEXT, meeting TEXT,
  learning TEXT, prevention TEXT, analysis TEXT, decision_id INTEGER, trade_id INTEGER, available_at INTEGER
);
CREATE TABLE IF NOT EXISTS research_items (
  id INTEGER PRIMARY KEY, created TEXT, source TEXT, kind TEXT, title TEXT, channel TEXT, published TEXT, url TEXT UNIQUE,
  summary TEXT, query TEXT, credibility TEXT, mentions TEXT
);
CREATE TABLE IF NOT EXISTS research_indicators (
  id INTEGER PRIMARY KEY, created TEXT, key TEXT, params TEXT, label TEXT, tf TEXT, status TEXT, reason TEXT,
  result TEXT, origin TEXT, UNIQUE(key, params, tf)
);
CREATE INDEX IF NOT EXISTS ix_mistakes ON trading_mistakes(asset, tf, direction, available_at);
CREATE INDEX IF NOT EXISTS ix_lessons ON lessons(agent, asset, tag, available_at);
CREATE INDEX IF NOT EXISTS ix_outcomes ON agent_outcomes(agent, available_at);
"""


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Memory:
    def __init__(self, path: Path | str | None = None, run_id: str = "live", mode: str = "live"):
        self.path = str(path or DB_PATH)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(agent_outcomes)")}
        for c, t in (("tf", "TEXT"), ("condition", "TEXT"), ("hour", "INTEGER")):
            if c not in cols:
                self.conn.execute(f"ALTER TABLE agent_outcomes ADD COLUMN {c} {t}")
        tcols = {r[1] for r in self.conn.execute("PRAGMA table_info(trades)")}
        for c, t in (("signal_ts", "INTEGER"), ("entry_source", "TEXT"), ("exit_source", "TEXT"), ("mfe", "REAL"),
                     ("mae", "REAL"), ("post_move", "REAL"), ("entry_delay_s", "INTEGER")):
            if c not in tcols:
                self.conn.execute(f"ALTER TABLE trades ADD COLUMN {c} {t}")
        self.conn.commit()
        self.lock = threading.RLock()
        self.run_id = run_id
        self.mode = mode
        self._ensure_baseline()
        self._agg: dict = {}        # agregados em memória: (run_id, agent) -> buckets
        self._agg_max_ts: dict = {}
        self._agg_loaded: set = set()

    # ------------------------------------------------------------ util
    def q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def x(self, sql: str, args: tuple = ()) -> int:
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur.lastrowid

    # ------------------------------------------------------------ versões
    def _ensure_baseline(self) -> None:
        if not self.q("SELECT 1 FROM model_versions LIMIT 1"):
            p = ModelParams()
            self.x("INSERT INTO model_versions(version,parent,created,status,params,change,notes) VALUES(?,?,?,?,?,?,?)",
                   ("v1.0", None, now_iso(), "active", json.dumps(p.to_dict()), "Metodologia inicial",
                    "Parâmetros iniciais definidos no projeto (RSI 80/20/50)."))

    def active_version(self) -> tuple[str, ModelParams]:
        r = self.q("SELECT version, params FROM model_versions WHERE status='active' ORDER BY id DESC LIMIT 1")[0]
        return r["version"], ModelParams.from_dict(json.loads(r["params"]))

    def versions(self) -> list[dict]:
        out = []
        for r in self.q("SELECT * FROM model_versions ORDER BY id DESC"):
            d = dict(r)
            for k in ("params", "in_sample", "out_sample", "baseline_in", "baseline_out"):
                d[k] = json.loads(d[k]) if d[k] else None
            out.append(d)
        return out

    def add_version(self, version: str, parent: str, params: ModelParams, status: str, change: str, notes: str,
                    ins: dict, oos: dict, base_in: dict, base_out: dict) -> None:
        with self.lock:
            if status == "active":
                self.conn.execute("UPDATE model_versions SET status='superseded' WHERE status='active'")
            self.conn.execute(
                "INSERT INTO model_versions(version,parent,created,status,params,in_sample,out_sample,baseline_in,baseline_out,change,notes)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (version, parent, now_iso(), status, json.dumps(params.to_dict()), json.dumps(ins), json.dumps(oos),
                 json.dumps(base_in), json.dumps(base_out), change, notes))
            self.conn.commit()

    def next_version(self) -> str:
        n = self.q("SELECT COUNT(*) AS n FROM model_versions")[0]["n"]
        return f"v1.{n}"

    # ------------------------------------------------------------ decisões/trades
    def record_decision(self, res: dict, strategy: str = "comite") -> int:
        return self.x(
            "INSERT INTO decisions(created,run_id,mode,asset,tf,as_of,decision,direction,confluence,confluence_class,"
            "process_quality,model_version,source,synthetic,strategy,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (now_iso(), self.run_id, self.mode, res["asset"], res["timeframe"], res["as_of"], res["decision"],
             res["direction"], res["confluence"]["score"], res["confluence"]["classification"],
             res["process"]["score"], res["model_version"], res["source"], int(res["synthetic"]), strategy,
             json.dumps(res, default=str) if self.mode == "live" else None))

    def open_trade(self, decision_id: int, t: dict) -> int:
        return self.x(
            "INSERT INTO trades(decision_id,run_id,mode,asset,tf,strategy,direction,entry_ts,entry_price,expiry_ts,"
            "payout,stake,hour,confluence,confluence_class,process_quality,synthetic,status)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (decision_id, self.run_id, self.mode, t["asset"], t["tf"], t["strategy"], t["direction"], t["entry_ts"],
             t.get("entry_price"), t["expiry_ts"], t["payout"], t["stake"], t["hour"], t["confluence"],
             t["confluence_class"], t["process_quality"], int(t["synthetic"]), "open"))

    def close_trade(self, trade_id: int, entry_price: float, exit_price: float, result: str, pnl: float, review: dict) -> None:
        self.x("UPDATE trades SET entry_price=?, exit_price=?, result=?, pnl=?, review=?, status='closed' WHERE id=?",
               (entry_price, exit_price, result, pnl, json.dumps(review, ensure_ascii=False), trade_id))

    def open_trades(self, asset: Optional[str] = None) -> list[sqlite3.Row]:
        if asset:
            return self.q("SELECT * FROM trades WHERE status='open' AND run_id=? AND asset=?", (self.run_id, asset))
        return self.q("SELECT * FROM trades WHERE status='open' AND run_id=?", (self.run_id,))

    def trades(self, limit: int = 200, mode: Optional[str] = None) -> list[dict]:
        sql = "SELECT * FROM trades"
        args: tuple = ()
        if mode:
            sql += " WHERE mode=?"
            args = (mode,)
        sql += " ORDER BY id DESC LIMIT ?"
        rows = self.q(sql, args + (limit,))
        out = []
        for r in rows:
            d = dict(r)
            d["review"] = json.loads(d["review"]) if d["review"] else None
            out.append(d)
        return out

    def recent_results(self, before_ts: int, limit: int = 20) -> list[sqlite3.Row]:
        return self.q("SELECT result, pnl, expiry_ts FROM trades WHERE run_id=? AND status='closed' AND expiry_ts<=? "
                      "ORDER BY expiry_ts DESC LIMIT ?", (self.run_id, before_ts, limit))

    def decisions(self, limit: int = 50) -> list[dict]:
        return [dict(r) for r in self.q(
            "SELECT id,created,mode,asset,tf,as_of,decision,direction,confluence,confluence_class,process_quality,"
            "model_version,source,synthetic,strategy FROM decisions WHERE mode='live' ORDER BY id DESC LIMIT ?", (limit,))]

    def decision_payload(self, decision_id: int) -> Optional[dict]:
        r = self.q("SELECT payload FROM decisions WHERE id=?", (decision_id,))
        return json.loads(r[0]["payload"]) if r and r[0]["payload"] else None

    # ------------------------------------------------------------ agentes
    def record_agent_outcome(self, decision_id: int, trade_id: int, agent: str, asset: str, bias: int,
                             confidence: float, correct: Optional[int], available_at: int, tf: Optional[str] = None,
                             condition: Optional[str] = None, hour: Optional[int] = None) -> None:
        if correct is not None:
            self._load_agg()
            b = self._agg.setdefault(self.run_id, {}).setdefault(agent, {}).setdefault(min(4, int(confidence * 5)), [0, 0])
            b[0] += correct
            b[1] += 1
            self._agg_max_ts[self.run_id] = max(self._agg_max_ts.get(self.run_id, 0), available_at)
        self.x("INSERT INTO agent_outcomes(decision_id,trade_id,run_id,mode,agent,asset,bias,confidence,correct,available_at,"
               "tf,condition,hour) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (decision_id, trade_id, self.run_id, self.mode, agent, asset, bias, confidence, correct, available_at,
                tf, condition, hour))

    def agent_stats(self, before: Optional[int] = None, mode: Optional[str] = None) -> dict[str, dict]:
        sql = "SELECT agent, correct, confidence FROM agent_outcomes WHERE correct IS NOT NULL"
        args: list[Any] = []
        if before is not None:
            sql += " AND available_at<=? AND run_id=?"
            args += [before, self.run_id]
        if mode:
            sql += " AND mode=?"
            args.append(mode)
        stats: dict[str, dict] = {}
        for r in self.q(sql, tuple(args)):
            s = stats.setdefault(r["agent"], {"n": 0, "hits": 0, "buckets": {}})
            s["n"] += 1
            s["hits"] += r["correct"]
            b = min(4, int(r["confidence"] * 5))
            bb = s["buckets"].setdefault(b, [0, 0])
            bb[0] += r["correct"]
            bb[1] += 1
        for s in stats.values():
            s["hit_rate"] = s["hits"] / s["n"] if s["n"] else None
            s["ci"] = wilson(s["hits"], s["n"])
        return stats

    def _load_agg(self) -> None:
        if self.run_id in self._agg_loaded:
            return
        self._agg_loaded.add(self.run_id)
        agg = self._agg.setdefault(self.run_id, {})
        for r in self.q("SELECT agent, confidence, correct, available_at FROM agent_outcomes WHERE run_id=? AND correct IS NOT NULL",
                        (self.run_id,)):
            b = agg.setdefault(r["agent"], {}).setdefault(min(4, int(r["confidence"] * 5)), [0, 0])
            b[0] += r["correct"]
            b[1] += 1
            self._agg_max_ts[self.run_id] = max(self._agg_max_ts.get(self.run_id, 0), r["available_at"])

    def calibration(self, agent: str, confidence: float, before: Optional[int], min_n: int = 30) -> dict:
        b = min(4, int(confidence * 5))
        self._load_agg()
        if before is None or self._agg_max_ts.get(self.run_id, 0) <= before:
            buckets = self._agg.get(self.run_id, {}).get(agent, {})
        else:  # há registros posteriores a `before`: consulta exata
            buckets = (self.agent_stats(before=before).get(agent) or {}).get("buckets", {})
        if b not in buckets:
            return {"n": 0, "calibrated": False, "note": "sem histórico suficiente"}
        hits, n = buckets[b]
        lo, hi = wilson(hits, n)
        return {"n": n, "hit_rate": hits / n, "ci": [lo, hi], "calibrated": n >= min_n,
                "note": "calibrado" if n >= min_n else f"amostra pequena (n={n} < {min_n})"}

    # ------------------------------------------------------------ lições
    def add_lesson(self, agent: str, asset: str, tag: str, outcome_class: str, description: str,
                   decision_id: Optional[int], trade_id: Optional[int], available_at: int) -> None:
        self.x("INSERT INTO lessons(created,run_id,mode,agent,asset,tag,outcome_class,description,decision_id,trade_id,available_at)"
               " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
               (now_iso(), self.run_id, self.mode, agent, asset, tag, outcome_class, description, decision_id,
                trade_id, available_at))

    def lesson_stats(self, agent: str, tags: list[str], before: int) -> dict[str, dict]:
        """Erros/acertos anteriores do agente em contextos semelhantes (somente passado)."""
        if not tags:
            return {}
        ph = ",".join("?" * len(tags))
        rows = self.q(f"SELECT tag, outcome_class, COUNT(*) AS n FROM lessons WHERE agent=? AND run_id=? AND "
                      f"available_at<=? AND tag IN ({ph}) GROUP BY tag, outcome_class",
                      (agent, self.run_id, before, *tags))
        out: dict[str, dict] = {}
        for r in rows:
            d = out.setdefault(r["tag"], {"erro": 0, "acerto": 0})
            d["erro" if r["outcome_class"] == "erro" else "acerto"] += r["n"]
        return out

    def lessons(self, limit: int = 100, mode: Optional[str] = "live") -> list[dict]:
        if mode:
            return [dict(r) for r in self.q("SELECT * FROM lessons WHERE mode=? ORDER BY id DESC LIMIT ?", (mode, limit))]
        return [dict(r) for r in self.q("SELECT * FROM lessons ORDER BY id DESC LIMIT ?", (limit,))]

    # ------------------------------------------------------------ Taxas Fibonacci (âncoras imutáveis)
    def fib_anchor(self, asset: str, tf: str, ref_ts: int, low: float, high: float, d: int) -> tuple:
        r = self.q("SELECT low, high, dir FROM fib_anchors WHERE asset=? AND tf=? AND ref_ts=?", (asset, tf, ref_ts))
        if r:
            return r[0]["low"], r[0]["high"], r[0]["dir"]
        self.x("INSERT OR IGNORE INTO fib_anchors VALUES(?,?,?,?,?,?,?)", (asset, tf, ref_ts, low, high, d, now_iso()))
        return low, high, d

    # ------------------------------------------------------------ TRADING MISTAKES DATABASE
    def add_mistake(self, m: dict) -> int:
        cols = ["created", "run_id", "mode", "asset", "tf", "direction", "signal_ts", "entry_ts", "expiry_ts", "entry_price",
                "exit_price", "result", "hour", "condition", "categories", "cause", "evidence", "agents", "meeting",
                "learning", "prevention", "analysis", "decision_id", "trade_id", "available_at"]
        row = {**m, "created": now_iso(), "run_id": self.run_id, "mode": m.get("mode") or self.mode}
        for k in ("categories", "evidence", "agents", "meeting", "prevention", "analysis"):
            row[k] = json.dumps(row.get(k), ensure_ascii=False, default=str)
        return self.x(f"INSERT INTO trading_mistakes({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                      tuple(row.get(c) for c in cols))

    def mistakes(self, limit: int = 100, mode: Optional[str] = None, since_id: int = 0) -> list[dict]:
        sql, args = "SELECT * FROM trading_mistakes WHERE id>?", [since_id]
        if mode:
            sql += " AND mode=?"
            args.append(mode)
        out = []
        for r in self.q(sql + " ORDER BY id DESC LIMIT ?", tuple(args + [limit])):
            d = dict(r)
            for k in ("categories", "evidence", "agents", "meeting", "prevention", "analysis"):
                d[k] = json.loads(d[k]) if d[k] else None
            out.append(d)
        return out

    def mistake_stats(self, asset: str, tf: str, direction: int, before: int, condition: Optional[str] = None) -> dict:
        """Perdas anteriores (somente passado, mesma execução) em situação semelhante, por categoria."""
        rows = self.q("SELECT categories, condition FROM trading_mistakes WHERE run_id=? AND available_at<=? AND tf=? "
                      "AND direction=? AND (asset=? OR ?='*')", (self.run_id, before, tf, direction, asset, asset))
        cats: dict = {}
        same_cond = 0
        for r in rows:
            for c in json.loads(r["categories"] or "[]"):
                cats[c] = cats.get(c, 0) + 1
            if condition and r["condition"] == condition:
                same_cond += 1
        return {"n": len(rows), "categories": cats, "same_condition": same_cond}

    # ------------------------------------------------------------ pesquisa (Agente 16)
    def add_research_item(self, it: dict) -> bool:
        try:
            self.x("INSERT INTO research_items(created,source,kind,title,channel,published,url,summary,query,credibility,mentions)"
                   " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   (now_iso(), it["source"], it["kind"], it["title"], it.get("channel"), it.get("published"), it["url"],
                    it.get("summary", "")[:2000], it.get("query"), json.dumps(it.get("credibility"), ensure_ascii=False),
                    json.dumps(it.get("mentions"), ensure_ascii=False)))
            return True
        except sqlite3.IntegrityError:
            return False

    def research_items(self, limit: int = 200) -> list[dict]:
        out = []
        for r in self.q("SELECT * FROM research_items ORDER BY id DESC LIMIT ?", (limit,)):
            d = dict(r)
            d["credibility"] = json.loads(d["credibility"]) if d["credibility"] else None
            d["mentions"] = json.loads(d["mentions"]) if d["mentions"] else []
            out.append(d)
        return out

    def save_research_indicator(self, res: dict, tf: str, origin: str) -> None:
        params = json.dumps(res["params"], sort_keys=True)
        self.x("INSERT INTO research_indicators(created,key,params,label,tf,status,reason,result,origin) VALUES(?,?,?,?,?,?,?,?,?)"
               " ON CONFLICT(key,params,tf) DO UPDATE SET created=excluded.created, status=excluded.status,"
               " reason=excluded.reason, result=excluded.result, origin=excluded.origin",
               (now_iso(), res["key"], params, res["label"], tf, res["status"], res["reason"],
                json.dumps(res, ensure_ascii=False, default=str), origin))

    def research_indicators(self, status: Optional[str] = None) -> list[dict]:
        sql, args = "SELECT * FROM research_indicators", ()
        if status:
            sql, args = sql + " WHERE status=?", (status,)
        out = []
        for r in self.q(sql + " ORDER BY id DESC", args):
            d = dict(r)
            d["params"] = json.loads(d["params"])
            d["result"] = json.loads(d["result"]) if d["result"] else None
            out.append(d)
        return out

    # ------------------------------------------------------------ relatórios
    def add_report(self, kind: str, title: str, body: dict) -> None:
        self.x("INSERT INTO reports(created,kind,title,body) VALUES(?,?,?,?)",
               (now_iso(), kind, title, json.dumps(body, ensure_ascii=False, default=str)))

    def reports(self, limit: int = 30) -> list[dict]:
        out = []
        for r in self.q("SELECT * FROM reports ORDER BY id DESC LIMIT ?", (limit,)):
            d = dict(r)
            d["body"] = json.loads(d["body"])
            out.append(d)
        return out

    def save_backtest(self, run_id: str, config: dict, metrics: dict, synthetic: bool) -> None:
        self.x("INSERT INTO backtests(created,run_id,config,metrics,synthetic) VALUES(?,?,?,?,?)",
               (now_iso(), run_id, json.dumps(config), json.dumps(metrics, default=str), int(synthetic)))

    def backtests(self, limit: int = 20) -> list[dict]:
        out = []
        for r in self.q("SELECT * FROM backtests ORDER BY id DESC LIMIT ?", (limit,)):
            d = dict(r)
            d["config"] = json.loads(d["config"])
            d["metrics"] = json.loads(d["metrics"])
            out.append(d)
        return out
