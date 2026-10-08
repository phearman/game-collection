// 足球守門員繪圖模組(RS12):只負責畫面與特效,⛔ 不改 state、不含規則。
// 畫風比照下樓梯(D71、guides/art-style.md):大頭可愛角色、深色描邊+背光側陰影、平塗為主、深淺兩套色票、形狀可辨。
// 座標:畫布單位 FIELD_W × FIELD_H(呼叫端先縮放好);世界 x 以球門中央為 0、往右為正,世界 y 為離地高度(往上為正)。
import {
  FIELD_W, GOAL_HALF_W, GOAL_H, RUNUP_MS, ACTION_MS, PARAMS, keeperPose, saveZone, lastResult, tally,
} from './logic.js';

export const FIELD_H = 420;
const CX = FIELD_W / 2;
const GROUND = 200; // 門線(世界 y = 0)在畫面上的高度
export const SPOT = { x: CX, y: 360 }; // 罰球點
export const sx = (x) => CX + x;
export const sy = (y) => GROUND - y;
const STAND_H = 92; // 看台高度
const BOARD_Y = 92; // 廣告圍板上緣
const BOARD_H = 18;
const MAX_PARTICLES = 50;
const MAX_PARTICLES_REDUCED = 10;
export const POP_MS = 1300; // 「撲到了!」「GOAL!」彈出字顯示時間(= 結果顯示時間)

// 色票:CSS 變數 --kp-{key}(style.css 定義深淺兩套)。
export const PALETTE_KEYS = [
  'night', 'sky-top', 'sky-bot', 'stand', 'stand-hi', 'crowd-a', 'crowd-b', 'crowd-c', 'crowd-d', 'board-a', 'board-b', 'board-text',
  'grass-a', 'grass-b', 'line', 'post', 'post-dark', 'net', 'light', 'glow',
  'skin', 'hair', 'jersey', 'jersey-dark', 'shorts', 'sock', 'glove', 'glove-dark', 'boot', 'eye', 'cheek',
  'kid-jersey', 'kid-cap', 'kid-shorts', 'ball', 'ball-dark', 'shadow', 'ink', 'zone', 'zone-line',
  'save', 'goal', 'star', 'text', 'hud',
];

// cs = getComputedStyle(document.documentElement)(由呼叫端傳入,本模組不碰 DOM 全域)。
export function readPalette(cs) {
  return Object.fromEntries(PALETTE_KEYS.map((k) => [k, cs.getPropertyValue(`--kp-${k}`).trim()]));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---- 球的軌跡(畫面座標):起腳點 → 目標點,中段略抬高;半徑由近而遠變小 ----

export function ballAt(target, p) {
  const tx = sx(target.x);
  const ty = sy(target.y);
  const lift = Math.sin(Math.PI * p) * 30;
  return { x: SPOT.x + (tx - SPOT.x) * p, y: SPOT.y + (ty - SPOT.y) * p - lift, r: 10 - 4 * p };
}

// 球的地面影子:水平跟著目標 x,由罰球點的地面移到門線(看影子就知道球往哪裡去)
export function shadowAt(target, p) {
  return { x: SPOT.x + (sx(target.x) - SPOT.x) * p, y: SPOT.y + 8 + (GROUND - SPOT.y - 8) * p, r: 9 - 3 * p };
}

// ---- 特效狀態(畫面層自己的,不進存檔)----

export function createFx() {
  return {
    t: 0,
    particles: [], // { kind, x, y, vx, vy, life, max }
    pop: null, // { text, kind: 'save' | 'goal', t }
    net: null, // 球網震動 { x, y, t }(畫面座標)
    shake: 0,
    walk: 0, // 守門員走路相位
    lastX: 0,
    facing: 1,
    ending: false,
  };
}

export const fxBusy = (fx) => fx.particles.length > 0 || fx.shake > 0 || (fx.pop && fx.pop.t < POP_MS) || (fx.net && fx.net.t < 900);

function burst(fx, kind, x, y, n, reduced) {
  const cap = reduced ? MAX_PARTICLES_REDUCED : MAX_PARTICLES;
  const count = reduced ? Math.ceil(n / 3) : n;
  for (let i = 0; i < count && fx.particles.length < cap; i++) {
    const a = Math.PI * 2 * (i / count) + Math.random() * 0.5;
    const v = 60 + Math.random() * 90;
    fx.particles.push({ kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.7, max: 0.7 });
  }
}

// 比對一幀前後的 state,觸發特效。
export function fxEvents(fx, prev, next, { reduced = false } = {}) {
  const pk = keeperPose(prev.keeper);
  const nk = keeperPose(next.keeper);
  if (nk.x !== pk.x && !next.keeper.action) fx.facing = nk.x > pk.x ? 1 : -1;
  if (next.log.length > prev.log.length && next.shot) {
    const r = lastResult(next);
    const b = ballAt(next.shot.target, 1);
    if (r === 'save') {
      const streak = tally(next.log).streak;
      fx.pop = { text: streak >= 2 ? `撲到了!連撲 ×${streak}` : '撲到了!', kind: 'save', t: 0 };
      burst(fx, 'star', b.x, b.y, 12, reduced);
    } else {
      fx.pop = { text: 'GOAL!', kind: 'goal', t: 0 };
      fx.net = { x: b.x, y: b.y, t: 0 };
      if (!reduced) fx.shake = 0.35;
      burst(fx, 'spark', b.x, b.y, 8, reduced);
    }
  }
}

export function fxUpdate(fx, dt, state) {
  fx.t += dt;
  const { x } = keeperPose(state.keeper);
  if (Math.abs(x - fx.lastX) > 0.01 && !state.keeper.action) fx.walk += dt * 0.03;
  fx.lastX = x;
  for (const p of fx.particles) {
    p.x += (p.vx * dt) / 1000;
    p.y += (p.vy * dt) / 1000;
    p.vy += (p.kind === 'star' ? 140 : 260) * (dt / 1000);
    p.life -= dt / 1000;
  }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  if (fx.pop) fx.pop.t += dt;
  if (fx.net) fx.net.t += dt;
  fx.shake = Math.max(0, fx.shake - dt / 1000);
}

// ---- 形狀 ----

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}

function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

// 共用描邊:角色、球、球門都用同一種深色細邊(與下樓梯同一規則)
function ink(c, pal, w = 1.4) {
  c.strokeStyle = pal.ink;
  c.lineWidth = w;
  c.stroke();
}

// 背光側陰影:在剛畫好的形狀裡,把 x < cut 那半邊壓暗
function shadeBack(c, cut, alpha = 0.2) {
  c.save();
  c.clip();
  c.fillStyle = `rgba(0,0,0,${alpha})`;
  c.fillRect(cut - 200, -400, 200, 800);
  c.restore();
}

function limb(c, x, y, ex, ey, color, w, pal) {
  c.lineCap = 'round';
  c.strokeStyle = pal.ink;
  c.lineWidth = w + 2.4;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(ex, ey);
  c.stroke();
  c.strokeStyle = color;
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(ex, ey);
  c.stroke();
}

// ---- 背景(靜態,快取成圖層):看台+觀眾、廣告圍板、草地條紋、禁區線 ----

function paintBackground(c, pal) {
  const g = c.createLinearGradient(0, 0, 0, STAND_H);
  g.addColorStop(0, pal['sky-top']);
  g.addColorStop(1, pal['sky-bot']);
  c.fillStyle = g;
  c.fillRect(0, 0, FIELD_W, STAND_H);
  if (pal.night === '1') { // 夜:兩座照明燈
    for (const lx of [40, FIELD_W - 40]) {
      const r = c.createRadialGradient(lx, 10, 2, lx, 10, 90);
      r.addColorStop(0, pal.glow);
      r.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = r;
      c.fillRect(lx - 90, 0, 180, 110);
      c.fillStyle = pal.light;
      roundRect(c, lx - 14, 4, 28, 10, 3);
      c.fill();
    }
  }
  // 看台:三層階梯,每層一排觀眾(頭+肩)
  const tiers = [[24, 22], [46, 22], [68, 24]];
  tiers.forEach(([y, h], ti) => {
    c.fillStyle = ti % 2 ? pal.stand : pal['stand-hi'];
    c.fillRect(0, y, FIELD_W, h);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(0, y + h - 3, FIELD_W, 3);
    const colors = [pal['crowd-a'], pal['crowd-b'], pal['crowd-c'], pal['crowd-d']];
    for (let x = 6 + (ti % 2) * 7; x < FIELD_W; x += 14) {
      const k = hash(ti, x);
      c.fillStyle = colors[Math.floor(k * 4)];
      roundRect(c, x - 5, y + h - 11, 10, 9, 4);
      c.fill();
      c.fillStyle = pal.skin;
      circle(c, x, y + h - 14, 3.6);
      c.fill();
    }
  });
  // 廣告圍板
  for (let x = 0, i = 0; x < FIELD_W; x += 60, i++) {
    c.fillStyle = i % 2 ? pal['board-a'] : pal['board-b'];
    c.fillRect(x, BOARD_Y, 60, BOARD_H);
    c.fillStyle = pal['board-text'];
    c.font = '700 9px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(i % 2 ? 'GOAL KIDS' : 'PLAY ⚽', x + 30, BOARD_Y + BOARD_H / 2 + 0.5);
  }
  c.fillStyle = pal.ink;
  c.fillRect(0, BOARD_Y + BOARD_H, FIELD_W, 1.5);
  // 草地:由遠到近變寬的條紋(透視感)
  const top = BOARD_Y + BOARD_H;
  let y = top;
  for (let i = 0; y < FIELD_H; i++) {
    const h = 16 + i * 4;
    c.fillStyle = i % 2 ? pal['grass-a'] : pal['grass-b'];
    c.fillRect(0, y, FIELD_W, h);
    y += h;
  }
  // 門線、小禁區、罰球點
  c.strokeStyle = pal.line;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, GROUND);
  c.lineTo(FIELD_W, GROUND);
  c.moveTo(sx(-GOAL_HALF_W - 20), GROUND);
  c.lineTo(sx(-GOAL_HALF_W - 40), GROUND + 70);
  c.lineTo(sx(GOAL_HALF_W + 40), GROUND + 70);
  c.lineTo(sx(GOAL_HALF_W + 20), GROUND);
  c.stroke();
  c.fillStyle = pal.line;
  c.beginPath();
  c.ellipse(SPOT.x, SPOT.y + 8, 4, 2.5, 0, 0, Math.PI * 2);
  c.fill();
}

// ---- 球門:門柱(雙色立體+描邊)+球網(網格,進球時震動)----

function drawGoal(c, pal, fx, reduced) {
  const l = sx(-GOAL_HALF_W);
  const r = sx(GOAL_HALF_W);
  const top = sy(GOAL_H);
  const depth = 14; // 網子往後縮的深度(畫面上往上、往內)
  c.fillStyle = 'rgba(0,0,0,0.12)';
  c.fillRect(l, top, r - l, GOAL_H);
  // 震動:以進球點為中心的衰減波,把網格點往後推
  const net = fx?.net && !reduced && fx.net.t < 900 ? fx.net : null;
  const bump = (x, y) => {
    if (!net) return 0;
    const d2 = (x - net.x) ** 2 + (y - net.y) ** 2;
    return 9 * Math.exp(-d2 / 1800) * Math.cos(net.t / 45) * (1 - net.t / 900);
  };
  c.strokeStyle = pal.net;
  c.lineWidth = 1;
  c.beginPath();
  for (let x = l + 12; x < r; x += 12) {
    for (let i = 0; i <= 10; i++) {
      const y = top + (GOAL_H * i) / 10;
      const px = x;
      const py = y + bump(px, y);
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
  }
  for (let y = top + 12; y < GROUND; y += 12) {
    for (let i = 0; i <= 20; i++) {
      const x = l + ((r - l) * i) / 20;
      const py = y + bump(x, y);
      if (i === 0) c.moveTo(x, py);
      else c.lineTo(x, py);
    }
  }
  c.stroke();
  // 網子後框(景深)
  c.strokeStyle = pal.net;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(l, GROUND);
  c.lineTo(l + depth, top + depth);
  c.lineTo(r - depth, top + depth);
  c.lineTo(r, GROUND);
  c.stroke();
  // 門柱:白色主體+右側暗面+描邊
  const post = (x0, y0, x1, y1) => {
    c.lineCap = 'round';
    c.strokeStyle = pal.ink;
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.strokeStyle = pal.post;
    c.lineWidth = 6.5;
    c.stroke();
    c.strokeStyle = pal['post-dark'];
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0 + 1.6, y0 + 1.6);
    c.lineTo(x1 + 1.6, y1 + 1.6);
    c.stroke();
  };
  post(l, GROUND, l, top);
  post(r, GROUND, r, top);
  post(l, top, r, top);
}

// ---- 撲救範圍:半透明虛線框,大小 = 判定(saveZone)----

function drawZone(c, pal, z, strong) {
  const x0 = sx(z.x0);
  const x1 = sx(z.x1);
  const y0 = sy(z.y1);
  const y1 = sy(z.y0);
  roundRect(c, x0, y0, x1 - x0, y1 - y0, 10);
  c.fillStyle = pal.zone;
  c.globalAlpha = strong ? 1 : 0.55;
  c.fill();
  c.setLineDash([4, 4]);
  c.strokeStyle = pal['zone-line'];
  c.lineWidth = 1.2;
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 1;
}

// ---- 守門員:大頭、亮橘守門衣、大手套;手套外緣 = 撲救範圍左右邊 ----

function drawGlove(c, pal, x, y, r) {
  circle(c, x, y, r);
  c.fillStyle = pal.glove;
  c.fill();
  shadeBack(c, x - r * 0.1, 0.16);
  circle(c, x, y, r);
  ink(c, pal);
  c.fillStyle = pal['glove-dark'];
  roundRect(c, x - r * 0.55, y + r * 0.35, r * 1.1, r * 0.45, 2);
  c.fill();
}

function drawKeeper(c, s, pal, fx, held) {
  const k = s.keeper;
  const { h } = keeperPose(k);
  const z = saveZone(k, s.difficulty);
  const cx = sx(z.x);
  const shoulder = sy(z.reach);
  const feet = sy(h);
  const t = fx?.t ?? 0;
  const dive = k.action === 'diveL' ? -1 : k.action === 'diveR' ? 1 : 0;
  const prog = k.action ? clamp(k.at / ACTION_MS, 0, 1) : 0;
  const air = k.action ? Math.sin(Math.PI * prog) : 0;
  const bob = k.action ? 0 : Math.sin(t / 260) * 1.2;
  const walk = fx ? Math.sin(fx.walk * 6) : 0;
  const lean = dive * air * 0.55; // 撲救時身體往撲的方向倒(手臂維持水平,手套位置才對得上判定)
  const gr = 8.5;

  // 腳下影子(離地越高越小越淡)
  c.fillStyle = pal.shadow;
  c.globalAlpha = 1 - clamp(h / 90, 0, 0.7);
  c.beginPath();
  c.ellipse(cx, GROUND + 3, 20 - h * 0.08, 4, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;

  // 手臂+手套:水平伸到撲救範圍左右邊(手套外緣 = 範圍邊界)
  const gl = sx(z.x0) + gr;
  const grx = sx(z.x1) - gr;
  limb(c, cx - 8, shoulder, gl, shoulder, pal.jersey, 6, pal);
  limb(c, cx + 8, shoulder, grx, shoulder, pal.jersey, 6, pal);

  c.save();
  c.translate(cx, shoulder);
  c.rotate(lean);
  const hip = 24 + bob;
  const legLen = feet - shoulder - hip; // 站立時 = 40 - 24
  // 腿:走路左右交替、跳起縮腿、撲救併腿
  const legSpread = k.action === 'jump' ? 6 : dive ? 3 : 6 + walk * 4;
  const legBend = k.action === 'jump' ? -6 * air : 0;
  for (const side of [-1, 1]) {
    const lx = side * 5;
    const fx2 = side * legSpread + (k.action ? 0 : walk * side * 2);
    limb(c, lx, hip, fx2, hip + legLen + legBend, pal.sock, 5.5, pal);
    c.fillStyle = pal.boot;
    c.beginPath();
    c.ellipse(fx2 + side * 2, hip + legLen + legBend + 1.5, 5, 3, 0, 0, Math.PI * 2);
    c.fill();
    ink(c, pal, 1.1);
  }
  // 短褲
  roundRect(c, -11, hip - 6, 22, 9, 3);
  c.fillStyle = pal.shorts;
  c.fill();
  ink(c, pal, 1.2);
  // 守門衣(背光側陰影+號碼)
  roundRect(c, -12, -4 + bob, 24, hip - 2, 6);
  c.fillStyle = pal.jersey;
  c.fill();
  shadeBack(c, -2, 0.18);
  roundRect(c, -12, -4 + bob, 24, hip - 2, 6);
  ink(c, pal, 1.4);
  c.fillStyle = pal['jersey-dark'];
  c.font = '800 10px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('1', 0, 8 + bob);
  // 頭:大頭比例、刺刺頭髮、表情(撲救中咬牙、撲到時開心)
  const hy = -15 + bob;
  circle(c, 0, hy, 13.5);
  c.fillStyle = pal.skin;
  c.fill();
  c.save();
  circle(c, 0, hy, 13.5);
  c.clip();
  c.fillStyle = 'rgba(120,60,30,0.15)';
  circle(c, -9 * fx?.facing || -9, hy + 3, 13);
  c.fill();
  c.restore();
  circle(c, 0, hy, 13.5);
  ink(c, pal, 1.4);
  c.fillStyle = pal.hair;
  c.beginPath();
  c.moveTo(-13.5, hy - 2);
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (Math.PI * i) / 6;
    const rr = i % 2 ? 17 : 13.8;
    c.lineTo(Math.cos(a) * rr, hy - 1 + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  ink(c, pal, 1.2);
  const face = fx?.facing ?? 1;
  const ex = face * 3;
  c.fillStyle = '#ffffff';
  for (const dx of [-4.5, 4.5]) {
    c.beginPath();
    c.ellipse(ex + dx, hy + 1, 2.8, k.action ? 2 : 3.2, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = pal.eye;
  for (const dx of [-4.5, 4.5]) {
    circle(c, ex + dx + face * 0.8, hy + 1.4, 1.6);
    c.fill();
  }
  c.fillStyle = pal.cheek;
  for (const dx of [-8, 8]) {
    circle(c, ex + dx, hy + 6, 2.2);
    c.fill();
  }
  c.strokeStyle = pal.eye;
  c.lineWidth = 1.3;
  c.beginPath();
  if (held === 'save') c.arc(ex, hy + 6, 3.5, 0.15 * Math.PI, 0.85 * Math.PI); // 撲到:笑
  else if (k.action) { c.moveTo(ex - 3, hy + 7.5); c.lineTo(ex + 3, hy + 7.5); } // 撲救中:咬牙
  else c.arc(ex, hy + 6.5, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
  c.stroke();
  c.restore();

  // 手套最後畫(壓在身體上)
  drawGlove(c, pal, gl, shoulder, gr);
  drawGlove(c, pal, grx, shoulder, gr);
  return { gl, grx, y: shoulder };
}

// ---- 射手:戴帽子的小朋友;助跑、起腳前 300ms 身體朝射門方向傾斜、踢球 ----

function drawShooter(c, s, pal) {
  let p = 0;
  if (s.phase === 'runup') p = s.t / RUNUP_MS;
  else if (s.phase === 'flight' || s.phase === 'result' || s.phase === 'over') p = 1;
  const x = SPOT.x - 70 + 48 * p;
  const y = SPOT.y + 30 - 42 * p; // 腳底
  const stride = s.phase === 'runup' ? Math.sin(s.t / 45) * 6 : 0;
  const kick = s.phase === 'flight' && s.t < 220 ? 1 - s.t / 220 : 0;
  const dir = s.shot ? Math.sign(s.shot.target.x) || 0 : 0;
  const lean = s.phase === 'runup' && s.t > RUNUP_MS - 300 ? dir * 0.28 * ((s.t - (RUNUP_MS - 300)) / 300) : kick ? dir * 0.28 : 0;

  c.fillStyle = pal.shadow;
  c.beginPath();
  c.ellipse(x, y + 2, 13, 3.5, 0, 0, Math.PI * 2);
  c.fill();

  c.save();
  c.translate(x, y);
  c.rotate(lean);
  // 腿(踢球腳往前上踢)
  limb(c, -3, -18, -5 - stride, -1, pal['kid-shorts'], 5, pal);
  limb(c, 3, -18, 6 + stride + kick * 10, -1 - kick * 9, pal['kid-shorts'], 5, pal);
  for (const [fx2, fy] of [[-5 - stride, -1], [6 + stride + kick * 10, -1 - kick * 9]]) {
    c.fillStyle = pal.boot;
    c.beginPath();
    c.ellipse(fx2 + 1.5, fy + 1, 4.5, 2.6, 0, 0, Math.PI * 2);
    c.fill();
  }
  // 身體
  roundRect(c, -9, -40, 18, 24, 5);
  c.fillStyle = pal['kid-jersey'];
  c.fill();
  shadeBack(c, -2, 0.18);
  roundRect(c, -9, -40, 18, 24, 5);
  ink(c, pal, 1.3);
  limb(c, -8, -36, -14 - stride * 0.6, -24, pal['kid-jersey'], 4.5, pal);
  limb(c, 8, -36, 14 + stride * 0.6, -24, pal['kid-jersey'], 4.5, pal);
  // 頭+帽子(帽沿朝球門)
  const hy = -52;
  circle(c, 0, hy, 11.5);
  c.fillStyle = pal.skin;
  c.fill();
  ink(c, pal, 1.3);
  c.fillStyle = pal['kid-cap'];
  c.beginPath();
  c.arc(0, hy - 2, 12, Math.PI, 0);
  c.closePath();
  c.fill();
  ink(c, pal, 1.2);
  roundRect(c, -12, hy - 6, 24, 4, 2);
  c.fill();
  c.fillStyle = pal.eye; // 看向球門(背對鏡頭的側臉:只露一點眼睛)
  circle(c, 4, hy + 2, 1.5);
  c.fill();
  circle(c, -4, hy + 2, 1.5);
  c.fill();
  c.restore();
}

// ---- 足球:白底+五邊形花紋+描邊;影子、拖尾 ----

function drawBall(c, pal, { x, y, r }) {
  circle(c, x, y, r);
  c.fillStyle = pal.ball;
  c.fill();
  c.fillStyle = pal['ball-dark'];
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    c.lineTo(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42);
  }
  c.closePath();
  c.fill();
  circle(c, x, y, r);
  ink(c, pal, 1.2);
  c.fillStyle = 'rgba(255,255,255,0.7)';
  circle(c, x - r * 0.35, y - r * 0.4, r * 0.18);
  c.fill();
}

function drawShadow(c, pal, { x, y, r }) {
  c.fillStyle = pal.shadow;
  c.beginPath();
  c.ellipse(x, y, r, r * 0.38, 0, 0, Math.PI * 2);
  c.fill();
}

function drawTrail(c, pal, target, p) {
  for (let i = 5; i >= 1; i--) {
    const q = p - i * 0.035;
    if (q <= 0) continue;
    const b = ballAt(target, q);
    c.globalAlpha = 0.09 * (6 - i);
    c.fillStyle = pal.ball;
    circle(c, b.x, b.y, b.r * (1 - i * 0.08));
    c.fill();
  }
  c.globalAlpha = 1;
}

function drawParticles(c, fx, pal) {
  for (const p of fx.particles) {
    c.globalAlpha = clamp(p.life / p.max, 0, 1);
    if (p.kind === 'star') {
      c.fillStyle = pal.star;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 ? 2 : 5;
        const a = (i * Math.PI) / 4;
        c.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
      }
      c.fill();
    } else {
      c.fillStyle = pal.goal;
      circle(c, p.x, p.y, 2.5);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

// 彈出字:先放大再回彈,最後淡出
function drawPop(c, pal, pop) {
  const k = pop.t / POP_MS;
  const scale = k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : k < 0.22 ? 1.15 - ((k - 0.12) / 0.1) * 0.15 : 1;
  c.save();
  c.globalAlpha = k > 0.8 ? clamp((1 - k) / 0.2, 0, 1) : 1;
  c.translate(CX, 282);
  c.scale(scale, scale);
  c.font = `800 ${pop.text.length > 6 ? 26 : 36}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = 7;
  c.strokeStyle = pal.ink;
  c.strokeText(pop.text, 0, 0);
  c.fillStyle = pop.kind === 'save' ? pal.save : pal.goal;
  c.fillText(pop.text, 0, 0);
  c.restore();
}

function tag(c, pal, text, x, y, align = 'center') {
  c.font = '800 13px system-ui, sans-serif';
  const w = c.measureText(text).width + 14;
  const left = align === 'right' ? x - w : x - w / 2;
  roundRect(c, left, y - 11, w, 22, 11);
  c.fillStyle = pal.hud;
  c.fill();
  ink(c, pal, 1.2);
  c.fillStyle = pal.text;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, left + w / 2, y + 0.5);
}

// ---- 快取圖層:背景是靜態的,預先畫好再貼(依縮放倍率與色票分開存)----

// 球門(門柱+靜止的球網)也是靜態的,另存一層;只有進球震動時才逐幀重畫。
const layers = new Map();
function cachedLayers(c, pal) {
  const scale = typeof OffscreenCanvas === 'function' ? c.getTransform?.()?.a : 0;
  if (!scale) return null;
  const key = Math.round(scale * 100);
  const hit = layers.get(key);
  if (hit && hit.pal === pal) return hit;
  const make = (paint) => {
    const cv = new OffscreenCanvas(Math.round(FIELD_W * scale), Math.round(FIELD_H * scale));
    const g = cv.getContext('2d');
    g.setTransform(cv.width / FIELD_W, 0, 0, cv.height / FIELD_H, 0, 0);
    paint(g);
    return cv;
  };
  const out = { pal, bg: make((g) => paintBackground(g, pal)), goal: make((g) => drawGoal(g, pal, null, true)) };
  layers.set(key, out);
  return out;
}

// 畫一整個場面。fx = createFx() 的特效狀態(示範圖可傳 null);opts = { reduced }。
export function drawScene(c, s, pal, fx = null, opts = {}) {
  c.save();
  if (fx && fx.shake > 0 && !opts.reduced) {
    const m = 5 * (fx.shake / 0.35);
    c.translate(Math.sin(fx.t / 11) * m, Math.cos(fx.t / 13) * m);
  }
  const L = cachedLayers(c, pal);
  if (L) c.drawImage(L.bg, 0, 0, FIELD_W, FIELD_H);
  else paintBackground(c, pal);
  const shaking = fx?.net && fx.net.t < 900 && !opts.reduced;
  if (L && !shaking) c.drawImage(L.goal, 0, 0, FIELD_W, FIELD_H);
  else drawGoal(c, pal, fx, opts.reduced);

  const shot = s.shot;
  const r = (s.phase === 'result' || s.phase === 'over') ? lastResult(s) : null;
  const flight = PARAMS[s.difficulty].flight;
  const p = s.phase === 'flight' && shot ? s.t / flight : null;

  drawZone(c, pal, saveZone(s.keeper, s.difficulty), p !== null);
  if (p !== null) drawShadow(c, pal, shadowAt(shot.target, p));
  const hands = drawKeeper(c, s, pal, fx, r);
  drawShooter(c, s, pal);

  if (p !== null) {
    drawTrail(c, pal, shot.target, p);
    drawBall(c, pal, ballAt(shot.target, p));
  } else if (r === 'goal' && shot) {
    drawBall(c, pal, ballAt(shot.target, 1));
  } else if (r === 'save' && shot) { // 撲到:球停在比較近的那隻手套上
    const tx = sx(shot.target.x);
    const gx = Math.abs(tx - hands.gl) < Math.abs(tx - hands.grx) ? hands.gl : hands.grx;
    drawBall(c, pal, { x: gx, y: hands.y - 7, r: 7 });
  } else {
    drawShadow(c, pal, { x: SPOT.x, y: SPOT.y + 8, r: 9 });
    drawBall(c, pal, { x: SPOT.x, y: SPOT.y, r: 10 });
  }

  if (fx) drawParticles(c, fx, pal);
  // 連撲數、最後一球提示
  const streak = tally(s.log).streak;
  if (streak >= 2 && s.phase !== 'ready') tag(c, pal, `連撲 ×${streak}`, FIELD_W - 10, 128, 'right');
  if (s.log.length === s.total - 1 && ['wait', 'runup'].includes(s.phase)) tag(c, pal, '最後一球!', CX, 128);
  if (fx?.pop && fx.pop.t < POP_MS) drawPop(c, pal, fx.pop);
  else if (!fx && r) drawPop(c, pal, { text: r === 'save' ? '撲到了!' : 'GOAL!', kind: r, t: POP_MS * 0.5 });
  c.restore();
}
