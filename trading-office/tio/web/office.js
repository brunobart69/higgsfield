"use strict";
/* Escritório virtual: cada agente é uma pessoa com mesa, computador e rotina.
   Depende de helpers globais de app.js ($, $$, esc, api, S, dirLbl, css, fmtP, pct, decCls). */
(function () {
  const W = 1280, H = 760, T = 10;               // mundo lógico e tamanho da célula de navegação
  const COLS = W / T, ROWS = H / T;
  const SPEED = 75;                               // px/s

  // ---------------------------------------------------------------- planta
  const walls = [];
  const wall = (x, y, w, h) => walls.push({ x, y, w, h });
  // contorno
  wall(0, 0, W, 14); wall(0, H - 14, W, 14); wall(0, 0, 14, H); wall(W - 14, 0, 14, H);
  // salas superiores (paredes de vidro/divisórias); portas são as lacunas
  wall(300, 14, 8, 246); wall(780, 14, 8, 246); wall(1000, 14, 8, 246);
  wall(14, 256, 126, 8); wall(184, 256, 116, 8);                 // sala do Head (porta 140-184)
  wall(300, 256, 80, 8); wall(424, 256, 236, 8); wall(704, 256, 84, 8); // reunião (portas 380-424, 660-704)
  wall(780, 256, 86, 8); wall(910, 256, 98, 8);                  // sala do Risk (porta 866-910)
  wall(1000, 256, 70, 8); wall(1190, 256, 76, 8);                // copa (abertura larga)

  const furniture = [];
  const furn = (kind, x, y, w, h, extra) => { const f = { kind, x, y, w, h, ...(extra || {}) }; furniture.push(f); return f; };
  // sala do Head Trader
  furn("desk", 95, 92, 150, 46, { owner: "HEAD" });
  furn("shelf", 22, 40, 26, 150);
  furn("plant", 258, 28, 30, 30);
  furn("sofa", 200, 200, 80, 34);
  // sala de reunião
  const table = furn("table", 380, 98, 320, 82);
  furn("screen", 450, 18, 180, 14);
  furn("plant", 320, 24, 26, 26); furn("plant", 740, 24, 26, 26);
  // sala do Risk Manager
  furn("desk", 828, 92, 130, 46, { owner: "RISK" });
  furn("safe", 950, 28, 36, 36);
  furn("plant", 794, 200, 26, 26);
  // copa
  furn("counter", 1020, 22, 238, 34);
  furn("coffee", 1040, 22, 34, 30);
  furn("fridge", 1220, 60, 36, 56);
  furn("round", 1100, 140, 64, 64);
  // área de trabalho
  const DESKS = ["NEWS", "PA", "RET", "REV", "VOL", "VP", "SR", "FIB", "MTF", "LIQ", "MT5I", "TL", "TIM", "RES", "PB"];
  const deskPos = {};
  DESKS.forEach((code, i) => {
    const row = Math.floor(i / 8), col = i % 8;
    const x = 26 + col * 138, y = row === 0 ? 384 : 566;
    furn("desk", x, y, 112, 44, { owner: code });
    deskPos[code] = { x: x + 56, y: y + 72 };
  });
  furn("board", 1140, 352, 112, 382);            // painel de cotações
  furn("plant", 20, 290, 28, 28); furn("plant", 20, 712, 28, 28); furn("plant", 1100, 712, 28, 28);
  furn("cooler", 1100, 290, 26, 30);
  deskPos.HEAD = { x: 170, y: 166 };
  deskPos.RISK = { x: 893, y: 166 };

  // cadeiras da reunião: Head na cabeceira esquerda, Risk na direita, 6 em cima e 6 embaixo
  const meetSeat = { HEAD: { x: 360, y: 139 }, RISK: { x: 720, y: 139 } };
  DESKS.forEach((code, i) => {
    const top = i < 8; const k = top ? i : i - 8;
    meetSeat[code] = { x: 400 + k * 39, y: top ? 80 : 198 };
  });
  const coffeeSpots = [{ x: 1060, y: 78 }, { x: 1110, y: 78 }, { x: 1160, y: 78 }, { x: 1085, y: 222 }, { x: 1180, y: 222 }, { x: 1112, y: 312 }];

  // ---------------------------------------------------------------- grade de navegação
  const blocked = new Uint8Array(COLS * ROWS);
  const block = (r, pad) => {
    const x0 = Math.max(0, Math.floor((r.x - pad) / T)), x1 = Math.min(COLS - 1, Math.floor((r.x + r.w + pad) / T));
    const y0 = Math.max(0, Math.floor((r.y - pad) / T)), y1 = Math.min(ROWS - 1, Math.floor((r.y + r.h + pad) / T));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked[y * COLS + x] = 1;
  };
  walls.forEach((w) => block(w, 7));
  furniture.forEach((f) => block(f, f.kind === "table" ? 2 : 5));
  const free = (cx, cy) => cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS && !blocked[cy * COLS + cx];
  function nearestFree(cx, cy) {
    if (free(cx, cy)) return [cx, cy];
    for (let r = 1; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(cx + dx, cy + dy)) return [cx + dx, cy + dy];
    return [cx, cy];
  }
  function findPath(ax, ay, bx, by) {
    const [sx, sy] = nearestFree(Math.floor(ax / T), Math.floor(ay / T));
    const [gx, gy] = nearestFree(Math.floor(bx / T), Math.floor(by / T));
    const start = sy * COLS + sx, goal = gy * COLS + gx;
    const g = new Float32Array(COLS * ROWS).fill(Infinity), came = new Int32Array(COLS * ROWS).fill(-1);
    const open = [[0, start]]; g[start] = 0;
    const h = (i) => { const dx = Math.abs(i % COLS - gx), dy = Math.abs(Math.floor(i / COLS) - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const closed = new Uint8Array(COLS * ROWS);
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === goal) break;
      if (closed[cur]) continue; closed[cur] = 1;
      const cx = cur % COLS, cy = Math.floor(cur / COLS);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy;
        if (!free(nx, ny)) continue;
        if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
        const ni = ny * COLS + nx, ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; open.push([ng + h(ni), ni]); }
      }
    }
    if (came[goal] === -1 && goal !== start) return [{ x: bx, y: by }];
    const cells = []; for (let c = goal; c !== -1 && c !== start; c = came[c]) cells.push(c);
    cells.reverse();
    // simplifica: mantém só pontos onde a direção muda
    const pts = []; let pdx = null, pdy = null, prev = start;
    cells.forEach((c, i) => {
      const dx = c % COLS - prev % COLS, dy = Math.floor(c / COLS) - Math.floor(prev / COLS);
      if (pdx !== null && (dx !== pdx || dy !== pdy)) pts.push({ x: (prev % COLS) * T + T / 2, y: Math.floor(prev / COLS) * T + T / 2 });
      pdx = dx; pdy = dy; prev = c;
    });
    pts.push({ x: bx, y: by });
    return pts;
  }

  // ---------------------------------------------------------------- pessoas
  const LOOKS = {
    NEWS: { shirt: "#c0563f", skin: "#c58c63", hair: "#2b1d16", style: "long" },
    PA: { shirt: "#2f7fd1", skin: "#e2b48d", hair: "#3b2a1a", style: "short" },
    RET: { shirt: "#8e5cc2", skin: "#8d5a3b", hair: "#120c08", style: "bun" },
    REV: { shirt: "#3f8f6b", skin: "#f0c9a4", hair: "#9a9a9a", style: "short" },
    VOL: { shirt: "#d6884a", skin: "#e8c09a", hair: "#b0642c", style: "long" },
    VP: { shirt: "#2e9aa5", skin: "#6e4630", hair: "#0f0a07", style: "buzz" },
    SR: { shirt: "#5a6bd1", skin: "#d9a57d", hair: "#5a3a22", style: "bob" },
    FIB: { shirt: "#b8a13a", skin: "#f2d0ae", hair: "#d9c7a0", style: "short" },
    MTF: { shirt: "#c24f86", skin: "#a8724d", hair: "#24170f", style: "long" },
    LIQ: { shirt: "#4c5562", skin: "#e0b088", hair: "#151515", style: "short" },
    MT5I: { shirt: "#1fa37a", skin: "#f1c6a2", hair: "#7a2f22", style: "bun" },
    TL: { shirt: "#d0603a", skin: "#7b4c31", hair: "#0c0907", style: "buzz" },
    TIM: { shirt: "#e0b23c", skin: "#c99572", hair: "#3a2416", style: "long" },
    RES: { shirt: "#5b7f3a", skin: "#e9c19b", hair: "#6b4a2b", style: "short" },
    PB: { shirt: "#3b6fd6", skin: "#b07a55", hair: "#1a120c", style: "bob" },
    RISK: { shirt: "#7d2f3b", skin: "#e6b994", hair: "#4a4a4a", style: "bob" },
    HEAD: { shirt: "#1d2b3a", skin: "#d4a07a", hair: "#2d2d2d", style: "short", tie: true },
  };
  const people = {};
  const O = { on: false, canvas: null, ctx: null, scale: 1, t: 0, last: 0, analysis: null, catalog: [], selected: null,
    meeting: null, feed: [], hover: null, scan: null, nextMeetingAt: 0, lastAsOf: null, speed: 1 };
  window.OFFICE = O;

  function makePeople() {
    O.catalog.forEach((a) => {
      if (people[a.code]) return;
      const seat = deskPos[a.code] || { x: 640, y: 320 };
      people[a.code] = { code: a.code, card: a, x: seat.x, y: seat.y, path: [], state: "work", until: performance.now() / 1000 + 3 + Math.random() * 12,
        bubble: null, look: LOOKS[a.code] || LOOKS.PA, phase: Math.random() * 6, moving: false, target: null, task: "trabalhando", onArrive: null };
    });
  }
  const nameOf = (code) => (people[code] ? people[code].card.person : code);
  const codeByAgentName = (n) => { const a = O.catalog.find((x) => x.name === n); return a ? a.code : null; };

  function goTo(p, x, y, task, onArrive) {
    p.path = findPath(p.x, p.y, x, y); p.moving = true; p.task = task; p.onArrive = onArrive || null;
  }
  function say(code, text, secs) {
    const p = people[code]; if (!p) return;
    const dur = secs || Math.min(7, Math.max(2.6, 1.6 + text.length * 0.035)) / O.speed;
    p.bubble = { text, until: O.t + dur };
    O.feed.push({ who: p.card.person, role: p.card.name, code, text, t: new Date() });
    if (O.feed.length > 80) O.feed.shift();
    renderFeed();
  }

  // ---------------------------------------------------------------- análise e reuniões
  const reportOf = (code) => (O.analysis && O.analysis.reports || []).find((r) => r.agent === code);
  async function refresh(force) {
    try {
      const an = await api(`/api/analysis?asset=${S.asset}&tf=${S.tf}`);
      if (an && !an.error) {
        const changed = force || !O.analysis || an.as_of !== O.lastAsOf || an.asset !== O.analysis.asset || an.timeframe !== O.analysis.timeframe;
        O.analysis = an; O.lastAsOf = an.as_of;
        // nova vela fechada => nova reunião (com intervalo mínimo de 75 s para não reunir sem parar no M1)
        if (changed && !O.meeting && (force || !O.lastMeetingStart || O.t - O.lastMeetingStart > 75)) startMeeting();
      }
      O.scan = await api(`/api/scan?tf=${S.tf}`);
      await checkLosses();
    } catch (e) { /* servidor indisponível: o escritório continua animado */ }
    updateTopbar();
  }
  async function checkLosses() {
    try {
      const ms = await api(`/api/mistakes?mode=live&since=${O.lastMistake || 0}`);
      if (O.lastMistake === undefined) { O.lastMistake = ms.length ? ms[0].id : 0; return; }   // não reprisa perdas antigas
      if (ms.length && !O.meeting) { O.lastMistake = ms[0].id; startMeeting(ms[ms.length - 1]); }
    } catch (e) { /* sem servidor */ }
  }
  function startMeeting(loss) {
    if (!O.analysis && !loss) return;
    const tr = loss ? loss.meeting.map((m) => ({ ...m, speaker: m.speaker })) : (O.analysis.transcript || []).filter((m) => m.kind !== "system");
    if (loss) {
      O.meeting = { phase: "gather", started: O.t, queue: tr.slice(), next: 0, loss: true };
      O.lastMeetingStart = O.t;
      say("HEAD", `Equipe, reunião pós-LOSS: ${loss.direction > 0 ? "CALL" : "PUT"} em ${loss.asset.slice(0, 3)}/${loss.asset.slice(3)} ${loss.tf}. Vamos descobrir por que perdemos.`, 4);
      const involved = new Set(["HEAD", "RISK", ...loss.meeting.map((m) => codeByAgentName(m.speaker)).filter(Boolean)]);
      Object.values(people).forEach((p) => { if (involved.has(p.code)) { const s = meetSeat[p.code]; goTo(p, s.x, s.y, "na reunião pós-LOSS"); } });
      updateTopbar();
      return;
    }
    O.meeting = { phase: "gather", started: O.t, queue: tr.slice(), next: 0 };
    O.lastMeetingStart = O.t;
    say("HEAD", `Pessoal, reunião sobre ${O.analysis.asset.slice(0, 3)}/${O.analysis.asset.slice(3)} em ${O.analysis.timeframe}. Todos para a sala de reunião!`, 3);
    Object.values(people).forEach((p) => { p.bubble = p.code === "HEAD" ? p.bubble : null; const s = meetSeat[p.code]; if (s) goTo(p, s.x, s.y, "na reunião"); });
  }
  function meetingTick() {
    const m = O.meeting; if (!m) return;
    const all = Object.values(people);
    if (m.phase === "gather") {
      const arrived = all.filter((p) => (p.task || "").startsWith("na reunião")).every((p) => !p.moving);
      if (arrived || O.t - m.started > 14) { m.phase = "talk"; m.next = O.t + 0.5; }
      return;
    }
    if (m.phase === "talk" && O.t >= m.next) {
      let msg = m.queue.shift();
      while (msg && msg.text.startsWith("⚠")) {   // alertas: só no histórico, sem balão
        const cw = msg.speaker === "Head Trader" ? "HEAD" : codeByAgentName(msg.speaker);
        if (cw) { O.feed.push({ who: people[cw].card.person, role: people[cw].card.name, code: cw, text: msg.text, t: new Date() }); }
        msg = m.queue.shift();
      }
      renderFeed();
      if (!msg) { m.phase = "end"; m.next = O.t + 4 / O.speed; return; }
      const code = msg.speaker === "Head Trader" ? "HEAD" : msg.speaker === "Risk Manager" ? "RISK" : codeByAgentName(msg.speaker);
      if (code) {
        say(code, msg.text, msg.kind === "decision" ? 8 / O.speed : Math.min(5, Math.max(2.2, 1.4 + msg.text.length * 0.022)) / O.speed);
        m.next = O.t + (people[code].bubble.until - O.t) + 0.25 / O.speed;
        if (msg.kind === "challenge" && msg.target && people[msg.target]) {
          const p = people[code], tg = people[msg.target]; p.face = Math.atan2(tg.y - p.y, tg.x - p.x);
        }
      }
      return;
    }
    if (m.phase === "end" && O.t >= m.next) {
      O.meeting = null;
      all.filter((p) => (p.task || "").startsWith("na reunião") || !m.loss).forEach((p) => { const s = deskPos[p.code]; goTo(p, s.x, s.y, "voltando para a mesa", () => { p.state = "work"; p.task = "trabalhando"; p.until = O.t + 6 + Math.random() * 14; }); });
      O.nextMeetingAt = O.t + 180;
    }
  }

  // ---------------------------------------------------------------- rotina individual
  function smallTalk(p, tg) {
    const div = (O.analysis && O.analysis.divergences || []).find((d) => (d.a === p.code && d.b === tg.code) || (d.b === p.code && d.a === tg.code));
    const mine = reportOf(p.code), theirs = reportOf(tg.code);
    if (div && mine && theirs) {
      say(p.code, `${tg.card.person}, estou vendo ${dirLbl[mine.bias]} e você ${dirLbl[theirs.bias]}. Meu ponto: ${(mine.summary || "").slice(0, 120)}`);
      setTimeout(() => say(tg.code, `${p.card.person}, entendo, mas ${(theirs.summary || "").slice(0, 120)}`), 3600 / O.speed);
    } else if (theirs) {
      say(p.code, `${tg.card.person}, como está ${O.analysis.asset.slice(0, 3)}/${O.analysis.asset.slice(3)} pra você?`);
      setTimeout(() => say(tg.code, (theirs.summary || "Sem novidades por aqui.").slice(0, 240)), 2600 / O.speed);
    } else {
      say(p.code, `${tg.card.person}, tudo certo por aí?`);
    }
  }
  function routine(p) {
    if (O.meeting || p.moving || p.paused || O.t < p.until) return;
    if (p.state === "work") {
      const r = Math.random();
      if (r < 0.22) {
        const s = coffeeSpots[Math.floor(Math.random() * coffeeSpots.length)];
        p.state = "away";
        goTo(p, s.x, s.y, "pegando café", () => { p.task = "na copa"; p.until = O.t + 4 + Math.random() * 5; if (Math.random() < 0.4) say(p.code, ["Café forte hoje.", "Mercado lateral pede paciência.", "Volto já pra mesa.", "Alguém viu o calendário econômico?"][Math.floor(Math.random() * 4)]); });
        return;
      }
      if (r < 0.5 && p.code !== "HEAD") {
        const others = Object.values(people).filter((o) => o !== p && o.state === "work" && !o.moving);
        if (others.length) {
          const tg = others[Math.floor(Math.random() * others.length)]; const s = deskPos[tg.code];
          p.state = "away";
          goTo(p, s.x + (s.x > 640 ? -30 : 30), s.y + 6, `conversando com ${tg.card.person}`, () => { p.task = `conversando com ${tg.card.person}`; p.face = Math.atan2(tg.y - p.y, tg.x - p.x); smallTalk(p, tg); p.until = O.t + 8 / O.speed; });
          return;
        }
      }
      p.until = O.t + 6 + Math.random() * 14;
      return;
    }
    if (p.state === "away") {
      const s = deskPos[p.code];
      goTo(p, s.x, s.y, "voltando para a mesa", () => { p.state = "work"; p.task = "trabalhando"; p.until = O.t + 8 + Math.random() * 16; p.face = undefined; });
    }
  }
  function move(p, dt) {
    if (!p.path.length) { if (p.moving) { p.moving = false; const cb = p.onArrive; p.onArrive = null; if (cb) cb(); } return; }
    const tgt = p.path[0]; const dx = tgt.x - p.x, dy = tgt.y - p.y; const d = Math.hypot(dx, dy);
    const step = SPEED * dt * O.speed;
    if (d <= step) { p.x = tgt.x; p.y = tgt.y; p.path.shift(); } else { p.x += dx / d * step; p.y += dy / d * step; p.face = Math.atan2(dy, dx); }
  }

  // ---------------------------------------------------------------- desenho
  const C = () => O.ctx;
  function rr(x, y, w, h, r) { const c = C(); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function drawFloor() {
    const c = C();
    c.fillStyle = "#1a2026"; c.fillRect(0, 0, W, H);
    // carpete da área de trabalho
    c.fillStyle = "#1c2a2a"; c.fillRect(14, 340, W - 28, H - 354);
    c.strokeStyle = "rgba(255,255,255,.025)"; for (let x = 14; x < W; x += 40) { c.beginPath(); c.moveTo(x, 340); c.lineTo(x, H - 14); c.stroke(); }
    // corredor
    c.fillStyle = "#232a31"; c.fillRect(14, 264, W - 28, 76);
    // salas: piso de madeira / copa em ladrilho
    const wood = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); c.strokeStyle = "rgba(0,0,0,.18)"; for (let yy = y; yy < y + h; yy += 14) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); } };
    wood(14, 14, 286, 242, "#3a2e25"); wood(308, 14, 472, 242, "#2f2823"); wood(788, 14, 212, 242, "#3a2e25");
    c.fillStyle = "#2a3036"; c.fillRect(1008, 14, 258, 242);
    c.strokeStyle = "rgba(255,255,255,.04)"; for (let x = 1008; x < 1266; x += 20) for (let y = 14; y < 256; y += 20) c.strokeRect(x, y, 20, 20);
    // tapete da reunião
    c.fillStyle = "#2b3a46"; rr(352, 56, 376, 170, 14); c.fill();
    // rótulos das salas
    c.fillStyle = "rgba(255,255,255,.28)"; c.font = "600 11px Inter, sans-serif";
    c.fillText("DIRETORIA · HEAD TRADER", 26, 248); c.fillText("SALA DE REUNIÃO", 316, 248); c.fillText("GESTÃO DE RISCO", 798, 248); c.fillText("COPA", 1020, 248);
    c.fillText("MESA DE ANÁLISE", 26, 360);
  }
  function drawWalls() {
    const c = C();
    walls.forEach((w) => { c.fillStyle = "#4a5866"; c.fillRect(w.x, w.y, w.w, w.h); c.fillStyle = "rgba(160,210,255,.12)"; if (w.h === 8 || w.w === 8) c.fillRect(w.x + 1, w.y + 1, Math.max(1, w.w - 2), Math.max(1, w.h - 2)); });
    // janelas no topo
    c.fillStyle = "rgba(140,200,255,.35)"; for (let x = 40; x < W - 40; x += 90) c.fillRect(x, 3, 54, 6);
  }
  function monitorColor(code) {
    if (code === "HEAD") return O.analysis ? (O.analysis.decision.includes("ALTA") ? css("--green") : O.analysis.decision.includes("BAIXA") ? css("--red") : O.analysis.decision.includes("AGUARDAR") ? css("--amber") : "#7d8a95") : "#445";
    if (code === "RISK") return O.analysis && O.analysis.risk ? (O.analysis.risk.approved ? css("--green") : css("--red")) : "#7d8a95";
    const r = reportOf(code); if (!r) return "#445"; if (r.abstain) return "#3a4450";
    return r.bias > 0 ? css("--green") : r.bias < 0 ? css("--red") : "#7d8a95";
  }
  function drawFurniture() {
    const c = C();
    furniture.forEach((f) => {
      switch (f.kind) {
        case "desk": {
          c.fillStyle = "#6b5440"; rr(f.x, f.y, f.w, f.h, 4); c.fill(); c.fillStyle = "#7a6149"; c.fillRect(f.x + 3, f.y + 3, f.w - 6, 5);
          // computador: dois monitores
          const col = monitorColor(f.owner);
          const mx = f.x + f.w / 2;
          [-24, 8].forEach((o) => { c.fillStyle = "#11161b"; rr(mx + o, f.y + 8, 30, 18, 2); c.fill(); c.fillStyle = col; c.globalAlpha = 0.85; c.fillRect(mx + o + 2, f.y + 10, 26, 13); c.globalAlpha = 1;
            c.strokeStyle = "rgba(0,0,0,.45)"; c.beginPath(); for (let k = 0; k < 6; k++) { const xx = mx + o + 3 + k * 4.4; const yy = f.y + 17 + Math.sin(O.t * 2 + k + o) * 3; k ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke(); });
          c.fillStyle = "#2a2f36"; c.fillRect(mx - 14, f.y + 30, 28, 8);   // teclado
          c.fillStyle = "#cfd5da"; c.fillRect(f.x + 8, f.y + 30, 10, 8);    // caneca/papel
          // cadeira
          const seat = deskPos[f.owner]; if (seat) { c.fillStyle = "#20262c"; rr(seat.x - 12, seat.y - 8, 24, 22, 6); c.fill(); }
          // placa com nome
          const p = people[f.owner];
          if (p) { c.fillStyle = "rgba(0,0,0,.45)"; rr(f.x + 4, f.y + f.h - 2, f.w - 8, 14, 3); c.fill(); c.fillStyle = "#cfd8df"; c.font = "600 9.5px Inter, sans-serif"; c.textAlign = "center"; c.fillText(`${p.card.person} · ${shortRole(p.card)}`, f.x + f.w / 2, f.y + f.h + 9); c.textAlign = "left"; }
          break;
        }
        case "table": c.fillStyle = "#5d4a3b"; rr(f.x, f.y, f.w, f.h, 30); c.fill(); c.fillStyle = "rgba(255,255,255,.06)"; rr(f.x + 10, f.y + 8, f.w - 20, 14, 7); c.fill();
          c.fillStyle = "#11161b"; rr(f.x + f.w / 2 - 40, f.y + f.h / 2 - 12, 80, 24, 4); c.fill(); // telefone de conferência / tela
          c.fillStyle = "#2d3a44"; Object.values(meetSeat).forEach((s) => { rr(s.x - 10, s.y - 9, 20, 18, 5); c.fill(); });
          break;
        case "screen": {
          c.fillStyle = "#0b0f12"; rr(f.x, f.y, f.w, 30, 3); c.fill();
          c.strokeStyle = "#2a3540"; c.stroke();
          const an = O.analysis; c.font = "600 10px JetBrains Mono, monospace"; c.textAlign = "center";
          c.fillStyle = an ? monitorColor("HEAD") : "#7d8a95";
          c.fillText(an ? `${an.asset.slice(0, 3)}/${an.asset.slice(3)} ${an.timeframe} · ${an.decision}` : "aguardando dados", f.x + f.w / 2, f.y + 13);
          c.fillStyle = "#9aa7b1"; c.fillText(an ? `confluência ${an.confluence.score} · ${an.confluence.classification}` : "", f.x + f.w / 2, f.y + 25); c.textAlign = "left";
          break;
        }
        case "board": {
          c.fillStyle = "#0b0f12"; rr(f.x, f.y, f.w, f.h, 6); c.fill(); c.strokeStyle = "#2a3540"; c.stroke();
          c.fillStyle = "#9aa7b1"; c.font = "600 9px Inter, sans-serif"; c.fillText(`PARES · ${S.tf}`, f.x + 10, f.y + 16);
          const cards = (O.scan && O.scan.cards) || [];
          cards.forEach((k, i) => { const y = f.y + 34 + i * 44; c.fillStyle = "#cfd8df"; c.font = "600 10px JetBrains Mono, monospace"; c.fillText(k.label, f.x + 10, y);
            const dec = k.decision || "";
            c.fillStyle = dec.includes("ALTA") ? css("--green") : dec.includes("BAIXA") ? css("--red") : dec.includes("AGUARDAR") ? css("--amber") : "#7d8a95";
            c.font = "9px JetBrains Mono, monospace"; c.fillText(k.price ? fmtP(k.price) : "—", f.x + 10, y + 12);
            c.fillText((k.decision || "").replace("CENÁRIO DE ", "").replace(" CONFIRMAÇÃO", "").slice(0, 14), f.x + 10, y + 24); });
          break;
        }
        case "shelf": c.fillStyle = "#4d3b2e"; c.fillRect(f.x, f.y, f.w, f.h); ["#b7553b", "#3b78b7", "#c9a13c", "#4f9a6b"].forEach((col, i) => { c.fillStyle = col; for (let k = 0; k < 6; k++) c.fillRect(f.x + 4 + (k % 2) * 9, f.y + 6 + i * 36 + Math.floor(k / 2) * 10, 7, 8); }); break;
        case "plant": c.fillStyle = "#5b4636"; c.beginPath(); c.arc(f.x + f.w / 2, f.y + f.h / 2, f.w / 2.6, 0, 7); c.fill(); c.fillStyle = "#2f8a52"; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(f.x + f.w / 2 + Math.cos(k) * 7, f.y + f.h / 2 + Math.sin(k * 1.7) * 7, 7, 0, 7); c.fill(); } break;
        case "sofa": c.fillStyle = "#3b4a5a"; rr(f.x, f.y, f.w, f.h, 8); c.fill(); c.fillStyle = "#465868"; rr(f.x + 6, f.y + 6, f.w - 12, f.h - 14, 5); c.fill(); break;
        case "safe": c.fillStyle = "#59636d"; rr(f.x, f.y, f.w, f.h, 4); c.fill(); c.strokeStyle = "#2b3138"; c.beginPath(); c.arc(f.x + 18, f.y + 18, 7, 0, 7); c.stroke(); break;
        case "counter": c.fillStyle = "#59626b"; c.fillRect(f.x, f.y, f.w, f.h); c.fillStyle = "#6c7680"; c.fillRect(f.x, f.y + f.h - 6, f.w, 6); break;
        case "coffee": c.fillStyle = "#1b1f23"; rr(f.x, f.y + 2, f.w, f.h - 4, 4); c.fill(); c.fillStyle = "#c0563f"; c.fillRect(f.x + 6, f.y + 8, 6, 6); c.fillStyle = "rgba(255,255,255,.4)"; c.beginPath(); c.arc(f.x + 24, f.y + 16 - Math.sin(O.t * 3) * 2, 2, 0, 7); c.fill(); break;
        case "fridge": c.fillStyle = "#cfd5da"; rr(f.x, f.y, f.w, f.h, 4); c.fill(); c.fillStyle = "#9aa3ab"; c.fillRect(f.x + f.w - 8, f.y + 10, 3, 16); break;
        case "round": c.fillStyle = "#6b5440"; c.beginPath(); c.arc(f.x + 32, f.y + 32, 30, 0, 7); c.fill(); c.fillStyle = "#e6e0d6"; c.beginPath(); c.arc(f.x + 24, f.y + 26, 5, 0, 7); c.fill(); break;
        case "cooler": c.fillStyle = "#8fc3e6"; rr(f.x, f.y, f.w, f.h, 6); c.fill(); c.fillStyle = "#e9f4fb"; c.fillRect(f.x + 6, f.y + 4, f.w - 12, 8); break;
      }
    });
  }
  const shortRole = (card) => ({ NEWS: "Notícias", PA: "Price Action", RET: "Retração", REV: "Reversão", VOL: "Volume/RSI", VP: "Vol. Profile", SR: "S/R", FIB: "Fibonacci", MTF: "Tendência", LIQ: "Liquidez", MT5I: "Indic. MT5", TL: "LTA/LTB", TIM: "Timing M1", RES: "Pesquisa", PB: "Pullback", RISK: "Risco", HEAD: "Head Trader" }[card.code] || card.name);

  function drawPerson(p) {
    const c = C(); const L = p.look;
    const seated = !p.moving && (p.task === "trabalhando" || p.task === "na reunião");
    const bob = p.moving ? Math.sin(O.t * 12 + p.phase) * 1.6 : 0;
    const x = p.x, y = p.y + bob;
    const face = p.face ?? -Math.PI / 2;
    c.save(); c.translate(x, y); c.scale(1.35, 1.35);
    c.fillStyle = "rgba(0,0,0,.35)"; c.beginPath(); c.ellipse(0, 7, 12, 6, 0, 0, 7); c.fill();
    if (p.moving) { // pernas
      const s = Math.sin(O.t * 12 + p.phase) * 4; c.fillStyle = "#1f2429"; c.beginPath(); c.arc(-4 + Math.cos(face) * s * 0.3, 6 + s * 0.6, 3, 0, 7); c.arc(4 - Math.cos(face) * s * 0.3, 6 - s * 0.6, 3, 0, 7); c.fill();
    }
    c.rotate(face + Math.PI / 2);
    // corpo (ombros) e braços
    c.fillStyle = L.shirt; c.beginPath(); c.ellipse(0, 2, 11, 7, 0, 0, 7); c.fill();
    c.fillStyle = L.skin; const arm = seated ? Math.sin(O.t * 9 + p.phase) * 1.2 : 0;
    c.beginPath(); c.arc(-10, -2 + arm, 3, 0, 7); c.arc(10, -2 - arm, 3, 0, 7); c.fill();
    if (L.tie) { c.fillStyle = "#b8343f"; c.fillRect(-1.5, -4, 3, 8); }
    // cabeça e cabelo
    c.fillStyle = L.skin; c.beginPath(); c.arc(0, -1, 6.5, 0, 7); c.fill();
    c.fillStyle = L.hair; c.beginPath();
    if (L.style === "long") { c.arc(0, 0, 7.4, Math.PI * 0.05, Math.PI * 0.95, true); c.fill(); c.fillRect(-7, -1, 14, 6); }
    else if (L.style === "bun") { c.arc(0, 0, 7, Math.PI * 0.1, Math.PI * 0.9, true); c.fill(); c.beginPath(); c.arc(0, 6, 3.4, 0, 7); c.fill(); }
    else if (L.style === "bob") { c.arc(0, 0, 7.3, Math.PI * 0.15, Math.PI * 0.85, true); c.fill(); c.fillRect(-7.3, -1, 14.6, 3); }
    else if (L.style === "buzz") { c.globalAlpha = 0.8; c.arc(0, 0.5, 6.6, Math.PI * 0.2, Math.PI * 0.8, true); c.fill(); c.globalAlpha = 1; }
    else { c.arc(0, 0.5, 7, Math.PI * 0.12, Math.PI * 0.88, true); c.fill(); }
    c.restore();
    // nome
    const sel = O.selected === p.code, hov = O.hover === p.code;
    if (sel || hov || p.moving) {
      c.font = "600 10px Inter, sans-serif"; const t = p.card.person; const tw = c.measureText(t).width;
      c.fillStyle = sel ? css("--green") : "rgba(0,0,0,.6)"; rr(x - tw / 2 - 5, y - 36, tw + 10, 14, 4); c.fill();
      c.fillStyle = sel ? "#04110a" : "#e6edf2"; c.textAlign = "center"; c.fillText(t, x, y - 26); c.textAlign = "left";
    }
    if (sel) { c.strokeStyle = css("--green"); c.lineWidth = 2; c.beginPath(); c.ellipse(x, y + 9, 19, 10, 0, 0, 7); c.stroke(); c.lineWidth = 1; }
  }
  function wrap(text, maxW) {
    const c = C(); const words = String(text).split(/\s+/); const lines = []; let line = "";
    words.forEach((w) => { const t = line ? line + " " + w : w; if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].replace(/.{0,2}$/, "…"); }
    return lines;
  }
  function drawBubble(p) {
    if (!p.bubble || O.t > p.bubble.until) { p.bubble = null; return; }
    const c = C(); c.font = "11px Inter, sans-serif";
    const lines = wrap(p.bubble.text, 210); const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 16, h = lines.length * 14 + 10;
    let bx = Math.min(W - w - 6, Math.max(6, p.x - w / 2)), by = p.y - 40 - h; if (by < 4) by = p.y + 22;
    c.fillStyle = "rgba(245,248,250,.96)"; rr(bx, by, w, h, 7); c.fill();
    c.beginPath(); const tx = Math.min(Math.max(p.x, bx + 10), bx + w - 10); if (by < p.y) { c.moveTo(tx - 5, by + h); c.lineTo(tx, by + h + 7); c.lineTo(tx + 5, by + h); } c.fill();
    c.fillStyle = "#11161b"; lines.forEach((l, i) => c.fillText(l, bx + 8, by + 17 + i * 14));
  }

  // ---------------------------------------------------------------- laço
  function frame(ts) {
    if (!O.on) return;
    const now = ts / 1000; const dt = Math.min(0.05, now - (O.last || now)); O.last = now; O.t += dt;
    const ps = Object.values(people);
    ps.forEach((p) => { move(p, dt); if (!p.paused) routine(p); });
    meetingTick();
    if (!O.meeting && O.t > O.nextMeetingAt && O.analysis && O.nextMeetingAt) startMeeting();
    const c = C(); c.setTransform(O.scale * O.dpr, 0, 0, O.scale * O.dpr, 0, 0);
    drawFloor(); drawFurniture(); drawWalls();
    ps.slice().sort((a, b) => a.y - b.y).forEach(drawPerson);
    ps.forEach(drawBubble);
    requestAnimationFrame(frame);
  }
  function resize() {
    const cv = O.canvas; const w = cv.parentElement.clientWidth; const cw = Math.max(860, w);
    O.scale = cw / W; O.dpr = window.devicePixelRatio || 1;
    cv.style.width = cw + "px"; cv.style.height = H * O.scale + "px";
    cv.width = cw * O.dpr; cv.height = H * O.scale * O.dpr;
  }
  function pick(ev) {
    const r = O.canvas.getBoundingClientRect(); const x = (ev.clientX - r.left) / O.scale, y = (ev.clientY - r.top) / O.scale;
    let best = null, bd = 22;
    Object.values(people).forEach((p) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p.code; } });
    if (!best) { const f = furniture.find((f) => f.owner && x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h + 12); if (f) best = f.owner; }
    return best;
  }

  // ---------------------------------------------------------------- painel lateral e conversa
  function updateTopbar() {
    const an = O.analysis; const el = $("#office-status"); if (!el) return;
    if (O.meeting && O.meeting.loss) { el.innerHTML = '<span class="down">Reunião pós-LOSS em andamento</span> — a equipe investiga a última perda (detalhes na aba Treinamento).'; return; }
    el.innerHTML = an ? `Analisando <b>${an.asset.slice(0, 3)}/${an.asset.slice(3)}</b> em <b>${an.timeframe}</b> · vela fechada ${esc(an.as_of_label)} · decisão <span class="pill ${decCls(an.decision)}">${esc(an.decision)}</span>${O.meeting ? ' · <span class="wait">reunião em andamento</span>' : ""}` : "carregando…";
  }
  function renderFeed() {
    const el = $("#office-feed"); if (!el) return;
    el.innerHTML = O.feed.slice(-40).reverse().map((m) => `<div class="feed-item"><b>${esc(m.who)}</b> <span class="muted">${esc(m.role)} · ${m.t.toLocaleTimeString().slice(0, 5)}</span><div>${esc(m.text)}</div></div>`).join("");
  }
  function renderPanel() {
    const el = $("#office-panel"); if (!el) return;
    const p = people[O.selected];
    if (!p) { el.innerHTML = `<h3>Clique em uma pessoa</h3><p class="small muted">Clique em qualquer pessoa (ou na mesa dela) para ver o que ela está analisando e conversar. Sem ninguém selecionado, você fala com o Head Trader.</p>`; return; }
    const r = reportOf(p.code); const a = p.card; const s = a.backtest || a.live;
    const view = p.code === "HEAD" && O.analysis ? `<span class="pill ${decCls(O.analysis.decision)}">${esc(O.analysis.decision)}</span>` : p.code === "RISK" && O.analysis ? (O.analysis.risk ? (O.analysis.risk.approved ? '<b class="up">aprovou</b>' : '<b class="down">vetou</b>') : '<span class="muted">sem cenário para avaliar</span>') : r ? `<b class="${r.bias > 0 ? "up" : r.bias < 0 ? "down" : "muted"}">${r.abstain ? "sem dados" : dirLbl[r.bias]}</b> · confiança ${r.confidence.toFixed(2)}` : "";
    el.innerHTML = `<div class="who"><span class="avatar" style="background:${p.look.shirt}"></span><div><b>${esc(a.person)}</b><div class="small muted">${esc(a.name)} · agente ${String(a.number).padStart(2, "0")}</div></div></div>
      <p class="small">${esc(a.specialty)}</p><p class="small">Agora: <b>${esc(p.task)}</b></p><p class="small">Visão: ${view}</p>
      ${r && r.summary ? `<p class="small muted">${esc(r.summary)}</p>` : ""}
      <p class="small muted">Histórico: ${s ? `${s.hits}/${s.n} acertos (${pct(s.hit_rate)})` : "sem avaliações ainda"}</p>
      <div class="quick">${["Qual é sua visão?", "Por quê?", "Quais níveis você vê?", "Quanto você acerta?", "Como você trabalha?"].map((q) => `<button class="ghost small" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
    $$("#office-panel .quick button").forEach((b) => b.onclick = () => ask(b.dataset.q));
  }
  function levelsText(code, r) {
    const d = (r && r.data) || {};
    if (code === "SR") return (d.zones || []).slice(0, 4).map((z) => `${z.role} ${z.tf} ${fmtP(z.low)}–${fmtP(z.high)}`).join("; ") || "nenhuma zona próxima";
    if (code === "LIQ") return (d.pools || []).slice(0, 4).map((p) => `${p.kind} ${p.side} em ${fmtP(p.price)}`).join("; ") || "nenhum pool próximo";
    if (code === "VP") return d.poc ? `POC ${fmtP(d.poc)}, VAH ${fmtP(d.vah)}, VAL ${fmtP(d.val)}` : "sem perfil";
    if (code === "FIB") return (d.near_levels || []).map((n) => `${n.cat} ${n.level} em ${fmtP(n.price)}`).join("; ") || "preço longe dos níveis principais";
    if (code === "PB") return d.state ? `Estado: ${d.state}${d.bos ? `; BOS em ${fmtP(d.bos.level)}` : ""}${d.zone ? `; zona de valor ${fmtP(d.zone[0])}–${fmtP(d.zone[1])}` : ""}${d.retr != null ? `; recuo de ${Math.round(d.retr * 100)}%` : ""}` : "sem rompimento recente";
    if (code === "TL") return (d.lines || []).map((l) => `${l.kind} ${l.tf} em ${fmtP(l.p2)} (${l.touches} toques)`).join("; ") || "nenhuma linha válida";
    if (code === "PA") return [...(d.fvg || []).map((z) => `FVG ${z.dir > 0 ? "de alta" : "de baixa"} ${fmtP(z.low)}–${fmtP(z.high)}`),
      ...(d.order_blocks || []).map((z) => `Order Block ${z.dir > 0 ? "de alta" : "de baixa"} ${fmtP(z.low)}–${fmtP(z.high)}`)].slice(0, 4).join("; ") || "nenhuma zona FVG/OB aberta perto do preço";
    if (code === "RET") return Object.entries(d.legs || {}).map(([tf, l]) => `${tf}: perna de ${l.dir > 0 ? "alta" : "baixa"} ${fmtP(l.from)}→${fmtP(l.to)}, retração ${Math.round(l.retr * 100)}%`).join("; ") || "nenhuma perna impulsiva medida";
    if (code === "VOL") return `RSI ${d.rsi ?? "—"}${d.volume_ratio ? `, volume ${d.volume_ratio}× a média` : ""}`;
    if (code === "MTF") return Object.values(d.map || {}).filter((t) => t.trend !== null).map((t) => `${t.tf} ${t.label}`).join(", ");
    return "não trabalho com níveis de preço específicos";
  }
  async function reply(code, q) {
    const p = people[code]; const a = p.card; const Q = q.toUpperCase();
    const m = Q.match(/([A-Z]{3})\s*[/-]?\s*([A-Z]{3})/);
    if (m && S.status && S.status.assets.includes(m[1] + m[2]) && m[1] + m[2] !== S.asset) {
      S.asset = m[1] + m[2]; const sel = $("#asset"); if (sel) sel.value = S.asset; await refresh(false);
    }
    const an = O.analysis; const r = reportOf(code); const pair = an ? `${an.asset.slice(0, 3)}/${an.asset.slice(3)} (${an.timeframe})` : "o par";
    const art = a.gender === "f" ? "a" : "o";
    if (/OL[AÁ]|OI|BOM DIA|BOA TARDE|BOA NOITE|TUDO BEM/.test(Q) && Q.length < 25) return `Olá! Sou ${art} ${a.person}, ${a.name}. ${a.specialty}. Pode perguntar sobre ${pair}.`;
    if (/COMO|METODOLOGIA|M[ÉE]TODO|FUNCIONA|TRABALHA/.test(Q)) return `${a.methodology} ${a.personality}`;
    if (/ACERT|DESEMPENHO|HIST[ÓO]RICO|TAXA|RESULTADO/.test(Q)) {
      const s = a.backtest || a.live;
      return s ? `No histórico avaliado acertei a direção ${s.hits} de ${s.n} vezes (${pct(s.hit_rate)}, IC95% ${pct(s.ci[0], 0)}–${pct(s.ci[1], 0)}). Sem significância estatística isso não é vantagem.` : "Ainda não tenho avaliações suficientes. Deixe o treino automático rodando para eu acumular histórico.";
    }
    if (/HOR[AÁ]RIO|HORA/.test(Q)) {
      const h = await api("/api/hours"); const g = (h.grid || {})[S.tf] || (h.grid || {}).TODAS || {};
      const best = Object.entries(g).map(([hr, v]) => [hr, v.hyp]).filter(([, v]) => v.n >= 10).sort((x, y) => y[1].ci[0] - x[1].ci[0]).slice(0, 3);
      return best.length ? `Pelos registros em ${S.tf}, as horas mais fortes até agora (UTC): ${best.map(([hr, v]) => `${String(hr).padStart(2, "0")}h ${pct(v.rate, 0)} em ${v.n}`).join(", ")}. Veja a aba Horários.` : "Ainda há poucos registros por hora. A aba Horários mostra a evolução.";
    }
    if (code === "HEAD") {
      if (/REUNI/.test(Q)) { setTimeout(() => startMeeting(), 400); return "Certo, vou chamar todo mundo para a sala de reunião agora."; }
      if (!an) return "Ainda estou esperando os dados.";
      if (/POR\s*QU|PORQUE|EXPLIC|MOTIVO/.test(Q)) return an.narrative;
      return `Para ${pair}: ${an.decision}. ${an.reason} Confluência ${an.confluence.classification} (${an.confluence.score}/100), ${an.confluence.agreeing_groups} fatores independentes.`;
    }
    if (code === "RES") {
      const v = await api("/api/research");
      const ap = v.indicators.filter((r) => r.status === "aprovado");
      const susp = v.items.filter((i) => i.credibility && i.credibility.label === "suspeito").length;
      if (/V[ÍI]DEO|AULA|ESTUD|APREND/.test(Q)) return `Minha biblioteca tem ${v.items.length} materiais (${susp} marcados como suspeitos por prometer lucro ou vender sinais). Na aba Pesquisa há uma trilha de aprendizado com ${v.curriculum.length} temas e links de aulas.`;
      return `Testei ${v.indicators.length} ideias no laboratório. Aprovadas: ${ap.length ? ap.map((r) => `${r.label} (${r.tf})`).join(", ") : "nenhuma até agora — nenhuma mostrou vantagem estatística sobre o ponto de equilíbrio do payout"}. Se você viu uma estratégia num vídeo, cole na aba Pesquisa que eu testo.`;
    }
    if (code === "RISK") {
      if (!an || !an.risk) return `Para ${pair} não há cenário de confluência alta, então nada chegou à minha mesa. Não operar também é decisão.`;
      return (an.risk.approved ? "Aprovei: " : "Vetei: ") + an.risk.checks.filter((c) => c.blocking || !c.ok).map((c) => c.text).slice(0, 4).join(" ");
    }
    if (!r) return "Não participei desta análise.";
    if (/N[ÍI]VE|ONDE|PRE[ÇC]O|LINHA|ZONA/.test(Q)) return `Em ${pair}: ${levelsText(code, r)}.`;
    if (/POR\s*QU|PORQUE|EXPLIC|MOTIVO|EVID/.test(Q)) {
      const ev = (r.evidence || []).slice().sort((x, y) => y.weight * y.quality - x.weight * x.quality).slice(0, 3).map((e) => e.description);
      return ev.length ? `Minhas evidências: ${ev.join(" | ")}.${r.warnings.length ? " Atenção: " + r.warnings[0] : ""}` : `Não encontrei evidência forte. ${r.warnings[0] || ""}`;
    }
    if (/ALERTA|RISCO|CUIDADO|ATEN/.test(Q)) return r.warnings.length ? r.warnings.slice(0, 2).join(" ") : "Nenhum alerta da minha parte.";
    return `Em ${pair}: ${r.summary} (viés ${dirLbl[r.bias]}, confiança ${r.confidence.toFixed(2)}).`;
  }
  async function ask(q) {
    const code = O.selected || "HEAD"; const p = people[code]; if (!p) return;
    O.feed.push({ who: "Você", role: `para ${p.card.person}`, code: "YOU", text: q, t: new Date() }); renderFeed();
    p.paused = true; const prevFace = p.face;
    const ans = await reply(code, q);
    say(code, ans, Math.min(9, 2.5 + ans.length * 0.04));
    setTimeout(() => { p.paused = false; p.face = prevFace; renderPanel(); }, 4000);
    renderPanel();
  }

  // ---------------------------------------------------------------- inicialização
  O.init = async function () {
    O.canvas = $("#office-canvas"); O.ctx = O.canvas.getContext("2d");
    O.catalog = S.agents && S.agents.length ? S.agents : await api("/api/agents");
    makePeople(); resize(); renderPanel();
    window.addEventListener("resize", () => { if (O.on) resize(); });
    O.canvas.addEventListener("mousemove", (e) => { O.hover = pick(e); O.canvas.style.cursor = O.hover ? "pointer" : "default"; });
    O.canvas.addEventListener("click", (e) => { O.selected = pick(e); renderPanel(); });
    $("#office-form").onsubmit = (e) => { e.preventDefault(); const q = $("#office-input").value.trim(); if (!q) return; $("#office-input").value = ""; ask(q); };
    $("#office-meet").onclick = () => { if (!O.meeting) startMeeting(); };
    $("#office-loss").onclick = async () => {
      if (O.meeting) return;
      const ms = await api("/api/mistakes");
      if (ms.length) startMeeting(ms[0]);
      else say("HEAD", "Ainda não temos nenhuma perda registrada para investigar.");
    };
    $("#office-speed").onclick = () => { O.speed = O.speed === 1 ? 2 : O.speed === 2 ? 4 : 1; $("#office-speed").textContent = `Velocidade ${O.speed}×`; };
    O.ready = true;
  };
  O.show = async function () {
    if (!O.ready) await O.init();
    O.on = true; O.last = 0; resize(); requestAnimationFrame(frame);
    await refresh(!O.analysis);
    if (!O.poll) O.poll = setInterval(() => { if (O.on) refresh(false); }, 15000);
  };
  O.hide = function () { O.on = false; };
  O.assetChanged = function () { if (O.on) refresh(true); };
})();
