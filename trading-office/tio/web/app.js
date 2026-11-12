"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (path, opts) => { const r = await fetch(path, opts); return r.json(); };
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const fmtP = (x) => x == null ? "—" : (Math.abs(x) < 20 ? x.toFixed(5) : x.toFixed(3));
const pct = (x, d = 1) => x == null ? "—" : (x * 100).toFixed(d) + "%";
const dirCls = (d) => d > 0 ? "up" : d < 0 ? "down" : "muted";
const dirLbl = { 1: "ALTA", "-1": "BAIXA", 0: "NEUTRO" };
const decCls = (d) => d.includes("ALTA") ? "up" : d.includes("BAIXA") ? "down" : d.includes("AGUARDAR") ? "wait" : "none";
const tsLbl = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const S = { status: null, asset: "EURUSD", analysis: null, agents: [], tf: "M15" };
try { S.tf = localStorage.getItem("tio_tf") || "M15"; } catch (e) { /* sem armazenamento */ }

// ------------------------------------------------------------------ navegação
$$("#tabs button").forEach((b) => b.onclick = () => {
  $$("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("on", t.id === b.dataset.tab));
  if (b.dataset.tab === "memoria") loadMemory();
  if (b.dataset.tab === "sala") renderRoom();
  if (b.dataset.tab === "painel" && S.analysis) drawAll();
  if (b.dataset.tab === "multi") loadMulti();
  if (b.dataset.tab === "mt5") loadMT5();
  if (b.dataset.tab === "horas") loadHours();
  if (b.dataset.tab === "treino") loadTraining();
  if (b.dataset.tab === "pesquisa") loadResearch();
  if (window.OFFICE) { if (b.dataset.tab === "escritorio") window.OFFICE.show(); else window.OFFICE.hide(); }
});
const activeTab = () => ($(".tab.on") || {}).id;

// ------------------------------------------------------------------ canvas helpers
function ctx2d(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  if (!cv._h) cv._h = cv.height;
  cv.width = w * dpr; cv.height = cv._h * dpr; cv.style.height = cv._h + "px"; cv._dpr = dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, w, cv._h];
}

const MK = { office: true, user: true };
function pillAt(c, x, y, text, stroke, fill) {
  c.font = "600 10px Inter, sans-serif"; const w = c.measureText(text).width + 12;
  c.fillStyle = fill || "rgba(10,12,16,.92)"; c.strokeStyle = stroke; c.lineWidth = 1;
  c.beginPath(); const r = 8, x0 = x - w / 2, y0 = y - 8; c.moveTo(x0 + r, y0); c.arcTo(x0 + w, y0, x0 + w, y0 + 16, r); c.arcTo(x0 + w, y0 + 16, x0, y0 + 16, r); c.arcTo(x0, y0 + 16, x0, y0, r); c.arcTo(x0, y0, x0 + w, y0, r); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = "#e6edf2"; c.textAlign = "center"; c.fillText(text, x, y + 3.5); c.textAlign = "left";
}
function drawChart(an) {
  const cv = $("#chart"); const [c, W, H] = ctx2d(cv);
  const ch = an.chart; const cs = ch.candles; if (!cs.length) return;
  const padR = 70, padB = 18, chartW = W - padR;
  let lo = Math.min(...cs.map((k) => k[3])), hi = Math.max(...cs.map((k) => k[2]));
  const m = (hi - lo) * 0.08; lo -= m; hi += m;
  const y = (p) => (H - padB) * (1 - (p - lo) / (hi - lo));
  const bw = chartW / cs.length;
  const t0 = cs[0][0], tN = cs[cs.length - 1][0];
  const tsx = (ts) => {
    if (ts <= t0) return bw / 2; if (ts >= tN) return (cs.length - 1) * bw + bw / 2;
    let i = cs.findIndex((k) => k[0] >= ts); const a = cs[i - 1][0], b = cs[i][0];
    return (i - 1 + (ts - a) / (b - a)) * bw + bw / 2;
  };
  const inR = (p) => p != null && p >= lo && p <= hi;
  c.clearRect(0, 0, W, H);
  c.fillStyle = "#07090d"; c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(255,255,255,.04)"; c.lineWidth = 1; c.fillStyle = css("--muted"); c.font = "10px JetBrains Mono, monospace";
  for (let i = 0; i <= 6; i++) { const p = lo + (hi - lo) * i / 6; const yy = y(p); c.beginPath(); c.moveTo(0, yy); c.lineTo(chartW, yy); c.stroke(); c.fillText(fmtP(p), chartW + 4, yy + 3); }
  const hline = (p, color, dash, label, x0, lw, labelRight) => {
    if (!inR(p)) return; c.strokeStyle = color; c.lineWidth = lw || 1; c.setLineDash(dash || []);
    c.beginPath(); c.moveTo(x0 || 0, y(p)); c.lineTo(chartW, y(p)); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
    if (label) { c.font = "600 10px Inter, sans-serif"; c.fillStyle = color; const tw = c.measureText(label).width; c.fillText(label, labelRight ? chartW - tw - 6 : (x0 || 0) + 4, y(p) - 4); }
  };
  const box = (z, fill, label, color) => {
    const x0 = Math.max(0, tsx(z.ts || z.t1 || t0)); const yt = y(Math.max(z.low, z.high)), yb = y(Math.min(z.low, z.high));
    if (yb < 0 || yt > H) return; c.fillStyle = fill; c.fillRect(x0, yt, chartW - x0, Math.max(2, yb - yt));
    if (label) { c.font = "600 9px Inter, sans-serif"; c.fillStyle = color; c.fillText(label, Math.min(x0 + 4, chartW - 70), yt + 10); }
  };
  // ----- volume profile na lateral (compra × venda)
  const pf = ch.profile;
  if (pf) {
    const tot = pf.bull.map((v, i) => v + pf.bear[i]); const mx = Math.max(...tot) || 1; const maxW = Math.min(150, chartW * 0.22);
    pf.bull.forEach((v, i) => {
      const p0 = pf.lo + i * pf.step, p1 = p0 + pf.step; if (!inR(p0) && !inR(p1)) return;
      const yt = y(p1), hgt = Math.max(1, y(p0) - yt - 1); const wb = maxW * v / mx, wr = maxW * pf.bear[i] / mx;
      c.fillStyle = "rgba(70,130,255,.45)"; c.fillRect(chartW - wb, yt, wb, hgt);
      c.fillStyle = "rgba(255,61,110,.40)"; c.fillRect(chartW - wb - wr, yt, wr, hgt);
    });
  }
  if (MK.office) {
    (ch.fvg_all || []).filter((z) => !z.mitigated).slice(-10).forEach((z) => box(z, z.dir > 0 ? "rgba(25,210,124,.10)" : "rgba(255,77,94,.10)", "FVG", z.dir > 0 ? css("--green") : css("--red")));
    (ch.order_blocks || []).forEach((z) => box(z, z.dir > 0 ? "rgba(40,170,140,.22)" : "rgba(200,60,90,.22)", "ORDER BLOCK", z.dir > 0 ? "#3ee6a8" : "#ff6b8a"));
    (ch.zones || []).slice().sort((a, b) => Math.abs((a.low + a.high) / 2 - cs[cs.length - 1][4]) - Math.abs((b.low + b.high) / 2 - cs[cs.length - 1][4])).slice(0, 3)
      .forEach((z) => box({ ...z, ts: t0 }, "rgba(74,168,255,.08)", null));
    // Fibonacci da PERNA ATUAL (como no indicador do usuário): 0.5 / 0.618 / 0.705 / 0.786 com preço
    const FIBC = { "0.382": "#8fa3b8", "0.500": "#a78bfa", "0.618": "#4aa8ff", "0.705": "#ff4d6d", "0.786": "#f2b53a" };
    const usedY = [];
    Object.entries(ch.fib || {}).filter(([cat]) => cat.startsWith("PERNA")).sort(([a]) => (a.endsWith(an.timeframe) ? -1 : 1)).forEach(([cat, f]) => {
      const main = cat.endsWith(an.timeframe);
      const x0 = Math.max(0, tsx(f.t1 || t0));
      (main ? ["0.382", "0.500", "0.618", "0.705", "0.786"] : ["0.500", "0.618", "0.705"]).forEach((k) => {
        const v = f.levels[k]; if (!inR(v)) return;
        const yy = y(v);
        c.strokeStyle = FIBC[k]; c.globalAlpha = main ? 0.95 : 0.45; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x0, yy); c.lineTo(chartW, yy); c.stroke();
        if (!usedY.some((u) => Math.abs(u - yy) < 11)) {     // rótulo só se não colidir com outro
          usedY.push(yy);
          const txt = `${k === "0.500" ? "0.5" : k}(${fmtP(v)})${main ? "" : " · " + cat.replace("PERNA ", "")}`;
          c.font = "600 10px JetBrains Mono, monospace"; const tw = c.measureText(txt).width;
          c.fillStyle = "rgba(7,9,13,.75)"; c.fillRect(chartW - tw - 10, yy - 12, tw + 6, 12);
          c.fillStyle = FIBC[k]; c.fillText(txt, chartW - tw - 7, yy - 3);
        }
        c.globalAlpha = 1;
      });
    });
    // Taxas Ouro / Prata (e Diamante/Bronze): no gráfico quando visíveis, senão seta na borda com a distância
    const lastPx = cs[cs.length - 1][4]; const edges = { up: [], down: [] };
    Object.entries(ch.fib || {}).filter(([cat]) => !cat.startsWith("PERNA")).forEach(([cat, f]) => {
      const tax = cat === "OURO" || cat === "PRATA"; const col = cat === "OURO" ? css("--gold") : cat === "PRATA" ? css("--silver") : "rgba(111,211,196,.6)";
      const name = cat === "OURO" ? "TAXA OURO" : cat === "PRATA" ? "TAXA PRATA" : cat;
      (tax ? ["0.236", "0.382", "0.500", "0.618", "0.705", "0.786"] : ["0.500", "0.618"]).forEach((k) => {
        const v = f.levels[k]; if (v == null) return;
        if (inR(v)) hline(v, col, tax ? [6, 3] : [2, 4], `${name} ${k}(${fmtP(v)})`, chartW * 0.45, tax ? 1.3 : 1);
        else if (tax) (v > hi ? edges.up : edges.down).push({ v, k, name, col });
      });
    });
    ["up", "down"].forEach((side) => {
      const list = edges[side].sort((a, b) => Math.abs(a.v - lastPx) - Math.abs(b.v - lastPx)).slice(0, 2);
      list.forEach((e, i) => {
        const yy = side === "up" ? 14 + i * 14 : H - padB - 6 - i * 14;
        c.font = "600 10px Inter, sans-serif"; c.fillStyle = e.col;
        const pip = lastPx > 20 ? 0.01 : 0.0001;
        c.fillText(`${side === "up" ? "▲" : "▼"} ${e.name} ${e.k} em ${fmtP(e.v)} (a ${Math.round(Math.abs(e.v - lastPx) / pip)} pips, fora do gráfico)`, chartW * 0.4, yy);
      });
    });
    // Pullback: zona de valor 0,5–0,705 do último BOS e estado
    const pbk = ch.pullback;
    if (pbk && pbk.zone && pbk.state && pbk.state !== "sem rompimento") {
      const zc = pbk.state === "pullback confirmado" ? "rgba(25,210,124,.16)" : pbk.state === "pullback falhou" ? "rgba(255,77,94,.12)" : "rgba(167,139,250,.12)";
      box({ low: pbk.zone[0], high: pbk.zone[1], ts: pbk.bos ? pbk.bos.ts : t0 }, zc, `PULLBACK · ${pbk.state.toUpperCase()}`, "#c4b5fd");
    }
    // liquidez: multi-temporalidade, equal highs/lows, strong/weak
    (ch.mtf_levels || []).forEach((lv) => hline(lv.price, "#9b8cff", [7, 4], lv.label, 0, 1, true));
    (ch.pools || []).filter((p) => (p.count || 1) > 1).slice(0, 4).forEach((p) => hline(p.price, "#7aa7ff", [2, 3], p.kind === "Equal Highs" ? "EQH" : p.kind === "Equal Lows" ? "EQL" : "LIQUIDEZ", chartW * 0.35));
    const sw = ch.strong_weak;
    if (sw) { hline(sw.strong.price, "#2ad1a3", [3, 3], sw.strong.kind, chartW * 0.6, 1, true); hline(sw.weak.price, "#ff5c8a", [3, 3], sw.weak.kind, chartW * 0.6, 1, true); }
    if (inR(ch.poc)) hline(ch.poc, "#f2d43a", [8, 4], "POC", 0, 1.4, true);
    // LTA / LTB
    (ch.trendlines || []).forEach((l) => {
      if (l.t1 < t0) return; c.strokeStyle = l.kind === "LTA" ? css("--green") : css("--red"); c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(tsx(l.t1), y(l.p1)); c.lineTo(tsx(l.t2), y(l.p2)); c.stroke(); c.lineWidth = 1;
    });
  }
  // ----- velas
  cs.forEach((k, i) => {
    const [, o, h, l, cl] = k; const x = i * bw + bw / 2; const up = cl >= o;
    c.strokeStyle = c.fillStyle = up ? "#3d8bff" : "#ff3d6e";
    c.beginPath(); c.moveTo(x, y(h)); c.lineTo(x, y(l)); c.stroke();
    const top = y(Math.max(o, cl)), bot = y(Math.min(o, cl));
    c.fillRect(x - bw * 0.35, top, Math.max(1, bw * 0.7), Math.max(1, bot - top));
  });
  // ----- BOS / CHoCH: linha do pivô rompido até o rompimento + etiqueta
  if (MK.office) {
    (ch.events || []).filter((e) => e.ts >= t0 && inR(e.level)).slice(-8).forEach((e) => {
      const x1 = tsx(Math.max(e.swing_ts || e.ts, t0)), x2 = tsx(e.ts); const col = e.dir > 0 ? "#cfd8e3" : "#cfd8e3";
      c.strokeStyle = col; c.beginPath(); c.moveTo(x1, y(e.level)); c.lineTo(x2, y(e.level)); c.stroke();
      pillAt(c, (x1 + x2) / 2, y(e.level) + (e.dir > 0 ? -10 : 10), e.kind === "CHOCH" ? "CHoCH" : "BOS", e.dir > 0 ? "#6aa8ff" : "#ff6b8a");
    });
  }
  // ----- marcações do SEU indicador (MT5), desenhadas por cima em estilo próprio
  const um = ch.user_marks;
  if (MK.user && um) {
    (um.zones || []).forEach((z) => { const x0 = Math.max(0, tsx(z.t1 || t0)); const yt = y(z.high), yb = y(z.low); if (yb < 0 || yt > H) return;
      c.setLineDash([4, 3]); c.strokeStyle = "#ffcc33"; c.strokeRect(x0, yt, chartW - x0, Math.max(2, yb - yt)); c.setLineDash([]);
      c.fillStyle = "#ffcc33"; c.font = "600 9px Inter, sans-serif"; c.fillText(`★ ${z.kind}`, Math.min(x0 + 4, chartW - 60), yb - 3); });
    (um.levels || []).forEach((lv) => hline(lv.price, "#ffcc33", [1, 3], `★ ${lv.label || lv.kind}`, chartW * 0.2, 1));
    (um.events || []).filter((e) => e.ts >= t0 && inR(e.price)).forEach((e) => pillAt(c, tsx(e.ts), y(e.price) - 14, `★ ${e.kind === "CHOCH" ? "CHoCH" : "BOS"}`, "#ffcc33", "rgba(40,30,0,.9)"));
  }
  // ----- preço atual e cronômetro da vela
  const last = cs[cs.length - 1][4]; c.fillStyle = "#e6edf2"; c.fillRect(chartW, y(last) - 7, padR, 14); c.fillStyle = "#000"; c.font = "10px JetBrains Mono, monospace"; c.fillText(fmtP(last), chartW + 4, y(last) + 3);
  c.fillStyle = css("--muted"); c.fillText(tsLbl(t0), 2, H - 4); c.fillText(tsLbl(tN) + " UTC", chartW - 120, H - 4);
  const sec = ch.tf_seconds || 60; const left = sec - Math.floor(Date.now() / 1000) % sec;
  c.font = "700 16px JetBrains Mono, monospace"; c.fillStyle = "#57d38c";
  c.fillText(`${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`, 8, 20);
}
setInterval(() => { if (S.analysis && activeTab && activeTab() === "painel") drawChart(S.analysis); }, 1000);

function drawProfile(vp, price) {
  const cv = $("#profile"); const [c, W, H] = ctx2d(cv); c.clearRect(0, 0, W, H);
  if (!vp || !vp.bins) { c.fillStyle = css("--muted"); c.fillText("sem dados", 10, 20); return; }
  const bins = vp.bins; const maxV = Math.max(...bins.map((b) => b[1]));
  const lo = bins[0][0], hi = bins[bins.length - 1][0]; const bh = H / bins.length;
  bins.forEach((b, i) => {
    const yy = H - (i + 1) * bh; const w = (W - 70) * b[1] / maxV;
    const inVA = b[0] >= vp.val && b[0] <= vp.vah;
    c.fillStyle = Math.abs(b[0] - vp.poc) < (hi - lo) / bins.length ? css("--amber") : inVA ? "rgba(25,210,124,.55)" : "rgba(125,138,149,.35)";
    c.fillRect(0, yy + 1, w, bh - 1);
  });
  const yp = H - (price - lo) / (hi - lo) * H; c.strokeStyle = css("--text"); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(0, yp); c.lineTo(W - 70, yp); c.stroke(); c.setLineDash([]);
  c.fillStyle = css("--muted"); c.font = "10px JetBrains Mono, monospace";
  [["VAH", vp.vah], ["POC", vp.poc], ["VAL", vp.val]].forEach(([n, p]) => { const yy = H - (p - lo) / (hi - lo) * H; c.fillText(`${n} ${fmtP(p)}`, W - 68, yy + 3); });
}

function drawRSI(series, p) {
  const cv = $("#rsi"); const [c, W, H] = ctx2d(cv); c.clearRect(0, 0, W, H);
  const s = (series || []).filter((x) => x != null); if (!s.length) return;
  const y = (v) => H - v / 100 * H;
  [[80, css("--red")], [50, css("--line2")], [20, css("--green")]].forEach(([v, col]) => { c.strokeStyle = col; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(0, y(v)); c.lineTo(W, y(v)); c.stroke(); });
  c.setLineDash([]); c.strokeStyle = css("--blue"); c.lineWidth = 1.5; c.beginPath();
  s.forEach((v, i) => { const x = i / (s.length - 1) * W; i ? c.lineTo(x, y(v)) : c.moveTo(x, y(v)); }); c.stroke(); c.lineWidth = 1;
}

function drawLine(cv, pts, color) {
  const [c, W, H] = ctx2d(cv); c.clearRect(0, 0, W, H);
  if (!pts || pts.length < 2) { c.fillStyle = css("--muted"); c.fillText("sem operações", 10, 20); return; }
  const ys = pts.map((p) => p[1]); const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys); const r = hi - lo || 1;
  const y = (v) => 10 + (H - 20) * (1 - (v - lo) / r);
  c.strokeStyle = css("--line2"); c.setLineDash([3, 4]); c.beginPath(); c.moveTo(0, y(0)); c.lineTo(W, y(0)); c.stroke(); c.setLineDash([]);
  c.strokeStyle = color; c.lineWidth = 1.6; c.beginPath();
  pts.forEach((p, i) => { const x = i / (pts.length - 1) * W; i ? c.lineTo(x, y(p[1])) : c.moveTo(x, y(p[1])); }); c.stroke(); c.lineWidth = 1;
  c.fillStyle = css("--muted"); c.font = "10px JetBrains Mono, monospace"; c.fillText(hi.toFixed(2), 2, 10); c.fillText(lo.toFixed(2), 2, H - 2);
}

function drawBars(cv, entries) {
  const [c, W, H] = ctx2d(cv); c.clearRect(0, 0, W, H);
  if (!entries.length) { c.fillStyle = css("--muted"); c.fillText("sem operações", 10, 20); return; }
  const bw = W / entries.length; const maxN = Math.max(...entries.map((e) => e[1].n));
  c.font = "9px JetBrains Mono, monospace";
  entries.forEach(([k, v], i) => {
    const h = (H - 26) * v.n / maxN; const x = i * bw;
    c.fillStyle = (v.expectancy ?? 0) >= 0 ? "rgba(25,210,124,.7)" : "rgba(255,77,94,.7)";
    c.fillRect(x + 2, H - 14 - h, bw - 4, h);
    c.fillStyle = css("--muted"); c.fillText(k.replace("h", ""), x + 2, H - 3);
  });
}

// ------------------------------------------------------------------ painel
async function loadStatus() {
  S.status = await api("/api/status");
  const st = S.status;
  $("#meta").textContent = `${st.source || "sem fonte"} · último candle ${st.last_candle || "—"} · modelo ${st.model_version}`;
  const b = $("#banner");
  const msgs = [];
  if (st.synthetic) msgs.push("⚠ DADOS SINTÉTICOS: nenhuma fonte de mercado configurada. Os gráficos e decisões servem apenas para demonstrar o software — não representam o mercado. Configure dados reais (veja o README).");
  if (!st.news_loaded) msgs.push("Calendário econômico não carregado: o contexto macro aparece como “não avaliado”.");
  b.innerHTML = msgs.map(esc).join("<br>"); b.classList.toggle("hidden", !msgs.length);
  if (!st.assets.includes(S.asset)) S.asset = st.assets[0];
  const pi = st.pairs || {};
  const pb = $("#pairs-bar");
  if (pb) pb.innerHTML = `Pares analisados: <b>${st.assets.map((a) => a.slice(0, 3) + "/" + a.slice(3)).join(", ")}</b> · origem: ${esc(pi.source || "")}` +
    (st.mt5 ? ` · <label><input type="checkbox" id="pairs-all" ${pi.mode === "all" ? "checked" : ""}> analisar todos os 8 pares padrão</label>` : "");
  const pa = $("#pairs-all"); if (pa) pa.onchange = async () => { await post("/api/settings", { pairs_mode: pa.checked ? "all" : "mt5_open" }); await loadStatus(); loadMulti(); };
  const sel = $("#asset"); sel.innerHTML = st.assets.map((a) => `<option value="${a}">${a.slice(0, 3)}/${a.slice(3)}</option>`).join("");
  sel.value = S.asset; sel.onchange = () => { S.asset = sel.value; loadAnalysis(); if (window.OFFICE) window.OFFICE.assetChanged(); };
  $("#bt-assets").innerHTML = st.assets.map((a, i) => `<label><input type="checkbox" name="assets" value="${a}" ${i === 0 ? "checked" : ""}>${a.slice(0, 3)}/${a.slice(3)}</label>`).join("");
  $("#learn-assets").innerHTML = st.assets.map((a, i) => `<label><input type="checkbox" name="assets" value="${a}" ${i < 3 ? "checked" : ""}>${a.slice(0, 3)}/${a.slice(3)}</label>`).join("");
  $("#bt-strategy").innerHTML = st.strategies.map((s) => `<option>${s}</option>`).join("");
  const tfs = st.tfs || ["M15"]; if (!tfs.includes(S.tf)) S.tf = tfs[0];
  $("#tfsel").innerHTML = tfs.map((t) => `<button data-tf="${t}" class="${t === S.tf ? "on" : ""}">${t}</button>`).join("");
  $$("#tfsel button").forEach((b) => b.onclick = () => {
    S.tf = b.dataset.tf; try { localStorage.setItem("tio_tf", S.tf); } catch (e) { /* ignore */ }
    $$("#tfsel button").forEach((x) => x.classList.toggle("on", x === b)); S.chatShown = null;
    loadAnalysis(); loadOverview(); if (activeTab() === "multi") loadMulti(); if (window.OFFICE) window.OFFICE.assetChanged();
  });
  const ap = st.autopilot || {};
  $("#meta").textContent = `${st.source || "sem fonte"} · último candle ${st.last_candle || "—"} · modelo ${st.model_version}` +
    (ap.running ? ` · treino automático ligado (${ap.cycles} ciclos)` : "");
}

async function loadAgents() {
  S.agents = await api("/api/agents");
  $("#bt-agents").innerHTML = S.agents.filter((a) => !["RISK", "HEAD"].includes(a.code)).map((a) => `<label title="${esc(a.name)}"><input type="checkbox" name="agents" value="${a.code}">${a.code}</label>`).join("");
  const rows = S.agents.filter((a) => a.backtest || a.live).map((a) => {
    const s = a.backtest || a.live;
    return `<tr><td>${esc(a.name)}</td><td class="num">${s.n}</td><td class="num ${s.hit_rate >= 0.5 ? "up" : "down"}">${pct(s.hit_rate)}</td><td class="num muted">${pct(s.ci[0], 0)}–${pct(s.ci[1], 0)}</td></tr>`;
  });
  $("#agent-perf").innerHTML = rows.length ? `<table><tr><th>Agente</th><th class="num">n</th><th class="num">Acerto dir.</th><th class="num">IC95%</th></tr>${rows.join("")}</table><p class="muted small">Fonte: último backtest (ou simulações ao vivo). Sem significância, não é vantagem.</p>` : `<p class="muted small">Ainda sem avaliações. Rode um backtest no Laboratório.</p>`;
}

async function loadOverview() {
  $("#assets-table").innerHTML = `<tr><td class="muted">analisando os 8 ativos…</td></tr>`;
  const ov = await api(`/api/overview?tf=${S.tf}`);
  const tfs = S.tf === "M15" ? ["D1", "H4", "H1", "M15"] : ["H4", "H1", "M15", S.tf];
  const tcls = (l) => l === "ALTA" ? "up" : l === "BAIXA" ? "down" : "muted";
  $("#assets-table").innerHTML = `<tr><th>Ativo</th><th class="num">Preço</th><th class="num">24h</th>${tfs.map((t) => `<th>${t}</th>`).join("")}<th>Decisão</th><th class="num">Confluência</th></tr>` +
    ov.map((r) => r.error ? `<tr><td>${r.label}</td><td colspan="8" class="muted">${esc(r.error)}</td></tr>` :
      `<tr class="click" data-a="${r.asset}"><td><b>${r.label}</b></td><td class="num">${fmtP(r.price)}</td><td class="num ${r.change_24h >= 0 ? "up" : "down"}">${r.change_24h == null ? "—" : r.change_24h.toFixed(2) + "%"}</td>` +
      tfs.map((t) => `<td class="${tcls(r.trend[t])} small">${esc(r.trend[t] || "—")}</td>`).join("") +
      `<td><span class="pill ${decCls(r.decision)}">${esc(r.decision)}</span></td><td class="num">${r.confluence} <span class="muted small">${r.class}</span></td></tr>`).join("");
  $$("#assets-table tr.click").forEach((tr) => tr.onclick = () => { S.asset = tr.dataset.a; $("#asset").value = S.asset; loadAnalysis(); window.scrollTo({ top: 0, behavior: "smooth" }); });
}

async function loadAnalysis() {
  const an = await api(`/api/analysis?asset=${S.asset}&tf=${S.tf}`);
  if (an.error) { $("#decision-box").textContent = an.error; return; }
  S.analysis = an; drawAll(); renderRoom(); loadCheck();
}

const rep = (code) => (S.analysis.reports || []).find((r) => r.agent === code) || { data: {}, warnings: [], evidence: [] };

function drawAll() {
  const an = S.analysis; if (!an) return;
  $("#px").textContent = fmtP(an.price);
  const d = $("#decision"); d.textContent = an.decision; d.className = "pill " + decCls(an.decision);
  drawChart(an);
  // decisão
  const c = an.confluence;
  $("#decision-box").innerHTML = `
    <div class="pill ${decCls(an.decision)}" style="display:inline-block;font-size:14px">${esc(an.decision)}</div>
    <p class="small">${esc(an.reason)}</p>
    <div class="small muted">Candles fechados até <b class="mono">${esc(an.as_of_label)}</b> · ${esc(an.timeframe)} · modelo ${esc(an.model_version)}</div>
    <h3>Qualidade do processo: ${esc(an.process.label)} (${an.process.score.toFixed(2)})</h3>
    ${an.process.items.map((i) => `<div class="crit"><span>${esc(i.name)}</span><span class="mono">${i.value.toFixed(2)}</span><div class="bar"><i style="width:${i.value * 100}%;background:var(--blue)"></i></div></div>`).join("")}
    ${an.divergences.length ? `<h3>Divergências</h3><ul class="list">${an.divergences.slice(0, 4).map((x) => `<li><span class="${dirCls(x.a_bias)}">${esc(x.a_name)}</span> × <span class="${dirCls(x.b_bias)}">${esc(x.b_name)}</span> <span class="muted">(${x.severity})</span></li>`).join("")}</ul>` : ""}
    ${an.risk ? `<h3>Risk Manager: ${an.risk.approved ? '<span class="up">APROVADO</span>' : '<span class="down">NÃO APROVADO</span>'}</h3><ul class="list">${an.risk.checks.map((k) => `<li class="${k.ok ? "" : "down"}">${k.ok ? "✔" : "✖"} ${esc(k.text)}</li>`).join("")}</ul>` : `<p class="muted small">Risk Manager não acionado (sem cenário de confluência alta).</p>`}
    ${an.tf_compare && an.tf_compare.applies ? `<h3>Comparação M1 × M5</h3><p class="small ${an.tf_compare.ok ? "up" : "wait"}">${esc(an.tf_compare.text)}</p>` : ""}
    ${an.ticket_plan ? `<h3>Ticket (regras da corretora)</h3><p class="small">Entrada ${tsLbl(an.ticket_plan.entry_ts)}:${String(an.ticket_plan.entry_ts % 60).padStart(2, "0")} · expira ${tsLbl(an.ticket_plan.expiry_ts)} · ${an.ticket_plan.remaining_s}s até a expiração${an.paper_trade ? ` · <b>${esc(an.paper_trade)}</b>` : ""}</p>` : ""}
    <p class="muted small">Fonte: ${esc(an.source)}</p>`;
  // confluência
  $("#confluence").innerHTML = `<div><span class="score ${dirCls(c.direction)}">${c.score}</span> <span class="muted">/100 · confluência ${c.classification} · viés ${dirLbl[c.direction]}</span></div>
    <div class="small muted">${c.agreeing_groups} grupos independentes confirmam · conflito ${c.conflict_ratio}</div>
    ${c.criteria.map((r) => `<div class="crit" title="${esc(r.evidence)} — ${esc(r.agent)}"><span>${esc(r.criterion)}</span><span class="small ${r.status === "confirma" ? "up" : r.status === "contra" ? "down" : "muted"}">${r.status}</span><div class="bar"><i style="width:${Math.max(0, r.points) / r.max * 100}%;background:${r.status === "contra" ? "var(--red)" : "var(--green)"}"></i></div></div>`).join("")}
    <p class="small wait">${esc(c.calibration.note)}</p><p class="muted small">${esc(c.disclaimer)}</p>`;
  // tendência
  const map = rep("MTF").data.map || {};
  const order = ["Y1", "MN", "W1", "D1", "H4", "H1", "M30", "M15", "M5", "M1"]; const lbl = { Y1: "Anual", MN: "Mensal", W1: "Semanal", D1: "Diário" };
  $("#trend-map").innerHTML = order.map((tf) => { const t = map[tf] || {}; const cl = t.trend > 0 ? "up" : t.trend < 0 ? "down" : ""; return `<div class="tf ${cl}"><b>${lbl[tf] || tf}</b><span class="${cl || "muted"}">${esc(t.label || "sem dados")}</span></div>`; }).join("") +
    `<div style="grid-column:1/-1" class="small">${esc(rep("MTF").summary || "")}${(rep("MTF").warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}</div>`;
  // liquidez
  const L = rep("LIQ"); const pools = (L.data.pools || []);
  $("#liquidity").innerHTML = `<table><tr><th>Lado</th><th>Tipo</th><th class="num">Preço</th><th class="num">ATR</th></tr>${pools.map((p) => `<tr><td class="${p.side === "acima" ? "up" : "down"}">${p.side}</td><td>${esc(p.kind)}${p.count > 1 ? ` (${p.count}×)` : ""}${p.external ? ' <span class="tag">externa</span>' : ""}</td><td class="num">${fmtP(p.price)}</td><td class="num">${p.dist_atr ?? ""}</td></tr>`).join("")}</table>
    <p class="small">${esc(L.summary || "")}</p>${(L.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}`;
  // volume profile
  const V = rep("VP"); drawProfile(V.data, an.price);
  $("#vp-info").innerHTML = V.data.poc ? `POC ${fmtP(V.data.poc)} · VAH ${fmtP(V.data.vah)} · VAL ${fmtP(V.data.val)} · preço ${esc(V.data.price_vs_poc)} do POC · modo ${esc(V.data.mode)}<br>${esc(V.summary)}` : "";
  // RSI
  const R = rep("VOL"); drawRSI(R.data.rsi_series);
  $("#rsi-info").innerHTML = `RSI(14) ${R.data.rsi ?? "—"} · volume: ${esc(R.data.volume_kind || "—")}${R.data.volume_ratio ? ` (${R.data.volume_ratio}× média)` : ""}<br>${esc(R.summary)}${(R.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}`;
  // fibonacci
  const F = rep("FIB"); const cats = F.data.categories || {};
  const tx = F.data.taxa_alert;
  const tname = (k) => k === "OURO" ? '<span class="taxa ouro">TAXA OURO · MENSAL</span>' : k === "PRATA" ? '<span class="taxa prata">TAXA PRATA · SEMANAL</span>' : `<b>${k}</b>`;
  $("#fib").innerHTML = (tx ? `<div class="warn" style="margin-bottom:6px">Preço na ${esc(tx.label)} ${tx.level} (${fmtP(tx.price)}): ${esc(tx.scenario)}</div>` : "") +
    ["OURO", "PRATA", "DIAMANTE", "BRONZE"].map((k) => { const f = cats[k]; if (!f) return `<details><summary>${tname(k)} <span class="muted small">sem dados</span></summary></details>`;
    return `<details ${k === "OURO" || k === "PRATA" ? "open" : ""}><summary>${tname(k)} <span class="muted small">${esc(f.ref)}</span></summary><table>${Object.entries(f.levels).map(([l, v]) => `<tr><td>${l}</td><td class="num">${fmtP(v)}</td></tr>`).join("")}</table></details>`; }).join("") +
    `<p class="small">${esc(F.summary || "")}</p>${(F.data.targets || []).length ? `<div class="small muted">Alvos (expansões): ${F.data.targets.slice(0, 3).map((t) => `${t.cat} ${t.level} ${fmtP(t.price)}`).join(" · ")}</div>` : ""}`;
  // S/R
  const SR = rep("SR"); const zs = SR.data.zones || [];
  $("#sr").innerHTML = `<table><tr><th>TF</th><th>Papel</th><th class="num">Zona</th><th class="num">Toques</th></tr>${zs.slice(0, 10).map((z) => `<tr><td>${z.tf}</td><td class="${z.role === "suporte" ? "up" : z.role === "resistência" ? "down" : "wait"}">${z.role}</td><td class="num">${fmtP(z.low)}–${fmtP(z.high)}</td><td class="num">${z.touches}${z.touches >= 4 ? "⚠" : ""}</td></tr>`).join("")}</table><p class="small">${esc(SR.summary || "")}</p>${(SR.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}`;
  // notícias
  const N = rep("NEWS"); const evs = N.data.events || [];
  $("#news").innerHTML = (evs.length ? `<ul class="list">${evs.map((e) => `<li><span class="mono small">${esc(e.time_label)}</span> · <b>${esc(e.currency)}</b> · <span class="${e.impact === "high" ? "down" : e.impact === "medium" ? "wait" : "muted"}">${esc(e.impact_label)}</span><br>${esc(e.title)} <span class="muted small">(fonte: ${esc(e.source)})</span></li>`).join("")}</ul>` : "") +
    `<p class="small">${esc(N.summary || "")}</p>${(N.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}`;
}

async function loadHistory() {
  const h = await api("/api/history");
  const t = h.trades || [];
  const m = h.metrics;
  $("#history").innerHTML = (m ? `<div class="kpis">${kpi("Operações", m.total)}${kpi("Acerto", pct(m.win_rate))}${kpi("Expectativa", m.expectancy)}${kpi("Drawdown", m.max_drawdown)}</div>${m.by_tf ? `<p class="small muted">${Object.entries(m.by_tf).map(([t, v]) => `${t}: ${v.wins}/${v.n} (${v.pnl >= 0 ? "+" : ""}${v.pnl} u)`).join(" · ")}</p>` : ""}` : "") +
    (t.length ? `<div class="table-wrap"><table><tr><th>Ativo</th><th>TF</th><th>Dir.</th><th>Entrada (UTC)</th><th>Expiração</th><th class="num">Entrada</th><th class="num">Saída</th><th>Resultado</th><th>Processo × resultado</th></tr>${t.slice(0, 25).map((r) => `<tr><td>${r.asset}</td><td class="mono small">${r.tf}</td><td class="${dirCls(r.direction)}">${r.direction > 0 ? "CALL" : "PUT"}</td><td class="mono small">${tsLbl(r.entry_ts)}</td><td class="mono small">${tsLbl(r.expiry_ts)}</td><td class="num">${fmtP(r.entry_price)}</td><td class="num">${fmtP(r.exit_price)}</td><td class="${r.result === "WIN" ? "up" : r.result === "LOSS" ? "down" : "muted"}">${r.result || "em aberto"}</td><td class="small">${esc(r.review?.quadrant || "")}</td></tr>`).join("")}</table></div>`
      : `<p class="muted small">Nenhuma operação simulada ao vivo ainda. Elas são abertas somente quando o Head Trader decide CENÁRIO DE ALTA/BAIXA com aprovação do Risk Manager, e resolvidas após a expiração.</p>`) +
    `<h3>Decisões registradas</h3><ul class="list">${(h.decisions || []).slice(0, 8).map((d) => `<li><span class="mono small">${tsLbl(d.as_of)}</span> ${d.asset} <span class="pill ${decCls(d.decision)}">${esc(d.decision)}</span> <span class="muted small">conf. ${d.confluence} · processo ${(d.process_quality || 0).toFixed(2)}</span></li>`).join("")}</ul>`;
}
const kpi = (k, v) => `<div class="kpi"><small>${k}</small><b>${v ?? "—"}</b></div>`;

// ------------------------------------------------------------------ sala de operações
function renderRoom() {
  const an = S.analysis; const byCode = {}; (an?.reports || []).forEach((r) => byCode[r.agent] = r);
  $("#agent-cards").innerHTML = S.agents.map((a) => {
    const r = byCode[a.code]; const s = a.backtest || a.live;
    let status = "aguardando", last = "", conclusion = "", conf = 0, warn = "";
    if (a.code === "HEAD" && an) { status = "decidiu"; conclusion = `<span class="pill ${decCls(an.decision)}">${esc(an.decision)}</span>`; last = esc(an.reason); conf = an.process.score; }
    else if (a.code === "RISK" && an) { status = an.risk ? (an.risk.approved ? "aprovou" : "vetou") : "não acionado"; last = an.risk ? esc(an.risk.checks.filter((c) => !c.ok).map((c) => c.text).join("; ") || "Todos os controles aprovados.") : "Sem cenário de confluência alta para avaliar."; }
    else if (r) { status = r.abstain ? "absteve-se" : "analisou"; conclusion = `<span class="${dirCls(r.bias)}">${dirLbl[r.bias]}</span>`; last = esc(r.summary); conf = r.confidence; warn = (r.warnings || []).slice(0, 1).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("") + (r.revisions || []).map((w) => `<div class="muted small">↺ ${esc(w)}</div>`).join(""); }
    const cal = r?.calibrated; const calTxt = cal ? (cal.calibrated ? `calibrado: ${pct(cal.hit_rate)} (n=${cal.n})` : `não calibrado (n=${cal.n || 0})`) : "";
    return `<div class="agent"><span class="num">${String(a.number).padStart(2, "0")}</span><h4>${esc(a.name)}</h4><div class="spec">${esc(a.specialty)}</div>
      <div class="status"><span class="dot ${r && !r.abstain || ["HEAD", "RISK"].includes(a.code) && an ? "on" : "off"}"></span>${status} ${conclusion}</div>
      <div class="last">${last}</div>${warn}
      ${conf ? `<div class="conf" title="confiança bruta"><i style="width:${conf * 100}%"></i></div><div class="small muted">confiança ${conf.toFixed(2)} ${calTxt ? "· " + calTxt : ""}</div>` : ""}
      <div class="hist">${s ? `histórico: ${s.hits}/${s.n} acertos (${pct(s.hit_rate)})` : "histórico: sem avaliações"}</div>
      <details><summary class="small muted">Metodologia</summary><p class="small">${esc(a.methodology)}</p><p class="small muted">${esc(a.personality)}</p></details></div>`;
  }).join("");
  if (an && !S.chatShown) { showTranscript(an.transcript, an.asset); S.chatShown = an.asset; }
}

function addMsg(speaker, text, kind = "") { const d = document.createElement("div"); d.className = "msg " + kind; d.innerHTML = `<b>${esc(speaker)}</b>${esc(text)}`; $("#chat-log").appendChild(d); $("#chat-log").scrollTop = 1e9; }
function showTranscript(tr, asset) { $("#chat-asset").textContent = asset ? `reunião: ${asset.slice(0, 3)}/${asset.slice(3)}` : ""; (tr || []).forEach((m) => addMsg(m.speaker, m.text, m.kind)); }

$("#chat-form").onsubmit = async (e) => {
  e.preventDefault(); const q = $("#chat-input").value.trim(); if (!q) return; $("#chat-input").value = "";
  addMsg("Você", q, "user"); addMsg("Head Trader", "Convocando os especialistas…", "request");
  const r = await post("/api/chat", { message: q });
  if (r.transcript?.length) showTranscript(r.transcript, r.asset);
  addMsg(r.speaker || "Head Trader", r.reply, "decision");
  if (r.asset && r.asset !== S.asset) { S.asset = r.asset; $("#asset").value = r.asset; const an = await api(`/api/analysis?asset=${r.asset}&tf=${S.tf}`); S.analysis = an; renderRoom(); }
};

// ------------------------------------------------------------------ jobs
async function waitJob(id, progEl) {
  for (;;) {
    const j = await api(`/api/job?id=${id}`);
    progEl.textContent = j.status === "running" ? `executando… ${j.progress.length ? j.progress[j.progress.length - 1] : ""}` : j.status === "error" ? `erro: ${j.error}` : "concluído";
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 1200));
  }
}
function formData(form) {
  const fd = new FormData(form); const o = {};
  for (const [k, v] of fd.entries()) { if (k === "assets" || k === "agents") (o[k] = o[k] || []).push(v); else o[k] = v; }
  return o;
}
$("#bt-form").onsubmit = async (e) => {
  e.preventDefault(); const btn = $("button", e.target); btn.disabled = true;
  const cfg = formData(e.target); if (cfg.rsi_overbought) cfg.rsi_oversold = 100 - Number(cfg.rsi_overbought);
  const { job } = await post("/api/backtest", cfg); const j = await waitJob(job, $("#bt-progress")); btn.disabled = false;
  if (j.result) renderBacktest(j.result); loadAgents();
};
function renderBacktest(m) {
  $("#bt-summary").innerHTML = kpi("Operações", m.total) + kpi("Acerto", pct(m.win_rate)) + kpi("Erro", pct(m.loss_rate)) + kpi("Retorno (u)", m.return) +
    kpi("Expectativa/op", m.expectancy) + kpi("Drawdown máx.", m.max_drawdown) + kpi("Seq. ganhos/perdas", `${m.max_win_streak}/${m.max_loss_streak}`) + kpi("p-valor vs equilíbrio", m.p_value_vs_breakeven ?? "—");
  drawLine($("#equity"), m.equity, (m.return ?? 0) >= 0 ? css("--green") : css("--red"));
  $("#bt-notes").innerHTML = `<p>Equilíbrio do payout: ${pct(m.breakeven)} · IC95% da taxa de acerto: ${m.win_rate_ci ? pct(m.win_rate_ci[0]) + "–" + pct(m.win_rate_ci[1]) : "—"} · ${m.significant ? '<span class="up">estatisticamente acima do equilíbrio (p<0,05)</span>' : '<span class="wait">sem evidência estatística de vantagem</span>'}</p>
    <p class="muted">Fonte: ${esc(m.sources.join(", "))} · ${m.steps} reuniões em ${m.elapsed_s}s · modelo ${esc(m.model_version)}</p>${m.synthetic ? '<p class="down">⚠ Dados SINTÉTICOS: resultados sem validade de mercado.</p>' : ""}`;
  const tbl = (g) => `<table><tr><th></th><th class="num">n</th><th class="num">Acerto</th><th class="num">IC95%</th><th class="num">Expect.</th></tr>${Object.entries(g).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${pct(v.win_rate)}</td><td class="num muted">${pct(v.ci[0], 0)}–${pct(v.ci[1], 0)}</td><td class="num ${v.expectancy >= 0 ? "up" : "down"}">${v.expectancy}</td></tr>`).join("")}</table>`;
  $("#bt-asset").innerHTML = tbl(m.by_asset) + `<h3>Por direção</h3>` + tbl(m.by_direction) + `<h3>Por estratégia</h3>` + tbl(m.by_strategy);
  $("#bt-conf").innerHTML = tbl(m.by_confluence) + `<p class="muted small">Calibração: pontuação → taxa de acerto observada. Só vale com amostra suficiente.</p>`;
  drawBars($("#bt-hour"), Object.entries(m.by_hour));
  $("#bt-agents-perf").innerHTML = `<table><tr><th>Agente</th><th class="num">n</th><th class="num">Acerto dir.</th><th class="num">IC95%</th></tr>${Object.entries(m.agents).sort((a, b) => b[1].hit_rate - a[1].hit_rate).map(([k, v]) => `<tr><td>${k}</td><td class="num">${v.n}</td><td class="num ${v.ci[0] > 0.5 ? "up" : v.ci[1] < 0.5 ? "down" : ""}">${pct(v.hit_rate)}</td><td class="num muted">${pct(v.ci[0], 0)}–${pct(v.ci[1], 0)}</td></tr>`).join("")}</table><p class="muted small">Avaliado em todas as reuniões (inclusive sem operação): viés do agente × direção real até a expiração.</p>`;
  const qn = { decisao_correta: "Bom processo + ganho", variancia: "Bom processo + perda (variância)", sorte: "Processo fraco + ganho (sorte)", erro_processo: "Processo fraco + perda", empate: "Empate" };
  $("#bt-quad").innerHTML = `<ul class="list">${Object.entries(m.quadrants).map(([k, v]) => `<li>${qn[k] || k}: <b>${v}</b></li>`).join("") || "<li class='muted'>sem operações</li>"}</ul><p class="muted small">Resultado positivo não implica boa análise; o aprendizado avalia o processo.</p>`;
  $("#bt-dec").innerHTML = `<ul class="list">${Object.entries(m.decisions).map(([k, v]) => `<li><span class="pill ${decCls(k)}">${k}</span> ${v}</li>`).join("")}</ul><p class="small">Abstenções avaliadas: ${m.abstention.total} · “não operar” evitou perda em ${pct(m.abstention.rate)}</p>`;
}

// ------------------------------------------------------------------ memória
$("#learn-form").onsubmit = async (e) => {
  e.preventDefault(); const btn = $("button", e.target); btn.disabled = true;
  const { job } = await post("/api/learn", formData(e.target)); const j = await waitJob(job, $("#learn-progress")); btn.disabled = false;
  loadMemory(); loadStatus();
};
async function loadMemory() {
  const m = await api("/api/memory");
  const sm = (x) => x && x.total != null ? `n=${x.total} · acerto ${pct(x.win_rate)} · exp ${x.expectancy}` : "—";
  $("#versions").innerHTML = `<table><tr><th>Versão</th><th>Status</th><th>Mudança</th><th>In-sample (cand. × base)</th><th>Fora da amostra (cand. × base)</th></tr>${m.versions.map((v) => `<tr><td class="mono">${esc(v.version)}</td><td><span class="tag ${v.status}">${v.status}</span></td><td class="small">${esc(v.change)}<div class="muted">${esc(v.notes || "")}</div></td><td class="small mono">${sm(v.in_sample)}<br><span class="muted">${sm(v.baseline_in)}</span></td><td class="small mono">${sm(v.out_sample)}<br><span class="muted">${sm(v.baseline_out)}</span></td></tr>`).join("")}</table>`;
  $("#reports").innerHTML = m.reports.length ? m.reports.map((r) => `<details><summary>${esc(r.created)} · ${esc(r.title)} ${r.body.promoted ? `<span class="tag approved">promovida ${esc(r.body.promoted)}</span>` : '<span class="tag">nenhuma promoção</span>'}</summary><pre>${esc(JSON.stringify(r.body, null, 1))}</pre></details>`).join("") : `<p class="muted small">Nenhum ciclo de aprendizado executado.</p>`;
  $("#bt-list").innerHTML = m.backtests.length ? `<ul class="list">${m.backtests.map((b) => `<li><span class="mono small">${esc(b.created)}</span> ${esc(b.config.strategy)} · ${b.config.assets.join(",")}<br><span class="small muted">n=${b.metrics.total} · acerto ${pct(b.metrics.win_rate)} · exp ${b.metrics.expectancy}${b.synthetic ? " · SINTÉTICO" : ""}</span></li>`).join("")}</ul>` : `<p class="muted small">Nenhum backtest.</p>`;
  $("#lessons").innerHTML = m.lessons.length ? `<div class="table-wrap"><table><tr><th>Quando</th><th>Agente</th><th>Ativo</th><th>Contexto</th><th>Classe</th><th>Lição</th></tr>${m.lessons.map((l) => `<tr><td class="mono small">${esc(l.created)}</td><td>${esc(l.agent)}</td><td>${esc(l.asset)}</td><td class="small">${esc(l.tag)}</td><td class="${l.outcome_class === "erro" ? "down" : "up"}">${esc(l.outcome_class)}</td><td class="small">${esc(l.description)}</td></tr>`).join("")}</table></div>` : `<p class="muted small">As lições são registradas quando simulações ao vivo expiram. (Backtests usam memória isolada para evitar vazamento de informação futura.)</p>`;
}

// ------------------------------------------------------------------ multi-pares
function miniChart(cv, cs) {
  const [c, W, H] = ctx2d(cv); c.clearRect(0, 0, W, H); if (!cs || !cs.length) return;
  const lo = Math.min(...cs.map((k) => k[3])), hi = Math.max(...cs.map((k) => k[2])); const r = hi - lo || 1;
  const y = (p) => 3 + (H - 6) * (1 - (p - lo) / r); const bw = W / cs.length;
  cs.forEach((k, i) => {
    const [, o, h, l, cl] = k; const x = i * bw + bw / 2;
    c.strokeStyle = c.fillStyle = cl >= o ? css("--green") : css("--red");
    c.beginPath(); c.moveTo(x, y(h)); c.lineTo(x, y(l)); c.stroke();
    const t = y(Math.max(o, cl)); c.fillRect(x - bw * 0.3, t, Math.max(1, bw * 0.6), Math.max(1, y(Math.min(o, cl)) - t));
  });
}

async function loadMulti() {
  const d = await api(`/api/scan?tf=${S.tf}`);
  const ap = (S.status || {}).autopilot || {};
  $("#multi-info").innerHTML = `Velas de <b>${esc(d.tf)}</b> · expiração simulada de ${d.expiry_bars} velas · ` +
    (ap.running ? "treino automático ligado: o escritório analisa sozinho e registra operações simuladas" : "treino automático desligado") +
    " · atualiza sozinho a cada 15 s";
  const counts = {}; d.cards.forEach((c) => { if (c.decision) counts[c.decision] = (counts[c.decision] || 0) + 1; });
  $("#multi-sum").innerHTML = Object.entries(counts).map(([k, v]) => `<span class="pill ${decCls(k)}">${esc(k)} · ${v}</span>`).join("");
  $("#multi-grid").innerHTML = d.cards.map((c) => c.error ? `<div class="pair"><b>${c.label}</b><span class="muted small">${esc(c.error)}</span></div>` : `
    <div class="pair ${decCls(c.decision)}" data-a="${c.asset}">
      <div class="pair-top"><b>${c.label}</b><span class="mono">${fmtP(c.price)}</span></div>
      <canvas height="90"></canvas>
      <div><span class="pill ${decCls(c.decision)}">${esc(c.decision)}</span> <span class="small muted">confluência ${c.confluence} · ${c.agreeing} fatores</span></div>
      <div class="votes" title="Viés de cada agente">${c.votes.map((v) => `<span class="vote ${v.abstain ? "off" : dirCls(v.bias)}" title="${v.code}: ${v.abstain ? "sem dados" : dirLbl[v.bias]} (${v.conf})">${v.code}</span>`).join("")}</div>
      <div class="pair-foot"><span>${c.open_trade ? `<b class="${dirCls(c.open_trade.direction)}">simulação ${c.open_trade.direction > 0 ? "CALL" : "PUT"} até ${tsLbl(c.open_trade.expiry_ts).slice(11)}</b>` : `vela fechada ${esc(c.as_of.slice(11, 16))} UTC`}</span>
        <span>últimas: ${c.recent.length ? c.recent.map((r) => `<i class="res ${r}" title="${r}"></i>`).join("") : "—"}</span></div>
      ${c.news_avoid ? '<div class="warn">⚠ notícia de alto impacto</div>' : ""}
    </div>`).join("");
  $$("#multi-grid .pair[data-a]").forEach((el) => {
    const card = d.cards.find((x) => x.asset === el.dataset.a); miniChart($("canvas", el), card.candles);
    el.onclick = () => { S.asset = el.dataset.a; $("#asset").value = S.asset; loadAnalysis(); $('#tabs button[data-tab="painel"]').click(); };
  });
}

// ------------------------------------------------------------------ MT5
async function loadMT5() {
  const m = await api("/api/mt5");
  if (!m.connected) {
    $("#mt5-conn").innerHTML = `<p class="small">${esc(m.note)}</p>`;
    ["#mt5-list", "#mt5-exp", "#mt5-stats"].forEach((k) => { $(k).innerHTML = ""; });
    return;
  }
  $("#mt5-conn").innerHTML = `<p><span class="ok-dot on"></span>Conectado: <b>${esc(m.broker)}</b></p><p class="small">Somente leitura: nenhuma ordem é enviada.</p>
    <table>${Object.entries(m.symbols).map(([a, s]) => `<tr><td>${a.slice(0, 3)}/${a.slice(3)}</td><td class="mono small ${s ? "" : "down"}">${esc(s || "não encontrado")}</td></tr>`).join("")}</table>`;
  const sel = new Set(m.selected);
  $("#mt5-list").innerHTML = m.available.length
    ? m.available.map((n) => `<label><input type="checkbox" value="${esc(n)}" ${sel.has(n) ? "checked" : ""}>${esc(n)}</label>`).join("")
    : `<p class="muted small">Nenhum indicador compilado (.ex5) encontrado na pasta de indicadores do seu MT5.</p>`;
  const f = m.exporter_file || {};
  $("#mt5-file").innerHTML = `<p><span class="ok-dot ${f.compiled ? "on" : ""}"></span>Arquivo do exportador: ${f.copied ? "copiado" : "<b class='down'>não copiado</b>"} · ${f.compiled ? "<b class='up'>compilado</b>" : "<b class='down'>não compilado</b>"}</p>
    <p class="muted">Pasta: <span class="mono">${esc(f.folder || "—")}</span></p>
    <p><button class="primary" id="mt5-open-ed">Abrir no MetaEditor</button> <button class="ghost" id="mt5-open-dir">Abrir pasta</button> <span id="mt5-open-msg" class="muted"></span></p>
    ${f.compile_log ? `<details><summary>Registro da compilação</summary><pre>${esc(f.compile_log)}</pre></details>` : ""}`;
  const openIt = async (what) => { const r = await post("/api/mt5/open", { what }); $("#mt5-open-msg").textContent = r.message || r.error || ""; setTimeout(loadMT5, 8000); };
  $("#mt5-open-ed").onclick = () => openIt("editor"); $("#mt5-open-dir").onclick = () => openIt("folder");
  const ex = m.exporter || {};
  $("#mt5-exp").innerHTML = `<p class="small"><span class="ok-dot ${ex.running ? "on" : ""}"></span>${ex.running ? "Exportador funcionando" : "Exportador ainda não está rodando"} · ${esc(m.exporter_install || "")}</p>
    ${ex.status_text ? `<pre>${esc(ex.status_text)}</pre>` : ""}${ex.files && ex.files.length ? `<p class="small muted">${ex.files.length} arquivos exportados</p>` : ""}`;
  const stats = Object.entries(m.stats || {});
  $("#mt5-stats").innerHTML = stats.length
    ? `<table><tr><th>Indicador</th><th class="num">sinais</th><th class="num">acerto</th><th class="num">IC95%</th></tr>${stats.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num ${v.ci[0] > 0.5 ? "up" : v.ci[1] < 0.5 ? "down" : ""}">${pct(v.hit_rate)}</td><td class="num muted">${pct(v.ci[0], 0)}–${pct(v.ci[1], 0)}</td></tr>`).join("")}</table>
       <p class="muted small">Acerto = direção do sinal comparada com a direção real até a expiração simulada. Só é vantagem se a faixa IC95% inteira ficar acima do ponto de equilíbrio do payout.</p>`
    : `<p class="muted small">Ainda sem sinais avaliados. Com o exportador ligado e o treino automático rodando, cada seta dos seus indicadores é conferida depois da expiração.</p>`;
}
$("#mt5-save").onclick = async () => {
  const names = $$("#mt5-list input:checked").map((i) => i.value);
  const r = await post("/api/mt5/indicators", { names });
  $("#mt5-save").textContent = r.error ? "Erro" : "Salvo ✓";
  setTimeout(() => { $("#mt5-save").textContent = "Salvar escolha"; loadMT5(); }, 1500);
};

// ------------------------------------------------------------------ horários
const HRS = { data: null, picked: new Set() };
const localHour = (h) => { const d = new Date(Date.UTC(2026, 0, 5, h)); return d.getHours(); };
async function loadHours() {
  const h = await api("/api/hours"); HRS.data = h;
  const tfs = Object.keys(h.grid || {}).sort((a, b) => (a === "TODAS") - (b === "TODAS"));
  const sel = $("#hours-tf"); const cur = sel.value;
  sel.innerHTML = (tfs.length ? tfs : ["TODAS"]).map((t) => `<option ${t === (cur || S.tf) ? "selected" : ""}>${t}</option>`).join("");
  if (!HRS.init) { HRS.init = true; (h.filter.hours || []).forEach((x) => HRS.picked.add(x)); }
  renderHours();
}
function renderHours() {
  const h = HRS.data; if (!h) return;
  const src = $("#hours-src").value; const be = h.breakeven;
  $("#hours-note").innerHTML = `${esc(h.note)} Ponto de equilíbrio do payout: <b>${pct(be)}</b>. Filtro atual: ${h.filter.enabled ? `<b class="up">ligado</b> (${h.filter.hours.map((x) => String(x).padStart(2, "0") + "h").join(", ")} UTC)` : "desligado"}.`;
  const rows = Object.keys(h.grid).length ? Object.keys(h.grid) : [];
  const head = `<div class="hl">UTC<br>local</div>` + Array.from({ length: 24 }, (_, i) => `<div class="hh">${String(i).padStart(2, "0")}<br>${String(localHour(i)).padStart(2, "0")}</div>`).join("");
  const body = rows.map((tf) => `<div class="hl">${tf}</div>` + Array.from({ length: 24 }, (_, i) => {
    const c = (h.grid[tf][i] || {})[src]; if (!c || !c.n) return `<div class="hc" data-h="${i}" style="opacity:.35">—</div>`;
    const good = c.rate > be; const strong = c.n >= 10; const a = strong ? Math.min(0.75, 0.2 + Math.abs(c.rate - be) * 3) : 0.12;
    const bg = good ? `rgba(25,210,124,${a})` : `rgba(255,77,94,${a})`;
    return `<div class="hc ${HRS.picked.has(i) ? "sel" : ""}" data-h="${i}" style="background:${bg}" title="${tf} ${i}h UTC: ${c.wins}/${c.n} (${pct(c.rate)}), IC95% ${pct(c.ci[0], 0)}–${pct(c.ci[1], 0)}">${pct(c.rate, 0)}<br><span class="muted">${c.n}</span></div>`;
  }).join("")).join("");
  $("#hours-grid").className = rows.length ? "hours-grid" : "";
  $("#hours-grid").innerHTML = rows.length ? head + body : `<p class="muted small">Ainda não há registros. Deixe o treino automático rodando: cada reunião vira um registro por hora quando a expiração chega.</p>`;
  $$("#hours-grid .hc").forEach((el) => el.onclick = () => { const x = +el.dataset.h; HRS.picked.has(x) ? HRS.picked.delete(x) : HRS.picked.add(x); renderHours(); });
  $("#hours-pick").innerHTML = Array.from({ length: 24 }, (_, i) => `<label><input type="checkbox" value="${i}" ${HRS.picked.has(i) ? "checked" : ""}>${String(localHour(i)).padStart(2, "0")}h<small>${String(i).padStart(2, "0")} UTC</small></label>`).join("");
  $$("#hours-pick input").forEach((el) => el.onchange = () => { const x = +el.value; el.checked ? HRS.picked.add(x) : HRS.picked.delete(x); renderHours(); });
}
$("#hours-tf").onchange = renderHours; $("#hours-src").onchange = renderHours;
$("#hours-suggest").onclick = () => {
  const h = HRS.data; if (!h) return; const tf = $("#hours-tf").value; const src = $("#hours-src").value; const g = (h.grid || {})[tf] || {};
  const best = Object.entries(g).map(([hr, v]) => [+hr, v[src]]).filter(([, v]) => v && v.n >= 20 && v.ci[0] > h.breakeven - 0.05).sort((a, b) => b[1].ci[0] - a[1].ci[0]);
  HRS.picked = new Set(best.slice(0, 8).map(([hr]) => hr)); renderHours();
  $("#hours-status").textContent = best.length ? `Sugeridas ${best.length > 8 ? 8 : best.length} horas com limite inferior de confiança mais alto (mín. 20 registros).` : "Ainda não há horas com amostra suficiente (mín. 20 registros) para sugerir.";
};
$("#hours-save").onclick = async () => { const r = await post("/api/hours/filter", { enabled: true, hours: [...HRS.picked] }); $("#hours-status").textContent = r.enabled ? `Filtro ligado: ${r.hours.length} horas.` : "Marque pelo menos uma hora."; loadHours(); };
$("#hours-off").onclick = async () => { await post("/api/hours/filter", { enabled: false, hours: [...HRS.picked] }); $("#hours-status").textContent = "Filtro desligado."; loadHours(); };

// ------------------------------------------------------------------ treinamento
const TR = { rules: null };
async function loadTraining() {
  const st = await api("/api/status"); TR.rules = st.broker_rules;
  const r = TR.rules;
  $("#broker-form").innerHTML = `
    <div class="row2"><label>Preço de referência<select name="price_ref">${["bid", "ask", "mid"].map((x) => `<option ${r.price_ref === x ? "selected" : ""} value="${x}">${{ bid: "Bid (compra da corretora)", ask: "Ask", mid: "Médio (bid+ask)/2" }[x]}</option>`).join("")}</select></label>
    <label>Atraso da entrada (s)<input name="entry_delay_s" type="number" min="0" max="240" value="${r.entry_delay_s}"></label></div>
    <div class="row2"><label>Expiração<select name="expiry_mode"><option value="candle_close" ${r.expiry_mode === "candle_close" ? "selected" : ""}>No fechamento da própria vela</option><option value="bars" ${r.expiry_mode === "bars" ? "selected" : ""}>Após N velas</option></select></label>
    <label>N velas (modo N velas)<input name="expiry_bars" type="number" min="1" max="30" value="${r.expiry_bars}"></label></div>
    <div class="row2"><label>Payout<input name="payout" type="number" step="0.01" min="0.1" max="1" value="${r.payout}"></label>
    <label>Empate<select name="tie_rule"><option value="refund" ${r.tie_rule === "refund" ? "selected" : ""}>Devolve o valor</option><option value="loss" ${r.tie_rule === "loss" ? "selected" : ""}>Conta como perda</option></select></label></div>
    <div class="row2"><label>Tempo mínimo restante M1 (s)<input name="min_m1" type="number" value="${(r.min_remaining_s || {}).M1 ?? 30}"></label>
    <label>Tempo mínimo restante M5 (s)<input name="min_m5" type="number" value="${(r.min_remaining_s || {}).M5 ?? 120}"></label></div>
    <label>Diferença de relógio da corretora (ms)<input name="settlement_offset_ms" type="number" value="${r.settlement_offset_ms}"></label>
    <button class="primary">Salvar regras da corretora</button>
    <p class="small muted">${st.has_ticks ? "Preços de entrada e expiração vêm dos ticks da sua corretora (MT5)." : "Sem ticks (modo sem MT5): a entrada é feita em instantes com preço exato (início de minuto) e o atraso é ignorado; isso fica registrado em cada ticket."}</p>`;
  $("#broker-form").onsubmit = async (e) => {
    e.preventDefault(); const f = formData(e.target);
    const body = { price_ref: f.price_ref, entry_delay_s: +f.entry_delay_s, expiry_mode: f.expiry_mode, expiry_bars: +f.expiry_bars,
      payout: +f.payout, tie_rule: f.tie_rule, settlement_offset_ms: +f.settlement_offset_ms, min_remaining_s: { M1: +f.min_m1, M5: +f.min_m5, M15: 300 } };
    await post("/api/broker", body); $("#broker-msg").textContent = "Regras salvas."; setTimeout(() => { $("#broker-msg").textContent = ""; }, 2500);
  };
  $("#train-assets").innerHTML = st.assets.map((a, i) => `<label><input type="checkbox" name="assets" value="${a}" ${i < 2 ? "checked" : ""}>${a.slice(0, 3)}/${a.slice(3)}</label>`).join("");
  loadMistakes(); loadRanking();
  const reps = (await api("/api/memory")).reports.filter((x) => x.kind === "treinamento");
  if (reps.length && !TR.shown) renderTraining(reps[0].body);
}
const STAGE_NAMES = ["Analisar dados históricos", "Identificar oportunidades hipotéticas", "Registrar entradas e expirações simuladas", "Conferir os resultados", "Investigar os erros", "Debater os erros entre os agentes", "Propor melhorias", "Testar as melhorias em dados não utilizados", "Aprovar ou rejeitar as melhorias", "Atualizar a memória coletiva"];
function renderStages(done, current) {
  $("#train-stages").innerHTML = STAGE_NAMES.map((n, i) => {
    const s = done.find((x) => x.n === i + 1);
    const cls = s ? "ok" : current === i + 1 ? "run" : "";
    return `<li class="${cls}"><b>Ciclo ${i + 1}</b> · ${esc(n)}${s ? `<div class="small muted">${esc(s.text)}</div>` : current === i + 1 ? '<div class="small wait">executando…</div>' : ""}</li>`;
  }).join("");
}
function renderTraining(rep) {
  TR.shown = true; renderStages(rep.stages, 0);
  const s9 = rep.stages.find((x) => x.n === 9); const res = (s9 && s9.data.results) || [];
  $("#train-result").innerHTML = `<p>${rep.promoted ? `<b class="up">Nova versão aprovada: ${esc(rep.promoted)}</b>` : "<b>Nenhuma melhoria aprovada</b> — a metodologia foi mantida."} ${rep.synthetic ? '<span class="down">(dados sintéticos)</span>' : ""}</p>
    ${res.length ? `<table><tr><th>Causa</th><th>Regra testada</th><th>Status</th><th>Motivo</th></tr>${res.map((r) => `<tr><td class="small">${esc(r.category)}</td><td class="small">${esc(r.rule)}</td><td><span class="tag ${r.status}">${r.status === "approved" ? "aprovada" : "rejeitada"}</span></td><td class="small">${esc(r.reason)}</td></tr>`).join("")}</table>` : '<p class="small muted">Sem perdas suficientes para propor regras.</p>'}`;
}
$("#train-form").onsubmit = async (e) => {
  e.preventDefault(); const btn = $("button", e.target); btn.disabled = true; TR.shown = false;
  const f = formData(e.target); f.study_mode = f.study_mode ? "1" : "0"; renderStages([], 1);
  const { job } = await post("/api/train", f);
  for (;;) {
    const j = await api(`/api/job?id=${job}`);
    const last = j.progress[j.progress.length - 1] || ""; const m = last.match(/Ciclo (\d+)\/10/);
    const done = j.progress.map((p) => { const mm = p.match(/Ciclo (\d+)\/10 · [^:]+: (.*)/); return mm ? { n: +mm[1], text: mm[2] } : null; }).filter(Boolean);
    renderStages(done, m ? +m[1] + 1 : 1);
    if (j.status !== "running") { btn.disabled = false; if (j.result) { renderTraining(j.result); loadMistakes(); loadRanking(); } else $("#train-result").textContent = j.error || "erro"; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }
};
async function loadMistakes() {
  const ms = await api("/api/mistakes");
  $("#mistakes").innerHTML = ms.length ? ms.slice(0, 60).map((m) => `<details class="mistake"><summary>
      <span class="mono small">${tsLbl(m.entry_ts)}</span> <b>${m.asset}</b> ${m.tf} <b class="${m.direction > 0 ? "up" : "down"}">${m.direction > 0 ? "CALL" : "PUT"}</b>
      ${fmtP(m.entry_price)} → ${fmtP(m.exit_price)} · <span class="down">LOSS</span> · ${(m.categories || []).map((c) => `<span class="tag">${esc(c)}</span>`).join(" ")} <span class="muted small">${esc(m.mode)}</span></summary>
      <p class="small"><b>Causa provável:</b> ${esc(m.cause)} · condição: ${esc(m.condition || "—")} · hora ${String(m.hour).padStart(2, "0")}h UTC · confluência ${m.analysis?.confluence ?? "—"}</p>
      <p class="small"><b>Análise original:</b> ${esc(m.analysis?.decision || "")} — ${esc(m.analysis?.reason || "")}</p>
      <p class="small"><b>Evidências:</b></p><ul class="list">${(m.evidence?.findings || []).map((f) => `<li class="small"><b>${esc(f.category)}:</b> ${esc(f.evidence)}</li>`).join("") || "<li class='small muted'>nenhuma falha identificável</li>"}</ul>
      <p class="small muted">Tendências na entrada: ${Object.entries(m.evidence?.trends || {}).map(([k, v]) => `${k} ${v}`).join(" · ")} · a favor durante a operação: ${m.evidence?.mfe_atr ?? "—"} ATR · depois da expiração: ${m.evidence?.post_atr ?? "—"} ATR · preço de entrada: ${esc(m.evidence?.entry_source || "")}</p>
      <p class="small"><b>Agentes:</b> erraram: ${esc((m.agents?.wrong || []).join(", ") || "—")} · ignorados: ${esc((m.agents?.ignored || []).join(", ") || "—")}</p>
      <div class="post-meeting">${(m.meeting || []).map((x) => `<div class="msg ${x.kind}"><b>${esc(x.speaker)}</b>${esc(x.text)}</div>`).join("")}</div>
      <p class="small"><b>Aprendizado:</b> ${esc(m.learning)}</p>
      <p class="small"><b>Regra de prevenção proposta:</b> ${(m.prevention || []).map((r) => esc(r.text)).join(" · ") || "—"} <span class="muted">(só é adotada após validação fora da amostra)</span></p>
    </details>`).join("") : `<p class="muted small">Nenhuma perda registrada ainda. Toda operação simulada que terminar em LOSS (ao vivo ou no treinamento) será investigada e aparecerá aqui.</p>`;
}
async function loadRanking() {
  const r = await api("/api/ranking");
  const names = Object.fromEntries((S.agents || []).map((a) => [a.code, `${a.person} · ${a.name}`]));
  const rows = (list) => list.map((x) => `<tr class="${x.enough ? "" : "dim"}"><td class="num">${x.rank}</td><td>${esc(names[x.agent] || x.agent)}</td><td class="num">${x.n}</td><td class="num">${x.errors}</td>
      <td class="num">${pct(x.hit_rate)}</td><td class="num muted">${pct(x.ci[0], 0)}–${pct(x.ci[1], 0)}</td><td class="num ${x.brier_skill > 0 ? "up" : "down"}">${x.brier_skill}</td>
      <td class="num">${x.by_tf.M1 ? pct(x.by_tf.M1.hit_rate) + ` <span class="muted">(${x.by_tf.M1.n})</span>` : "—"}</td><td class="num">${x.by_tf.M5 ? pct(x.by_tf.M5.hit_rate) + ` <span class="muted">(${x.by_tf.M5.n})</span>` : "—"}</td>
      <td class="small">${Object.entries(x.by_condition).map(([k, v]) => `${esc(k)} ${pct(v.hit_rate, 0)}`).join(" · ")}</td></tr>`).join("");
  const head = `<tr><th class="num">#</th><th>Agente</th><th class="num">análises</th><th class="num">erros</th><th class="num">acerto</th><th class="num">IC95%</th><th class="num">qualidade da confiança</th><th class="num">M1</th><th class="num">M5</th><th>por condição de mercado</th></tr>`;
  const src = r.live && r.live.length ? r.live : r.training || [];
  $("#ranking").innerHTML = src.length ? `<p class="small muted">${r.live && r.live.length ? "Simulações ao vivo" : `Último treinamento (${esc(r.training_at || "")})`}. Ordem por qualidade: limite inferior do IC95% + qualidade da confiança (Brier), não por número de vitórias. Linhas apagadas: menos de 30 avaliações.</p><div class="table-wrap"><table>${head}${rows(src)}</table></div>` : `<p class="muted small">Sem avaliações ainda.</p>`;
}

$("#mistakes-refresh").onclick = () => { loadMistakes(); loadRanking(); };

// ------------------------------------------------------------------ pesquisa (Agente 16)
const credTag = (c) => !c ? "" : `<span class="tag ${c.label === "suspeito" ? "rejected" : c.label === "confiável para estudo" ? "approved" : ""}">${esc(c.label)}</span>`;
const stTag = (s) => `<span class="tag ${s === "aprovado" ? "approved" : s === "rejeitado" ? "rejected" : ""}">${esc(s)}</span>`;
const st2 = (x) => x ? `${x.n} sinais · ${pct(x.rate)}${x.p_value != null ? ` · p ${x.p_value}` : ""}` : "—";
async function loadResearch() {
  const v = await api("/api/research");
  $("#res-key").innerHTML = v.youtube_key
    ? `<p class="small"><span class="ok-dot on"></span>Chave do YouTube configurada: o Henrique busca vídeos-aula sozinho.</p>`
    : `<p class="small"><span class="ok-dot"></span>Sem chave do YouTube: o Henrique pesquisa Wikipédia e estudos acadêmicos, e monta links de busca de vídeos para você abrir.</p>
       <details><summary class="small">Como conseguir a chave gratuita (5 minutos)</summary><ol class="steps small">
       <li>Entre em <span class="mono">console.cloud.google.com</span> com sua conta Google e crie um projeto.</li>
       <li>Em "APIs e serviços" → "Biblioteca", ative <b>YouTube Data API v3</b>.</li>
       <li>Em "Credenciais" → "Criar credenciais" → "Chave de API". Copie e cole abaixo.</li></ol></details>`;
  $("#res-items").innerHTML = v.items.length ? v.items.map((it) => `<div class="res-item">
      <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
      <div class="small muted">${esc(it.source)} · ${esc(it.kind)} · ${esc(it.channel || "")} ${it.published ? "· " + esc(String(it.published).slice(0, 10)) : ""}</div>
      <div class="small">${credTag(it.credibility)} ${(it.credibility?.flags || []).map((f) => `<span class="warn">⚠ ${esc(f)}</span>`).join(" ")}
        ${(it.mentions || []).length ? `<span class="muted">· cita: ${it.mentions.map((m) => esc(m.key)).join(", ")}</span>` : ""}</div>
    </div>`).join("") : `<p class="muted small">Biblioteca vazia. Clique em "Pesquisar e testar agora" (precisa de internet no computador onde o programa roda).</p>`;
  $("#res-lab").innerHTML = v.indicators.length ? `<div class="table-wrap"><table><tr><th>Indicador</th><th>Mesa</th><th>Status</th><th>Estudo</th><th>Validação (dados guardados)</th><th>Motivo</th><th>Origem</th></tr>
    ${v.indicators.map((r) => `<tr><td class="small" title="${esc(r.rule || "")}">${esc(r.label)}</td><td>${r.tf}</td><td>${stTag(r.status)}</td><td class="small mono">${st2(r.in)}</td><td class="small mono">${st2(r.out)}</td><td class="small">${esc(r.reason)}</td><td class="small muted">${esc(r.origin)}</td></tr>`).join("")}</table></div>
    <p class="small muted">Ponto de equilíbrio do payout: ${pct(v.indicators[0].breakeven)}. Só indicadores <b>aprovados</b> entram nas reuniões, pelo Henrique, com peso baixo.</p>`
    : `<p class="muted small">Nenhum indicador testado ainda.</p>`;
  $("#res-curr").innerHTML = v.curriculum.map((c) => `<details><summary><b>${esc(c.topic)}</b> <span class="tag">${esc(c.level)}</span></summary><p class="small">${esc(c.text)}</p><a class="small" href="${esc(c.link)}" target="_blank" rel="noopener">Buscar aulas sobre isso no YouTube ↗</a></details>`).join("");
  $("#res-cat").innerHTML = `<div class="table-wrap"><table><tr><th>Indicador</th><th>Regra testada</th><th></th></tr>${v.catalog.map((c) => `<tr><td class="small">${esc(c.name)}</td><td class="small">${esc(c.rule)}</td><td><a class="small" href="${esc(c.link)}" target="_blank" rel="noopener">aulas ↗</a></td></tr>`).join("")}</table></div>`;
}
$("#res-key-form").onsubmit = async (e) => { e.preventDefault(); await post("/api/research/key", { key: $("#res-key-input").value }); $("#res-key-input").value = ""; loadResearch(); };
$("#res-run").onclick = async () => {
  const btn = $("#res-run"); btn.disabled = true; $("#res-log").textContent = "pesquisando…";
  const { job } = await post("/api/research/run", { max_queries: 6, max_tests: 12 });
  for (;;) {
    const j = await api(`/api/job?id=${job}`);
    $("#res-log").innerHTML = j.progress.slice(-6).map((p) => `<div>${esc(p)}</div>`).join("") || "pesquisando…";
    if (j.status !== "running") {
      btn.disabled = false;
      if (j.result) $("#res-log").innerHTML = `<div><b>${j.result.found}</b> materiais (${j.result.new_items} novos) · <b>${j.result.tested}</b> testes · aprovados: ${j.result.approved.length ? esc(j.result.approved.join(", ")) : "nenhum"}</div>` + j.result.log.map((l) => `<div class="muted">${esc(l)}</div>`).join("");
      else $("#res-log").textContent = j.error || "erro";
      loadResearch(); break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
};
$("#res-text-form").onsubmit = async (e) => {
  e.preventDefault(); const t = $("#res-text").value.trim(); if (!t) return;
  $("#res-text-out").textContent = "testando…";
  const r = await post("/api/research/text", { text: t });
  $("#res-text-out").innerHTML = `<p class="small">Credibilidade do texto: ${credTag(r.credibility)} ${(r.credibility.flags || []).map((f) => `<span class="warn">⚠ ${esc(f)}</span>`).join(" ")}</p>` +
    (r.note ? `<p class="small wait">${esc(r.note)}</p>` : `<table><tr><th>Ideia</th><th>Mesa</th><th>Status</th><th>Validação</th><th>Motivo</th></tr>${r.results.map((x) => `<tr><td class="small">${esc(x.label)}</td><td>${x.tf}</td><td>${stTag(x.status)}</td><td class="small mono">${st2(x.out_sample)}</td><td class="small">${esc(x.reason)}</td></tr>`).join("")}</table>`);
  loadResearch();
};

// ------------------------------------------------------------------ conferência de marcações
$("#mk-office").onchange = (e) => { MK.office = e.target.checked; if (S.analysis) drawChart(S.analysis); };
$("#mk-user").onchange = (e) => { MK.user = e.target.checked; if (S.analysis) drawChart(S.analysis); };
async function loadCheck() {
  const r = await api(`/api/markings?asset=${S.asset}&tf=${S.tf}`);
  const el = $("#check"); if (!el) return;
  if (r.error) { el.textContent = r.error; return; }
  const oc = r.office_counts;
  let html = `<p class="small">O escritório detectou em ${r.asset.slice(0, 3)}/${r.asset.slice(3)} ${r.tf}: <b>${oc["BOS/CHoCH"]}</b> BOS/CHoCH, <b>${oc.Zonas}</b> zonas (OB/FVG), <b>${oc["Níveis"]}</b> níveis de liquidez/S/R — todos desenhados no gráfico acima.</p>`;
  if (!r.connected) {
    html += `<p class="small wait">Sem conexão com o MT5 nesta sessão: não dá para comparar com o seu indicador. No programa instalado, abra o gráfico do par com o seu indicador e deixe o TIO_Exportador ligado em qualquer gráfico.</p>`;
  } else if (!r.indicator) {
    const charts = r.charts.map((c) => `${c.symbol} ${c.tf} (${c.indicators.join(", ") || "sem indicadores"})`).join(" · ");
    html += `<p class="small wait"><b>Nenhuma marcação do seu indicador chegou para ${r.tf}.</b> Gráficos abertos deste par: ${esc(charts || "nenhum")}. Abra no MT5 o gráfico de ${r.asset} em ${r.tf} com o seu indicador. Se ele aparece na lista mas não há marcações, ele desenha só em buffers: escolha-o na aba MT5.</p>`;
  } else {
    const cp = r.compare;
    html += `<p class="small">Seu indicador (<b>${esc(r.indicator.name)}</b>) tem <b>${r.indicator.objects}</b> objetos no gráfico ${r.tf}. Os agentes leem essas marcações (Nina · agente 13) e o escritório coincide com <b>${cp.rate == null ? "—" : pct(cp.rate, 0)}</b> delas:</p>
      <div class="check-grid">${Object.entries(cp.by_kind).map(([k, v]) => `<div class="kpi"><small>${esc(k)}</small><b>${v.matched}/${v.indicator}</b>${v.rate != null ? ` <span class="small ${v.rate >= 0.6 ? "up" : "wait"}">${pct(v.rate, 0)}</span>` : ""}
        ${v.missed.length ? `<div class="small muted">não detectado pelo escritório: ${v.missed.map((x) => esc((x.kind || "") + " " + fmtP(x.price ?? x.low))).join(", ")}</div>` : ""}</div>`).join("")}</div>
      <p class="small muted">As marcações do seu indicador aparecem no gráfico com ★ (amarelo). Diferenças são normais: cada indicador usa regras próprias de pivô e tolerância.</p>`;
  }
  el.innerHTML = html;
}
$("#check-refresh").onclick = loadCheck;

// ------------------------------------------------------------------ boot
$("#refresh").onclick = () => { loadOverview(); loadAnalysis(); loadHistory(); };
window.addEventListener("resize", () => { if (S.analysis && $("#painel").classList.contains("on")) drawAll(); });
(async () => {
  await loadStatus(); await loadAgents(); if (window.OFFICE && activeTab() === "escritorio") window.OFFICE.show();
  loadMulti(); await loadAnalysis(); loadOverview(); loadHistory();
  setInterval(() => { const t = activeTab(); if (t === "multi") loadMulti(); else if (t === "painel") { loadAnalysis(); loadHistory(); } }, 15000);
  setInterval(() => { loadStatus(); if (activeTab() === "mt5") loadMT5(); }, 30000);
})();
