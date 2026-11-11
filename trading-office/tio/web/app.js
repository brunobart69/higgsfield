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

function drawChart(an) {
  const cv = $("#chart"); const [c, W, H] = ctx2d(cv);
  const ch = an.chart; const cs = ch.candles; if (!cs.length) return;
  const padR = 64, padB = 18;
  let lo = Math.min(...cs.map((k) => k[3])), hi = Math.max(...cs.map((k) => k[2]));
  const m = (hi - lo) * 0.08; lo -= m; hi += m;
  const y = (p) => (H - padB) * (1 - (p - lo) / (hi - lo));
  const bw = (W - padR) / cs.length;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = css("--line"); c.lineWidth = 1; c.fillStyle = css("--muted"); c.font = "10px JetBrains Mono, monospace";
  for (let i = 0; i <= 5; i++) { const p = lo + (hi - lo) * i / 5; const yy = y(p); c.beginPath(); c.moveTo(0, yy); c.lineTo(W - padR, yy); c.stroke(); c.fillText(fmtP(p), W - padR + 4, yy + 3); }
  const band = (a, b, color) => { if (a == null || b == null) return; c.fillStyle = color; c.fillRect(0, y(Math.max(a, b)), W - padR, Math.abs(y(a) - y(b)) || 1); };
  const line = (p, color, dash, label) => { if (p == null || p < lo || p > hi) return; c.strokeStyle = color; c.setLineDash(dash || []); c.beginPath(); c.moveTo(0, y(p)); c.lineTo(W - padR, y(p)); c.stroke(); c.setLineDash([]); if (label) { c.fillStyle = color; c.fillText(label, 4, y(p) - 3); } };
  band(ch.val, ch.vah, "rgba(242,181,58,.06)");
  const lastPx = cs[cs.length - 1][4];
  (ch.zones || []).slice().sort((a, b) => Math.abs((a.low + a.high) / 2 - lastPx) - Math.abs((b.low + b.high) / 2 - lastPx)).slice(0, 4).forEach((z) => band(z.low, z.high, "rgba(74,168,255,.12)"));
  (ch.fvg || []).forEach((z) => band(z.low, z.high, z.dir > 0 ? "rgba(25,210,124,.08)" : "rgba(255,77,94,.08)"));
  line(ch.poc, css("--amber"), [], "POC");
  Object.entries(ch.fib || {}).forEach(([cat, f]) => {
    ["0.382", "0.500", "0.618"].forEach((k) => line(f.levels[k], "rgba(111,211,196,.55)", [2, 4], `${cat} ${k}`));
  });
  (ch.pools || []).filter((p) => (p.count || 1) > 1).slice(0, 4).forEach((p) => line(p.price, "rgba(180,140,255,.7)", [6, 4], `${p.kind}`));
  cs.forEach((k, i) => {
    const [ts, o, h, l, cl] = k; const x = i * bw + bw / 2; const up = cl >= o;
    c.strokeStyle = c.fillStyle = up ? css("--green") : css("--red");
    c.beginPath(); c.moveTo(x, y(h)); c.lineTo(x, y(l)); c.stroke();
    const top = y(Math.max(o, cl)), bot = y(Math.min(o, cl));
    c.fillRect(x - bw * 0.35, top, Math.max(1, bw * 0.7), Math.max(1, bot - top));
  });
  const last = cs[cs.length - 1][4]; c.fillStyle = css("--text"); c.fillRect(W - padR, y(last) - 7, padR, 14); c.fillStyle = "#000"; c.fillText(fmtP(last), W - padR + 4, y(last) + 3);
  c.fillStyle = css("--muted"); c.fillText(tsLbl(cs[0][0]), 2, H - 4); c.fillText(tsLbl(cs[cs.length - 1][0]) + " UTC", W - padR - 120, H - 4);
}

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
  const sel = $("#asset"); sel.innerHTML = st.assets.map((a) => `<option value="${a}">${a.slice(0, 3)}/${a.slice(3)}</option>`).join("");
  sel.value = S.asset; sel.onchange = () => { S.asset = sel.value; loadAnalysis(); };
  $("#bt-assets").innerHTML = st.assets.map((a, i) => `<label><input type="checkbox" name="assets" value="${a}" ${i === 0 ? "checked" : ""}>${a.slice(0, 3)}/${a.slice(3)}</label>`).join("");
  $("#learn-assets").innerHTML = st.assets.map((a, i) => `<label><input type="checkbox" name="assets" value="${a}" ${i < 3 ? "checked" : ""}>${a.slice(0, 3)}/${a.slice(3)}</label>`).join("");
  $("#bt-strategy").innerHTML = st.strategies.map((s) => `<option>${s}</option>`).join("");
  const tfs = st.tfs || ["M15"]; if (!tfs.includes(S.tf)) S.tf = tfs[0];
  $("#tfsel").innerHTML = tfs.map((t) => `<button data-tf="${t}" class="${t === S.tf ? "on" : ""}">${t}</button>`).join("");
  $$("#tfsel button").forEach((b) => b.onclick = () => {
    S.tf = b.dataset.tf; try { localStorage.setItem("tio_tf", S.tf); } catch (e) { /* ignore */ }
    $$("#tfsel button").forEach((x) => x.classList.toggle("on", x === b)); S.chatShown = null;
    loadAnalysis(); loadOverview(); if (activeTab() === "multi") loadMulti();
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
  S.analysis = an; drawAll(); renderRoom();
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
  $("#fib").innerHTML = ["DIAMANTE", "OURO", "PRATA", "BRONZE"].map((k) => { const f = cats[k]; if (!f) return `<details><summary>${k} <span class="muted small">sem dados</span></summary></details>`;
    return `<details><summary><b>${k}</b> <span class="muted small">${esc(f.ref)}</span></summary><table>${Object.entries(f.levels).map(([l, v]) => `<tr><td>${l}</td><td class="num">${fmtP(v)}</td></tr>`).join("")}</table></details>`; }).join("") +
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

// ------------------------------------------------------------------ boot
$("#refresh").onclick = () => { loadOverview(); loadAnalysis(); loadHistory(); };
window.addEventListener("resize", () => { if (S.analysis && $("#painel").classList.contains("on")) drawAll(); });
(async () => {
  await loadStatus(); await loadAgents(); loadMulti(); await loadAnalysis(); loadOverview(); loadHistory();
  setInterval(() => { const t = activeTab(); if (t === "multi") loadMulti(); else if (t === "painel") { loadAnalysis(); loadHistory(); } }, 15000);
  setInterval(() => { loadStatus(); if (activeTab() === "mt5") loadMT5(); }, 30000);
})();
