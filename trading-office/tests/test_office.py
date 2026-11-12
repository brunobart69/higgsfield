import json

import pytest

from tio import binary
from tio.agents import RiskManager
from tio.backtest import BTConfig, improvement_cycle, run
from tio.context import MarketData
from tio.data.news import NewsStore
from tio.data.providers import CSVProvider, SyntheticProvider, resample, save_csv
from tio.meeting import Office
from tio.memory import Memory
from tio.models import DECISIONS, Series
from tio.params import ModelParams

END = 1_762_900_000  # instante fixo para reprodutibilidade


@pytest.fixture(scope="module")
def data():
    return MarketData.load(SyntheticProvider(bars=3000, end=END), "EURUSD", "M15")


def strip(res):
    res = json.loads(json.dumps(res, default=str))
    for r in res["reports"]:
        r.pop("calibrated", None)
    res.pop("confluence")["calibration"]
    return res


def test_no_lookahead(data):
    """A análise em t deve ser idêntica com ou sem candles posteriores a t."""
    i = 2000
    as_of = data.base[i].close_ts
    truncated = MarketData("EURUSD", Series("EURUSD", "M15", data.base[: i + 1], data.source, True, "tick"))
    p = ModelParams()
    a = Office().meet(data.context(as_of, None, Memory(":memory:"), p))
    b = Office().meet(truncated.context(as_of, None, Memory(":memory:"), p))
    assert strip(a) == strip(b)


def test_higher_tf_only_closed(data):
    as_of = data.base[1500].close_ts
    for tf in ("H1", "H4", "D1", "W1"):
        cs = data.closed(tf, as_of)
        assert all(c.close_ts <= as_of for c in cs)


def test_resample_drops_open_candle(data):
    as_of = data.base[1001].close_ts  # meio de um candle H4
    h4 = resample(data.base[:1002], "H4", as_of)
    assert h4[-1].close_ts <= as_of


def test_decision_is_valid(data):
    res = Office().meet(data.context(None, None, Memory(":memory:"), ModelParams()))
    assert res["decision"] in DECISIONS
    assert res["synthetic"] is True and "SINTÉTICO" in res["source"]
    assert "NÃO é probabilidade" in res["confluence"]["disclaimer"]
    assert len(res["reports"]) == 13
    assert res["transcript"][-1]["kind"] == "decision"


def test_news_agent_abstains_without_calendar(data, tmp_path):
    res = Office().meet(data.context(None, NewsStore(tmp_path), None, ModelParams()))
    news = next(r for r in res["reports"] if r["agent"] == "NEWS")
    assert news["abstain"] and "não invento" in news["summary"]


def test_news_without_source_is_discarded(tmp_path):
    (tmp_path / "x.json").write_text(json.dumps([
        {"datetime": "2026-01-01T13:30:00Z", "currency": "USD", "impact": "high", "title": "CPI"},
        {"datetime": "2026-01-01T13:30:00Z", "currency": "USD", "impact": "high", "title": "CPI", "source": "BLS"}]))
    st = NewsStore(tmp_path)
    assert len(st.events) == 1 and st.events[0].source == "BLS"


def test_high_impact_news_blocks(data, tmp_path):
    as_of = data.base[-1].close_ts
    import datetime as dt
    when = dt.datetime.fromtimestamp(as_of + 600, dt.timezone.utc).isoformat()
    (tmp_path / "n.json").write_text(json.dumps([{"datetime": when, "currency": "USD", "impact": "high",
                                                  "title": "Non-Farm Payrolls", "source": "teste"}]))
    res = Office().meet(data.context(as_of, NewsStore(tmp_path), None, ModelParams()))
    assert res["news_avoid"] and not res["decision"].startswith("CENÁRIO")


def test_settle_binary():
    from tio.models import Candle
    base = [Candle(t * 900, 1.0 + t * 0.001, 1.01 + t * 0.001, 0.99 + t * 0.001, 1.0005 + t * 0.001, 0, (t + 1) * 900) for t in range(10)]
    o = [c.ts for c in base]
    c = [x.close_ts for x in base]
    win = binary.settle(base, o, c, 1, 900, 900 * 4, 0.8)
    assert win["result"] == "WIN" and win["pnl"] == pytest.approx(0.8)
    loss = binary.settle(base, o, c, -1, 900, 900 * 4, 0.8)
    assert loss["result"] == "LOSS" and loss["pnl"] == -1
    assert binary.settle(base, o, c, 1, 900, 900 * 40, 0.8) is None  # sem dados até a expiração


def test_real_money_forbidden():
    assert binary.REAL_MONEY_ENABLED is False
    with pytest.raises(PermissionError):
        binary.execute_real_order()


def test_risk_rejects_martingale(data):
    ctx = data.context(None, None, Memory(":memory:"), ModelParams())
    draft = {"confluence": {"classification": "ALTA", "score": 80}, "news_avoid": False}
    assert RiskManager().review(ctx, draft, "comite", stake_multiplier=2.0)["approved"] is False


def test_backtest_and_memory_isolation(data):
    m = run({"EURUSD": data}, BTConfig(assets=["EURUSD"], step=12, warmup=450), ModelParams())
    assert m["steps"] > 50 and m["synthetic"]
    assert sum(m["decisions"].values()) == m["steps"]
    for k in ("win_rate", "expectancy", "max_drawdown", "by_hour", "by_asset", "agents"):
        assert k in m
    main = Memory(":memory:")
    assert main.lessons(mode=None) == []  # backtest não escreve no banco principal


def test_improvement_cycle_requires_oos(data):
    mem = Memory(":memory:")
    rep = improvement_cycle({"EURUSD": data}, mem, step=24, min_trades=10_000, max_candidates=2)
    assert rep["promoted"] is None
    assert all(c["status"] == "rejected" for c in rep["candidates"])
    assert mem.active_version()[0] == "v1.0"


def test_csv_roundtrip(tmp_path, data):
    s = Series("EURUSD", "M15", data.base[:100], "teste", False, "none")
    save_csv(s, tmp_path)
    back = CSVProvider(tmp_path).load("EURUSD", "M15")
    assert len(back) == 100 and back.source == "teste" and back.candles[5].close == pytest.approx(s.candles[5].close)


def test_mt5_provider_with_fake_terminal(monkeypatch):
    """Simula o pacote MetaTrader5: converte horário do servidor para UTC e só lê dados."""
    import sys
    import time
    import types
    import numpy as np
    now = int(time.time())
    off = 2 * 3600  # servidor da corretora em UTC+2
    start = (now - now % 900) - 900 * 600
    rows = np.array([(start + i * 900 + off, 1.1, 1.101, 1.099, 1.1005, 50, 0, 0) for i in range(600)],
                    dtype=[("time", "i8"), ("open", "f8"), ("high", "f8"), ("low", "f8"), ("close", "f8"),
                           ("tick_volume", "i8"), ("spread", "i4"), ("real_volume", "i8")])
    calls = []
    fake = types.SimpleNamespace(
        TIMEFRAME_M1=1, TIMEFRAME_M5=5, TIMEFRAME_M15=15, TIMEFRAME_M30=30, TIMEFRAME_H1=60, TIMEFRAME_H4=240,
        TIMEFRAME_D1=1440, TIMEFRAME_W1=10080, TIMEFRAME_MN1=43200,
        initialize=lambda: True, last_error=lambda: None,
        account_info=lambda: types.SimpleNamespace(server="Corretora-Demo"), terminal_info=lambda: None,
        symbol_info=lambda s: None, symbols_get=lambda: [types.SimpleNamespace(name="EURUSDm")],
        symbol_select=lambda s, v: True,
        symbol_info_tick=lambda s: types.SimpleNamespace(time=now + off),
        copy_rates_from_pos=lambda s, tf, a, n: (calls.append(s), rows)[1],
        order_send=lambda *a: (_ for _ in ()).throw(AssertionError("ordem enviada!")),
    )
    monkeypatch.setitem(sys.modules, "MetaTrader5", fake)
    from tio.data.providers import MT5Provider
    p = MT5Provider()
    s = p.load("EURUSD", "M15")
    assert calls == ["EURUSDm"]
    assert s.candles[0].ts == start and s.volume_kind == "tick"
    assert "MetaTrader 5" in s.source and "Corretora-Demo" in s.source and not s.synthetic
    md = MarketData.load(p, "EURUSD", "M15")
    assert md.base[-1].close_ts <= now  # candle em formação descartado


def test_mt5_user_indicators_flow(monkeypatch, tmp_path):
    """Exportador do MT5 simulado: lista indicadores, grava config, lê setas e detecta repaint."""
    import sys
    import time
    import types
    import numpy as np
    from tio.data import mt5_indicators as mi
    now = int(time.time())
    sec = 900
    last_open = (now - now % sec) - sec            # última vela M15 fechada
    start = last_open - sec * 799
    rng = np.random.default_rng(1)
    closes = 1.1 + np.cumsum(rng.normal(0, 0.0004, 800))
    rows = np.array([(start + i * sec, closes[i] - 0.0001, closes[i] + 0.0006, closes[i] - 0.0006, closes[i], 50, 0, 0)
                     for i in range(800)] + [(last_open + sec, closes[-1], closes[-1], closes[-1], closes[-1], 1, 0, 0)],
                    dtype=[("time", "i8"), ("open", "f8"), ("high", "f8"), ("low", "f8"), ("close", "f8"),
                           ("tick_volume", "i8"), ("spread", "i4"), ("real_volume", "i8")])
    data_dir, common = tmp_path / "data", tmp_path / "common"
    (data_dir / "MQL5" / "Indicators" / "Setas").mkdir(parents=True)
    (data_dir / "MQL5" / "Indicators" / "Setas" / "Sinal.ex5").write_bytes(b"x")
    fake = types.SimpleNamespace(
        TIMEFRAME_M1=1, TIMEFRAME_M5=5, TIMEFRAME_M15=15, TIMEFRAME_M30=30, TIMEFRAME_H1=60, TIMEFRAME_H4=240,
        TIMEFRAME_D1=1440, TIMEFRAME_W1=10080, TIMEFRAME_MN1=43200,
        initialize=lambda: True, last_error=lambda: None,
        account_info=lambda: types.SimpleNamespace(server="Demo"),
        terminal_info=lambda: types.SimpleNamespace(company="X", data_path=str(data_dir), commondata_path=str(common),
                                                    path=str(tmp_path)),
        symbol_info=lambda s: object() if s == "EURUSD" else None, symbols_get=lambda: [], symbol_select=lambda s, v: True,
        symbol_info_tick=lambda s: types.SimpleNamespace(time=now),
        copy_rates_from_pos=lambda s, tf, a, n: rows if tf == 15 else None,
    )
    monkeypatch.setitem(sys.modules, "MetaTrader5", fake)
    monkeypatch.setattr(mi, "CONFIG_PATH", tmp_path / "cfg.json")
    from tio.data.providers import MT5Provider
    from tio.service import OfficeService
    p = MT5Provider()
    assert (data_dir / "MQL5" / "Experts" / "TIO_Exportador.mq5").exists()   # exportador instalado
    assert p.list_indicators() == ["Setas\\Sinal"]
    svc = OfficeService(provider=p, memory=Memory(":memory:"))
    svc.mt5_select(["Setas\\Sinal", "inexistente"])
    cfg = (common / "Files" / "TIO" / "config.txt").read_text()
    assert "indicators=Setas\\Sinal\n" in cfg and "symbols=EURUSD" in cfg
    # exportação: buffer 0 = seta abaixo da mínima (compra) esparsa, buffer 1 = média (linha)
    lines = ["time,b0,b1"]
    for i, r in enumerate(rows[:-1]):
        arrow = f"{r['low'] - 0.0003:.5f}" if i % 7 == 0 or r["time"] == last_open else ""
        lines.append(f"{r['time']},{arrow},{r['close'] - 0.0002:.5f}")
    d = common / "Files" / "TIO"
    (d / "Setas_Sinal_EURUSD_M15.csv").write_text("\n".join(lines))
    # registro ao vivo divergente em 6 de 20 barras => indicador redesenha
    live = ["time,b0,b1"] + [f"{r['time']},{'' if i % 7 == 0 else '1.0'},1.1" for i, r in enumerate(rows[-21:-1])]
    (d / "live_Setas_Sinal_EURUSD_M15.csv").write_text("\n".join(live))
    res = svc.analyze("EURUSD", "M15")
    rep = next(r for r in res["reports"] if r["agent"] == "MT5I")
    assert not rep["abstain"]
    info = rep["data"]["indicators"]["Setas_Sinal"]
    assert info["roles"]["0"] == "seta de COMPRA" and info["roles"]["1"] == "linha de preço"
    assert any(e["kind"] == "user_line" for e in rep["evidence"])
    assert any("REDESENHA" in w for w in rep["warnings"])


def test_hours_and_filter(tmp_path):
    from pathlib import Path
    from tio.service import OfficeService
    OfficeService.PREFS_PATH = tmp_path / "prefs.json"
    mem = Memory(":memory:")
    svc = OfficeService(provider=SyntheticProvider(bars=1500, end=END), memory=mem)
    for h, res in ((8, "WIN"), (8, "WIN"), (8, "LOSS"), (15, "LOSS")):
        ts = END - END % 86400 + h * 3600
        mem.x("INSERT INTO trades(mode,run_id,asset,tf,direction,entry_ts,entry_price,exit_price,result,status) "
              "VALUES('live','live','EURUSD','M15',1,?,1.0,?,?,'closed')", (ts, 1.1 if res == "WIN" else 0.9, res))
    g = svc.hours()["grid"]
    assert g["M15"][8]["trades"]["wins"] == 2 and g["M15"][8]["trades"]["n"] == 3
    assert g["TODAS"][15]["trades"]["n"] == 1
    assert svc.set_hour_filter({"enabled": True, "hours": [8, 9]})["enabled"]
    assert svc.params()[1].allowed_hours == [8, 9]
    OfficeService.PREFS_PATH = None


def test_trendline_detection():
    from tio.indicators import Swing, trend_lines
    from tio.models import Candle
    # fundos ascendentes alinhados (3 toques) e preço acima da linha
    cs = [Candle(i * 900, 1 + i * 0.001, 1.003 + i * 0.001, 0.999 + i * 0.001, 1.002 + i * 0.001) for i in range(60)]
    sw = [Swing(i, i * 900, cs[i].low, "L") for i in (5, 20, 35, 50)]
    lines = trend_lines(cs, sw, 0.002)
    assert lines and lines[0].kind == "LTA" and lines[0].touches >= 3


def _dec(as_of, d=1):
    return {"asset": "EURUSD", "as_of": as_of, "direction": d, "synthetic": True,
            "confluence": {"score": 70, "classification": "ALTA"}, "process": {"score": 0.7}}


def test_ticket_timing_matches_broker_examples():
    import datetime as dt
    t0 = int(dt.datetime(2026, 11, 10, 10, 30, tzinfo=dt.timezone.utc).timestamp())
    r = binary.BrokerRules(entry_delay_s=15)
    # M1: sinal no fechamento 10:30:00, entrada 10:30:15, expira 10:31:00
    t = binary.plan_ticket(_dec(t0), "M1", r, has_ticks=True)
    assert t["ok"] and t["entry_ts"] == t0 + 15 and t["expiry_ts"] == t0 + 60
    # M5: sinal no fechamento da vela M1 de 10:31 (= 10:32:00), sem atraso → entrada 10:32, expira 10:35
    t = binary.plan_ticket(_dec(t0 + 120), "M5", binary.BrokerRules(entry_delay_s=0), has_ticks=True)
    assert t["ok"] and t["entry_ts"] == t0 + 120 and t["expiry_ts"] == t0 + 300
    # M5 com pouco tempo restante (10:34) não abre ticket
    assert not binary.plan_ticket(_dec(t0 + 240), "M5", r, has_ticks=True)["ok"]
    # sem ticks, a entrada nunca usa abertura de vela depois da abertura: vai para a fronteira exata de minuto
    t = binary.plan_ticket(_dec(t0), "M1", r, has_ticks=False)
    assert t["entry_ts"] % 60 == 0


def test_settle_uses_price_at_entry_instant():
    from tio.models import Candle
    t0 = 1_700_000_040 - 1_700_000_040 % 60
    cs = [Candle(t0 + i * 60, 1.0 + i * 0.001, 1.0005 + i * 0.001, 0.9995 + i * 0.001, 1.0008 + i * 0.001, 0, t0 + (i + 1) * 60)
          for i in range(5)]
    ticks = {t0 + 15: 1.0004}            # preço no instante 10:30:15 (diferente da abertura 1.0000)
    path = binary.PricePath(cs, lambda ts, ref: ticks.get(ts))
    tk = {"entry_ts": t0 + 15, "expiry_ts": t0 + 60, "direction": 1, "payout": 0.8, "stake": 1.0}
    out = binary.settle_ticket(path, tk, binary.BrokerRules())
    assert out["entry_price"] == 1.0004 and out["entry_source"] == "tick da corretora"
    assert out["exit_price"] == cs[0].close and out["result"] == "WIN"
    # sem tick no instante: não inventa preço
    out = binary.settle_ticket(binary.PricePath(cs), tk, binary.BrokerRules())
    assert out.get("void")


def test_loss_analyzer_and_training(tmp_path):
    from tio.training import run_training
    d = MarketData.load(SyntheticProvider(bars=5000, end=END), "EURUSD", "M1")
    mem = Memory(":memory:")
    p = ModelParams()
    p.confluence_high, p.min_independent_groups, p.require_tf_agreement = 30.0, 2, False   # mais tickets para o teste
    m = run({"EURUSD": d}, BTConfig(assets=["EURUSD"], timeframe="M1", step=3, warmup=1500), p)
    assert m["total"] > 0 and m["rules"]["expiry_mode"] == "candle_close"
    if m["losses"]:
        assert m["mistakes"]["total"] == m["losses"]
        ex = m["mistakes"]["examples"][0]
        assert ex["categories"] and ex["learning"]
    assert m["ranking"] and "brier_skill" in m["ranking"][0]
    rep = run_training({"EURUSD": d}, mem, timeframe="M1", step=6, min_trades=5)
    assert [s["n"] for s in rep["stages"]] == list(range(1, 11))
