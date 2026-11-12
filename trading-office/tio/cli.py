"""Linha de comando: python -m tio <comando>."""
from __future__ import annotations

import argparse
import json
import sys

from .models import ASSETS, DIR_LABEL, asset_label


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="tio", description="AI Trading Intelligence Office (educacional)")
    ap.add_argument("--provider", help="mt5 | csv | twelvedata | yahoo | synthetic | auto (padrão)")
    ap.add_argument("--tf", default="M15", help="temporalidade principal (padrão M15)")
    ap.add_argument("--tfs", help="temporalidades acompanhadas, ex.: M1,M5,M15")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve", help="inicia dashboard e API")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--auto", action="store_true", help="treino automático: analisa todos os pares continuamente")
    s.add_argument("--open", action="store_true", help="abre o navegador assim que o site estiver no ar")

    a = sub.add_parser("analyze", help="reunião do escritório sobre um ativo")
    a.add_argument("asset")
    a.add_argument("--json", action="store_true")

    b = sub.add_parser("backtest", help="laboratório de backtesting")
    b.add_argument("--assets", default="EURUSD")
    b.add_argument("--strategy", default="comite")
    b.add_argument("--timeframe", help="M1, M5, M15...")
    b.add_argument("--agents", help="lista de agentes (ex.: PA,LIQ,MTF)")
    b.add_argument("--expiry", type=int, default=4, help="expiração em candles")
    b.add_argument("--step", type=int, default=4)
    b.add_argument("--payout", type=float)

    l = sub.add_parser("learn", help="ciclo de melhoria com validação fora da amostra")
    l.add_argument("--assets", default="EURUSD,USDJPY,EURJPY")
    l.add_argument("--step", type=int, default=6)
    l.add_argument("--min-trades", type=int, default=30)

    f = sub.add_parser("fetch", help="baixa dados reais para data/market (Twelve Data ou Yahoo)")
    f.add_argument("--source", default="twelvedata", choices=["twelvedata", "yahoo"])
    f.add_argument("--assets", default=",".join(ASSETS))
    f.add_argument("--tfs", default="M15")

    dg = sub.add_parser("diagnostico", help="testa a leitura de velas do MT5 passo a passo")
    dg.add_argument("asset", nargs="?", default="EURUSD")

    n = sub.add_parser("news", help="calendário econômico")
    n.add_argument("--fetch", action="store_true", help="baixa a semana do calendário ForexFactory")

    args = ap.parse_args(argv)
    from .data.providers import get_provider
    from .service import OfficeService

    if args.cmd == "fetch":
        from .data.providers import TwelveDataProvider, YahooProvider, save_csv
        prov = TwelveDataProvider() if args.source == "twelvedata" else YahooProvider()
        for asset in args.assets.split(","):
            for tf in args.tfs.split(","):
                try:
                    srs = prov.load(asset.strip().upper(), tf.strip().upper())
                    if srs is None:
                        print(f"{asset} {tf}: indisponível (chave de API ausente ou TF não suportada)")
                        continue
                    print(f"{asset} {tf}: {len(srs)} candles → {save_csv(srs)}")
                except Exception as e:
                    print(f"{asset} {tf}: falhou ({e})")
        return 0
    if args.cmd == "news":
        from .data.news import NewsStore, fetch_forexfactory_week
        if args.fetch:
            print("Salvo em", fetch_forexfactory_week())
        st = NewsStore()
        for e in st.events[-30:]:
            d = e.to_dict()
            print(f"{d['time_label']}  {e.currency:3}  {d['impact_label']:7}  {e.title}  [fonte: {e.source}]")
        if not st.loaded:
            print("Nenhum evento carregado.")
        return 0

    if args.cmd == "diagnostico":
        from .data.providers import MT5Provider
        p = MT5Provider()
        print(f"\nDiagnóstico do MT5 para {args.asset.upper()}:\n")
        for s in p.diagnose(args.asset.upper().replace("/", "")):
            print(f"  {'OK ' if s['ok'] else 'ERRO'}  {s['step']:<18} {s['detail']}")
        return 0
    tfs = [t.strip().upper() for t in args.tfs.split(",")] if args.tfs else None
    if args.cmd == "serve":
        from .server import serve
        serve(args.host, args.port, None, autopilot=args.auto, open_browser=args.open,
              factory=lambda: OfficeService(provider=get_provider(args.provider), base_tf=args.tf.upper(), tfs=tfs))
        return 0
    svc = OfficeService(provider=get_provider(args.provider), base_tf=args.tf.upper(), tfs=tfs)
    if args.cmd == "analyze":
        res = svc.analyze(args.asset.upper().replace("/", ""))
        if "error" in res:
            print(res["error"])
            return 1
        if args.json:
            res.pop("chart", None)
            print(json.dumps(res, ensure_ascii=False, indent=1, default=str))
            return 0
        print(f"\n=== SALA DE REUNIÕES · {asset_label(res['asset'])} · {res['as_of_label']} ===")
        print(f"Fonte: {res['source']}\n")
        for m in res["transcript"]:
            print(f"[{m['speaker']}] {m['text']}\n")
        c = res["confluence"]
        print("--- Confluências ---")
        for r in c["criteria"]:
            print(f"  {r['criterion']:<34} {r['status']:<13} {r['points']:>6}")
        print(f"\nDECISÃO: {res['decision']}  | confluência {c['classification']} ({c['score']}) | processo {res['process']['label']}")
        print(c["calibration"]["note"])
        return 0
    if args.cmd == "backtest":
        cfg = {"assets": [x.strip().upper() for x in args.assets.split(",")], "strategy": args.strategy,
               "agents": args.agents.split(",") if args.agents else None, "expiry_bars": args.expiry,
               "timeframe": args.timeframe, "step": args.step,
               "payout": args.payout}
        m = svc.run_backtest(cfg, progress=lambda n: print(f"  ... {n} passos", file=sys.stderr))
        print(json.dumps({k: v for k, v in m.items() if k not in ("trades", "equity")}, ensure_ascii=False, indent=1, default=str))
        if m["synthetic"]:
            print("\n⚠ Backtest em dados SINTÉTICOS: os números não têm validade de mercado.")
        return 0
    if args.cmd == "learn":
        rep = svc.learn({"assets": [x.strip().upper() for x in args.assets.split(",")], "step": args.step,
                         "min_trades": args.min_trades}, progress=lambda p: print("  ...", p, file=sys.stderr))
        print(json.dumps(rep, ensure_ascii=False, indent=1, default=str))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
