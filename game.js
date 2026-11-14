'use strict';
/* =====================================================================
   AS QUATRO CHAMAS DE NZILA — Vertical Slice "Vila Raiz"
   Canvas puro + JavaScript puro. Arte 100% geométrica (placeholders).
   Controles: setas/WASD mover | Shift correr | Espaço pular
              J atacar (combo de 3) | K aparo | L esquiva
              I especial (20 Eco) | O super (100 Eco) | R reiniciar
   ===================================================================== */

// ---------- Configuração ----------
const W = 960, H = 540, WORLD = 2600;      // tela e largura do mapa
const GY0 = 335, GY1 = 505;                // faixa de profundidade (chão)
const ARENA_L = 1000, ARENA_R = 1900;      // área de combate
const HOUSE_X = 2300;                      // porta da casa de Vó Mabeki
const PARRY_MS = 133;                      // janela de aparo (ms)
const GROOVE_TIME = 15;                    // segundos de Groove
const BEAT = 0.6;                          // pulso rítmico (ataques inimigos seguem esse tempo)

const C = document.getElementById('c'), X = C.getContext('2d');
C.focus();

// ---------- Entrada ----------
const keys = {}, press = {};
addEventListener('keydown', e => {
  if (!keys[e.code]) press[e.code] = 1;
  keys[e.code] = 1;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = 0);
const down = (...c) => c.some(k => keys[k]);
const hit = (...c) => c.some(k => press[k]);

// ---------- Áudio mínimo (beeps) ----------
let AC;
function sfx(f, d = .08, type = 'square') {
  try {
    AC = AC || new AudioContext();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = .04;
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + d);
  } catch (e) {}
}

// ---------- Utilidades ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Tipos de inimigos ----------
const TYPES = {
  des:  { n: 'Desbotado',        hp: 40,  sp: 75, dmg: 8,  rng: 55,  wind: BEAT,     col: '#9aa0a6', r: 20, s: 1 },
  ras:  { n: 'Agente de Rasura', hp: 60,  sp: 60, dmg: 12, rng: 62,  wind: BEAT,     col: '#8a2433', r: 22, s: 1.05 },
  sel:  { n: 'Selador de Ecos',  hp: 35,  sp: 60, dmg: 4,  rng: 480, wind: BEAT * 1.5, col: '#7b4fc4', r: 18, s: .95 },
  boss: { n: 'Griô Sem Voz',     hp: 300, sp: 55, dmg: 20, rng: 115, wind: BEAT * 1.5, col: '#d8d0bb', r: 36, s: 1.7 }
};
// Ondas da área de combate (a última é o mini-chefe)
const WAVES = [['des', 'des'], ['des', 'des', 'ras'], ['ras', 'sel', 'des'], ['boss']];

// ---------- Estado ----------
let G, P, E, FX, FL, cam;
function newGame() {
  G = { scene: 'play', t: 0, wave: 0, lock: false, bossDead: false, delay: 1,
        hs: 0, shake: 0, flash: 0, msgT: 0, msg: '', kills: 0, parries: 0 };
  P = { x: 200, y: 430, z: 0, vz: 0, face: 1, hp: 100, mhp: 100, eco: 0, armEco: true,
        combo: 0, comboT: 0, step: 0, atkT: 0, atkDur: .3, didHit: false, chainT: 0,
        parryT: 0, parryCD: 0, parryFx: 0, dodgeT: 0, dodgeCD: 0, inv: 0, hurtT: 0,
        groove: 0, grooveCD: 0, slowT: 0, comboUsed: false };
  E = []; FX = []; FL = []; cam = 0;
  msg('Vila Raiz — siga para a área de combate  →', 4);
}
G = { scene: 'title' };

function msg(t, s = 3) { G.msg = t; G.msgT = s; }
function floater(x, y, t, c = '#fff') { FL.push({ x, y, t, c, l: 1 }); }
function burst(x, y, c, n = 8) {
  for (let i = 0; i < n; i++) FX.push({ x, y, vx: rnd(-160, 160), vy: rnd(-200, 40), l: rnd(.3, .6), c, s: rnd(3, 6) });
}

// ---------- Eco e Groove ----------
function addEco(n) {
  P.eco = Math.min(100, P.eco + n * (P.groove > 0 ? 1.25 : 1)); // Groove: +25% Eco
  if (P.eco < 100) P.armEco = true;
}
function checkGroove() {
  if (P.groove > 0 || P.grooveCD > 0) return;
  const byEco = P.eco >= 100 && P.armEco;
  const byCombo = P.combo >= 50 && !P.comboUsed;
  if (byEco || byCombo) {
    P.groove = GROOVE_TIME;
    if (byEco) P.armEco = false;
    if (byCombo) P.comboUsed = true;
    msg('GROOVE!', 2); G.flash = .3; sfx(660, .25, 'triangle');
  }
}

// ---------- Dano ----------
function hurt(d) {
  if (P.inv > 0) return;
  P.hp -= d; P.inv = .7; P.hurtT = .25; P.combo = 0; P.comboUsed = false;
  P.x -= P.face * 18; G.shake = .25;
  burst(P.x, P.y - 40, '#f55'); floater(P.x, P.y - 90, '-' + Math.round(d), '#f55'); sfx(90, .12, 'sawtooth');
  if (P.hp <= 0) { P.hp = 0; G.scene = 'dead'; }
}
function hurtEnemy(e, d, kx) {
  const guarded = e.t === 'ras' && e.guard && e.stun <= 0 && (P.x - e.x) * e.face > 0;
  if (guarded) { d *= .2; floater(e.x, e.y - 90, 'BLOQ', '#8cf'); }
  e.hp -= d; e.fl = .1; e.x += kx * (e.t === 'boss' ? .2 : 1);
  if (e.t !== 'boss' && e.wT <= 0 && !guarded) e.stun = .25;
  burst(e.x, e.y - 40, '#ffd36b', 5); floater(e.x, e.y - 100, Math.ceil(d), '#fff');
  G.hs = .04;
  if (e.hp <= 0 && !e.dead) {
    e.dead = true; G.kills++; addEco(3); burst(e.x, e.y - 40, TYPES[e.t].col, 16);
    if (e.t === 'boss') {                      // chefe derrotado: libera o caminho
      G.bossDead = true; G.lock = false; E.forEach(o => o.dead = true);
      msg('Griô derrotado! Siga até a casa de Vó Mabeki  →', 5); G.flash = .4;
    }
  }
}

// ---------- Jogador ----------
function strike() {            // golpe do combo (aplica dano na frente)
  const s = P.step, d = s === 3 ? 14 : 8; let any = false;
  for (const e of E) {
    const dx = (e.x - P.x) * P.face;
    if (dx > -15 && dx < 80 + TYPES[e.t].r && Math.abs(e.y - P.y) < 30) { hurtEnemy(e, d, P.face * (s === 3 ? 40 : 12)); any = true; }
  }
  if (any) {
    P.combo++; P.comboT = 2.5;
    addEco(s === 3 ? 5 : 1);   // combo completo = +5, golpe básico = +1
    sfx(180 + s * 60, .05);
  }
}
function updPlayer(dt) {
  const gr = P.groove > 0;
  for (const k of ['parryT', 'parryCD', 'parryFx', 'dodgeT', 'dodgeCD', 'inv', 'hurtT', 'slowT', 'chainT', 'grooveCD']) P[k] = Math.max(0, P[k] - dt);
  P.comboT -= dt; if (P.comboT <= 0) { P.combo = 0; P.comboUsed = false; }
  if (gr) { P.groove -= dt; if (P.groove <= 0) { P.groove = 0; P.grooveCD = 5; msg('Groove acabou', 1.5); } }
  if (P.chainT <= 0 && P.atkT <= 0) P.step = 0;

  // gravidade / pulo
  if (P.z > 0 || P.vz > 0) { P.vz -= 1400 * dt; P.z += P.vz * dt; if (P.z <= 0) { P.z = 0; P.vz = 0; } }

  if (P.hurtT <= 0) {
    const ax = (down('ArrowRight', 'KeyD') ? 1 : 0) - (down('ArrowLeft', 'KeyA') ? 1 : 0);
    const ay = (down('ArrowDown', 'KeyS') ? 1 : 0) - (down('ArrowUp', 'KeyW') ? 1 : 0);
    const sp = (down('ShiftLeft', 'ShiftRight') ? 250 : 150) * (gr ? 1.1 : 1) * (P.slowT > 0 ? .7 : 1);
    if (P.dodgeT > 0) P.x += P.face * 430 * dt;                   // esquiva (rolagem)
    else if (P.atkT <= 0 || P.z > 0) {
      P.x += ax * sp * dt; P.y += ay * sp * .7 * dt; if (ax) P.face = ax;
    }
    if (hit('Space') && P.z === 0 && P.dodgeT <= 0) { P.vz = 440; sfx(300, .06); }
    if (hit('KeyL') && P.dodgeCD <= 0 && P.z === 0) { P.dodgeT = .3; P.inv = .3; P.dodgeCD = .8; sfx(140, .1, 'triangle'); }
    if (hit('KeyK') && P.parryCD <= 0) { P.parryT = PARRY_MS / 1000; P.parryCD = .5; P.parryFx = .25; } // Aparo: janela de 133ms
    // combo de 3 golpes (pode enfileirar no fim da animação)
    if (hit('KeyJ') && P.dodgeT <= 0 && P.atkT <= P.atkDur * .35) {
      P.step = (P.chainT > 0 || P.atkT > 0) ? P.step % 3 + 1 : 1;
      P.atkDur = (P.step === 3 ? .42 : .26) / (gr ? 1.15 : 1);   // Groove: +15% vel. de ataque
      P.atkT = P.atkDur; P.didHit = false;
    }
    if (hit('KeyI') && P.eco >= 20) {                              // Especial: onda de choque
      P.eco -= 20; P.armEco = true; sfx(120, .25, 'sawtooth'); G.shake = .2;
      for (const e of E) if ((e.x - P.x) * P.face > -20 && Math.abs(e.x - P.x) < 190 && Math.abs(e.y - P.y) < 45) hurtEnemy(e, 28, P.face * 60);
      FX.push({ ring: 1, x: P.x + P.face * 80, y: P.y - 10, l: .35, c: '#ffb347', s: 20 });
    }
    if (hit('KeyO') && P.eco >= 100) {                             // Super: explosão ao redor
      P.eco -= 100; P.armEco = true; G.flash = .5; G.shake = .5; sfx(80, .5, 'sawtooth');
      for (const e of E) if (Math.hypot(e.x - P.x, (e.y - P.y) * 2) < 380) hurtEnemy(e, 70, Math.sign(e.x - P.x) * 80);
      FX.push({ ring: 1, x: P.x, y: P.y - 10, l: .5, c: '#fff', s: 60 });
    }
  }
  if (P.atkT > 0) {
    P.atkT -= dt;
    if (!P.didHit && P.atkT <= P.atkDur * .5) { P.didHit = true; strike(); }
    if (P.atkT <= 0) P.chainT = .4;
  }
  const lo = G.lock ? ARENA_L : 20, hi = G.lock ? ARENA_R : WORLD - 20;
  P.x = clamp(P.x, lo, hi); P.y = clamp(P.y, GY0 + 10, GY1);
  checkGroove();
}

// ---------- Inimigos ----------
function spawn(t, x, y) {
  const T = TYPES[t];
  E.push({ t, x, y: y ?? rnd(GY0 + 30, GY1 - 10), hp: T.hp, mhp: T.hp, face: -1, wT: 0, cd: 1.2, stun: 0,
           fl: 0, guard: false, gT: 1, sT: 8, ph2: false, dead: false, r: T.r });
}
function summon(n) {
  const b = E.find(e => e.t === 'boss'); if (!b) return;
  for (let i = 0; i < n && E.length < 7; i++) spawn('des', clamp(b.x + rnd(-150, 150), ARENA_L, ARENA_R));
  burst(b.x, b.y - 50, '#fff', 14);
}
function parrySuccess(e) {   // Aparo Perfeito
  P.parryT = 0; G.parries++; addEco(6); e.stun = 1; e.wT = 0; e.cd = 1.2;
  G.hs = .12; G.flash = .25; burst(P.x + P.face * 25, P.y - 45, '#7ff', 18);
  FX.push({ ring: 1, x: P.x + P.face * 25, y: P.y - 45, l: .3, c: '#7ff', s: 14 });
  floater(P.x, P.y - 110, 'APARO PERFEITO! +6 Eco', '#7ff'); sfx(900, .15, 'triangle');
}
function resolveAttack(e) {  // o golpe inimigo "cai" neste instante
  const T = TYPES[e.t]; e.fl = .15;
  const inRange = e.t === 'sel' || (Math.abs(P.x - e.x) < T.rng + 10 && Math.abs(P.y - e.y) < 28 && P.z < 40);
  if (!inRange || P.inv > 0) return;                 // errou ou jogador está invulnerável (esquiva)
  if (P.parryT > 0) return parrySuccess(e);          // dentro dos 133ms = sucesso
  if (e.t === 'sel') { P.slowT = 4; msg('Selado! Movimento reduzido', 1.5); hurt(T.dmg); }
  else hurt(T.dmg * (e.ph2 ? 1.3 : 1));              // falha do aparo = dano
}
function updEnemy(e, dt) {
  const T = TYPES[e.t], dx = P.x - e.x, dy = P.y - e.y, ad = Math.abs(dx);
  e.face = dx > 0 ? 1 : -1; e.cd -= dt; e.fl = Math.max(0, e.fl - dt);
  if (e.t === 'boss') {                              // fase 2 e invocação
    if (!e.ph2 && e.hp < e.mhp / 2) { e.ph2 = true; summon(2); msg('Griô Sem Voz — Fase 2!', 2.5); G.shake = .4; }
    e.sT -= dt; if (e.sT <= 0) { e.sT = e.ph2 ? 7 : 11; summon(e.ph2 ? 3 : 1); }
  }
  if (e.stun > 0) { e.stun -= dt; return; }
  if (e.wT > 0) { e.wT -= dt; if (e.wT <= 0) { resolveAttack(e); e.cd = e.ph2 ? 1.2 : 1.8; } return; }
  const sp = T.sp * (e.ph2 ? 1.6 : 1);
  if (e.t === 'ras') { e.gT -= dt; if (e.gT <= 0) { e.guard = !e.guard; e.gT = e.guard ? 1.5 : 1.2; } }
  if (e.t === 'sel') {                               // suporte: mantém distância e sela
    if (ad < 220) e.x -= Math.sign(dx) * sp * dt; else if (ad > 340) e.x += Math.sign(dx) * sp * dt;
    e.y += Math.sign(dy) * Math.min(Math.abs(dy), sp * .5 * dt);
    if (e.cd <= 0 && ad < 480) e.wT = T.wind;
  } else {
    if (ad > T.rng - 15) e.x += Math.sign(dx) * sp * dt;
    if (Math.abs(dy) > 14) e.y += Math.sign(dy) * sp * .8 * dt;
    if (ad < T.rng - 5 && Math.abs(dy) < 24 && e.cd <= 0 && !(e.t === 'ras' && e.guard)) e.wT = e.t === 'boss' && e.ph2 ? BEAT : T.wind;
  }
  e.x = clamp(e.x, G.lock ? ARENA_L - 20 : 20, G.lock ? ARENA_R + 20 : WORLD - 20);
  e.y = clamp(e.y, GY0 + 10, GY1);
}

// ---------- Loop de atualização ----------
function update(dt) {
  if (G.scene === 'title') { if (hit('Enter', 'Space')) newGame(); return; }
  if (G.scene !== 'play') { if (hit('KeyR')) newGame(); return; }
  if (G.hs > 0) { G.hs -= dt; return; }              // hitstop
  G.t += dt; G.shake = Math.max(0, G.shake - dt); G.flash = Math.max(0, G.flash - dt); G.msgT -= dt;
  updPlayer(dt);
  E.forEach(e => updEnemy(e, dt));
  E = E.filter(e => !e.dead);
  // início da área de combate
  if (!G.lock && G.wave === 0 && P.x > ARENA_L + 40) { G.lock = true; msg('Os Desbotados cercam a praça!', 2.5); }
  if (G.lock && E.length === 0 && !G.bossDead) {
    G.delay -= dt;
    if (G.delay <= 0 && G.wave < WAVES.length) {
      WAVES[G.wave++].forEach((t, i) => spawn(t, ARENA_R - 40 - i * 90));
      if (G.wave === WAVES.length) msg('MINI-CHEFE: Griô Sem Voz', 3);
      else msg('Onda ' + G.wave + '/' + (WAVES.length - 1), 2);
      G.delay = 1.2;
    }
  }
  if (G.bossDead && P.x > HOUSE_X) G.scene = 'win';
  // partículas e textos
  FX.forEach(f => { f.l -= dt; if (!f.ring) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 600 * dt; } else f.s += 400 * dt; });
  FX = FX.filter(f => f.l > 0);
  FL.forEach(f => { f.l -= dt; f.y -= 30 * dt; }); FL = FL.filter(f => f.l > 0);
  // câmera (travada na arena durante o combate)
  const target = G.lock ? ARENA_L - 30 : clamp(P.x - W / 2, 0, WORLD - W);
  cam += (target - cam) * Math.min(1, dt * 6);
}

// ---------- Desenho ----------
function drawWorld() {
  // céu de entardecer
  const g = X.createLinearGradient(0, 0, 0, GY0); g.addColorStop(0, '#2b1b3d'); g.addColorStop(1, '#e07a3f');
  X.fillStyle = g; X.fillRect(0, 0, W, GY0);
  X.fillStyle = '#f7c873'; X.beginPath(); X.arc(700 - cam * .05, 120, 46, 0, 7); X.fill();   // sol
  // colinas distantes (parallax)
  X.fillStyle = '#4a2c4f';
  for (let i = -1; i < 8; i++) { const hx = i * 300 - cam * .3 % 300; X.beginPath(); X.ellipse(hx + 150, GY0, 190, 80, 0, Math.PI, 0); X.fill(); }
  // chão
  X.fillStyle = '#7a4e2d'; X.fillRect(0, GY0, W, H - GY0);
  X.fillStyle = '#8b5c37'; X.fillRect(0, GY0, W, 28);
  // casas/cabanas (cenário)
  for (let x = 120; x < 1000; x += 330) hut(x, '#a9683a');
  for (let x = 2000; x < 2200; x += 400) hut(x, '#a9683a');
  // praça central com fonte
  const fx = 520 - cam;
  X.fillStyle = '#9b8b78'; X.beginPath(); X.ellipse(fx, 460, 260, 50, 0, 0, 7); X.fill();
  X.fillStyle = '#6fa8b5'; X.beginPath(); X.ellipse(fx, 395, 46, 14, 0, 0, 7); X.fill();
  X.strokeStyle = '#d8c8a8'; X.lineWidth = 5; X.stroke();
  label('Praça Central', 520 - cam, 322);
  // área de combate (marcação no chão)
  const al = ARENA_L - cam, ar = ARENA_R - cam;
  X.strokeStyle = G.lock ? '#ff5a4a' : '#e8c068'; X.lineWidth = 3; X.setLineDash([14, 10]);
  X.strokeRect(al, GY0 + 8, ar - al, GY1 - GY0 - 6); X.setLineDash([]);
  label('Área de Combate', (al + ar) / 2, 322);
  // casa de Vó Mabeki
  const hx = HOUSE_X - cam;
  X.fillStyle = '#c98a4b'; X.fillRect(hx - 140, 215, 280, 120);
  X.fillStyle = '#6b3b1f'; X.beginPath(); X.moveTo(hx - 170, 218); X.lineTo(hx, 130); X.lineTo(hx + 170, 218); X.fill();
  X.fillStyle = G.bossDead ? '#ffd36b' : '#3a2214'; X.fillRect(hx - 28, 255, 56, 80);   // porta (acende após o chefe)
  X.fillStyle = '#e8c068'; X.fillRect(hx - 110, 245, 36, 36); X.fillRect(hx + 74, 245, 36, 36);
  label('Casa de Vó Mabeki', hx, 322);
  // limite do mapa (cerca)
  const lx = WORLD - cam;
  for (let i = 0; i < 16; i++) { X.fillStyle = '#4b2e1a'; X.fillRect(lx + 4 + (i % 2) * 0, GY0 - 40 + i * 12, 20, 10); }
  X.fillStyle = '#2a1a10'; X.fillRect(lx, GY0 - 60, 24, H);
  label('Limite do Mapa', lx - 60, 322);
  // arena travada: paredes de luz
  if (G.lock) { X.fillStyle = 'rgba(255,90,74,.25)'; X.fillRect(al - 8, GY0, 8, H); X.fillRect(ar, GY0, 8, H); }
}
function hut(x, col) {
  const sx = x - cam; if (sx < -200 || sx > W + 200) return;
  X.fillStyle = col; X.fillRect(sx - 50, 250, 100, 85);
  X.fillStyle = '#5a3320'; X.beginPath(); X.moveTo(sx - 68, 252); X.lineTo(sx, 190); X.lineTo(sx + 68, 252); X.fill();
  X.fillStyle = '#2d1a10'; X.fillRect(sx - 12, 290, 24, 45);
}
function label(t, x, y) { X.font = '12px sans-serif'; X.textAlign = 'center'; X.fillStyle = 'rgba(255,240,210,.55)'; X.fillText(t, x, y); }

function drawChar(o, col, s, face, extra = {}) {   // personagem de formas geométricas
  const sx = o.x - cam, z = o.z || 0, by = o.y - z;
  X.fillStyle = 'rgba(0,0,0,.35)'; X.beginPath(); X.ellipse(sx, o.y, 22 * s, 7 * s, 0, 0, 7); X.fill();
  const flash = extra.flash ? '#fff' : col;
  X.fillStyle = '#2a2a33'; X.fillRect(sx - 12 * s, by - 20 * s, 10 * s, 20 * s); X.fillRect(sx + 2 * s, by - 20 * s, 10 * s, 20 * s); // pernas
  X.fillStyle = flash; X.fillRect(sx - 15 * s, by - 62 * s, 30 * s, 44 * s);                                                       // tronco
  X.fillStyle = extra.skin || '#c68a5c'; X.beginPath(); X.arc(sx, by - 72 * s, 12 * s, 0, 7); X.fill();                           // cabeça
  X.fillStyle = '#111'; X.fillRect(sx + face * 5 * s - 2, by - 75 * s, 4, 4);                                                      // olho
  if (extra.shield) { X.fillStyle = extra.guard ? '#9ad' : '#556'; X.fillRect(sx + face * 16 * s - 5, by - 58 * s, 10, 34 * s); }
}
function drawPlayer() {
  const gr = P.groove > 0;
  if (P.inv > 0 && P.dodgeT <= 0 && Math.floor(G.t * 20) % 2) return;            // pisca ao ser atingido
  drawChar(P, gr ? '#ffcf4a' : '#e8a33d', 1, P.face, { flash: P.hurtT > 0, skin: '#8a5636' });
  const sx = P.x - cam, by = P.y - P.z;
  if (gr) { X.strokeStyle = 'rgba(255,200,60,.6)'; X.lineWidth = 3; X.beginPath(); X.arc(sx, by - 40, 46 + Math.sin(G.t * 10) * 3, 0, 7); X.stroke(); }
  if (P.atkT > 0) {                                                               // soco / chute (retângulo)
    X.fillStyle = P.step === 3 ? '#ff7a3a' : '#fff';
    X.fillRect(sx + P.face * 14 - (P.face < 0 ? 38 : 0), by - 50, 38 + P.step * 6, 12);
  }
  if (P.parryFx > 0) {                                                            // escudo de aparo
    X.strokeStyle = P.parryT > 0 ? '#7ff' : 'rgba(120,255,255,.35)'; X.lineWidth = 4;
    X.beginPath(); X.arc(sx + P.face * 14, by - 45, 30 + (0.25 - P.parryFx) * 40, -1.2, 1.2); X.stroke();
  }
  if (P.slowT > 0) { X.fillStyle = '#b080ff'; X.fillRect(sx - 14, by - 100, 28, 5); }
}
function drawEnemy(e) {
  const T = TYPES[e.t];
  drawChar(e, e.ph2 ? '#c24b3a' : T.col, T.s, e.face, { flash: e.fl > 0, shield: e.t === 'ras', guard: e.guard, skin: e.t === 'boss' ? '#eee' : '#bbb' });
  const sx = e.x - cam, top = e.y - 100 * T.s;
  if (e.stun > .3) { X.fillStyle = '#ff0'; X.font = 'bold 16px sans-serif'; X.textAlign = 'center'; X.fillText('★ ★', sx, top - 8); }
  if (e.wT > 0) {                                                                 // telegrafia do ataque
    const ready = e.wT <= PARRY_MS / 1000;                                         // últimos 133ms = momento do aparo
    X.strokeStyle = ready ? '#fff' : '#ff5a4a'; X.lineWidth = ready ? 5 : 3;
    X.beginPath(); X.arc(sx, e.y - 50 * T.s, 14 + e.wT * 70, 0, 7); X.stroke();
    X.fillStyle = ready ? '#fff' : '#ff5a4a'; X.font = 'bold 22px sans-serif'; X.textAlign = 'center'; X.fillText('!', sx, top - 6);
    if (e.t === 'sel') { X.strokeStyle = 'rgba(176,128,255,.6)'; X.lineWidth = 2; X.beginPath(); X.moveTo(sx, e.y - 50); X.lineTo(P.x - cam, P.y - 50); X.stroke(); }
  }
  if (e.t !== 'boss') { X.fillStyle = '#000'; X.fillRect(sx - 18, top - 4, 36, 5); X.fillStyle = '#e44'; X.fillRect(sx - 18, top - 4, 36 * Math.max(0, e.hp / e.mhp), 5); }
}
function bar(x, y, w, h, v, col, bg = '#1c1420') {
  X.fillStyle = bg; X.fillRect(x, y, w, h); X.fillStyle = col; X.fillRect(x, y, w * clamp(v, 0, 1), h);
  X.strokeStyle = '#000'; X.lineWidth = 2; X.strokeRect(x, y, w, h);
}
function txt(t, x, y, size = 14, col = '#fff', al = 'left') { X.font = 'bold ' + size + 'px sans-serif'; X.textAlign = al; X.fillStyle = col; X.fillText(t, x, y); }
function drawHUD() {
  txt('AKIN', 20, 24, 14, '#ffd36b');
  bar(20, 30, 220, 16, P.hp / P.mhp, '#d8453a');                    txt('Vida', 246, 43, 11);
  bar(20, 52, 220, 12, P.eco / 100, '#3aa8e8');                     // marcas: especial (20) e super (100)
  X.fillStyle = '#fff'; X.fillRect(20 + 220 * .2, 52, 2, 12);       txt('Eco ' + Math.floor(P.eco) + (P.eco >= 100 ? ' (SUPER!)' : P.eco >= 20 ? ' (Especial)' : ''), 246, 62, 11);
  bar(20, 70, 220, 10, P.groove / GROOVE_TIME, '#ffcf4a');          txt(P.groove > 0 ? 'GROOVE ' + P.groove.toFixed(1) + 's' : 'Groove ' + (P.grooveCD > 0 ? 'recarga' : 'pronto: Eco cheio / 50 hits'), 246, 79, 11, P.groove > 0 ? '#ffcf4a' : '#fff');
  if (P.combo > 1) { txt(P.combo + ' HITS', W - 24, 50, 32, '#ffd36b', 'right'); bar(W - 144, 58, 120, 5, P.comboT / 2.5, '#ffd36b'); }
  // pulso do ritmo (inimigos atacam no compasso)
  const pulse = (G.t % BEAT) / BEAT;
  X.strokeStyle = 'rgba(255,255,255,.5)'; X.lineWidth = 2; X.beginPath(); X.arc(W - 40, 100, 6 + (1 - pulse) * 10, 0, 7); X.stroke();
  const b = E.find(e => e.t === 'boss');
  if (b) { txt(TYPES.boss.n + (b.ph2 ? ' — Fase 2' : ''), W / 2, 24, 14, '#f2e8c9', 'center'); bar(W / 2 - 200, 30, 400, 14, b.hp / b.mhp, b.ph2 ? '#c24b3a' : '#d8d0bb'); }
  if (G.msgT > 0) txt(G.msg, W / 2, 110, 22, '#fff', 'center');
  txt('J atacar  K aparo(133ms)  L esquiva  I especial  O super  Espaço pular  Shift correr', W / 2, H - 10, 12, 'rgba(255,255,255,.6)', 'center');
}
function overlay(title, lines, col) {
  X.fillStyle = 'rgba(10,6,16,.82)'; X.fillRect(0, 0, W, H);
  txt(title, W / 2, 190, 40, col, 'center');
  lines.forEach((l, i) => txt(l, W / 2, 245 + i * 26, 17, '#eee', 'center'));
}
function draw() {
  X.save();
  if (G.scene === 'play' && G.shake > 0) X.translate(rnd(-4, 4), rnd(-4, 4));
  if (G.scene === 'title') { cam = 0; E = []; FX = []; FL = []; P = P || { x: 0, y: 0, z: 0 }; }
  drawWorld();
  if (G.scene !== 'title') {
    [P, ...E].sort((a, b) => a.y - b.y).forEach(o => o === P ? drawPlayer() : drawEnemy(o));
    FX.forEach(f => {
      X.globalAlpha = clamp(f.l * 3, 0, 1);
      if (f.ring) { X.strokeStyle = f.c; X.lineWidth = 5; X.beginPath(); X.ellipse(f.x - cam, f.y, f.s * 2, f.s, 0, 0, 7); X.stroke(); }
      else { X.fillStyle = f.c; X.fillRect(f.x - cam, f.y, f.s, f.s); }
      X.globalAlpha = 1;
    });
    FL.forEach(f => { X.globalAlpha = clamp(f.l * 2, 0, 1); txt(f.t, f.x - cam, f.y, 16, f.c, 'center'); X.globalAlpha = 1; });
    drawHUD();
    if (G.flash > 0) { X.fillStyle = 'rgba(255,255,255,' + G.flash * .8 + ')'; X.fillRect(0, 0, W, H); }
  }
  X.restore();
  if (G.scene === 'title') overlay('AS QUATRO CHAMAS DE NZILA', ['Vertical Slice — Vila Raiz', '', 'Setas/WASD mover · Shift correr · Espaço pular · L esquiva', 'J atacar (combo de 3) · K aparo (janela de 133ms) · I especial · O super', 'Aparo perfeito = sem dano + 6 Eco. Eco cheio ou 50 hits = Groove.', '', 'Pressione ENTER para começar'], '#ffb347');
  if (G.scene === 'dead') overlay('DERROTADO', ['Os Desbotados apagaram a chama de Akin...', 'Pressione R para tentar de novo'], '#e44');
  if (G.scene === 'win') overlay('VILA RAIZ SALVA!', ['Vó Mabeki acolhe Akin. A primeira chama voltou a arder.', 'Tempo: ' + Math.floor(G.t / 60) + 'm' + Math.floor(G.t % 60) + 's · Inimigos: ' + G.kills + ' · Aparos perfeitos: ' + G.parries, '', 'Pressione R para jogar de novo'], '#ffd36b');
}

// ---------- Loop principal ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(.033, (now - last) / 1000); last = now;
  update(dt); draw();
  for (const k in press) delete press[k];   // limpa eventos de "tecla pressionada neste frame"
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
