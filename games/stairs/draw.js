// 下樓梯繪圖模組(RS11):只負責畫面與特效,⛔ 不改 state、不含規則。
// 座標單位 = 場地單位(logic.js 的 W × H,x 往右、y 往下);呼叫端先把 ctx 縮放到場地單位。
// 美術正典:workbook/plans/rs11-stairs-art.md「RS11 美術要求」;第 1 輪退回(PR #20 A1~A3)後改為「高塔內部」世界觀。
import { W, H, PLAYER, CEIL, FLIP_DELAY, MAX_LIVES, HURT_SEC, heartBox, enemyBox, scrolledBy, canonicalState, directionFor, stageFor,
  goalMarker, nearestCoin, celebrating } from './logic.js?v=4a61272';

export const THICK = 0.3; // 平台畫面厚度(碰撞只看上緣)
export const END_SEC = 0.8; // 結束動畫長度(≤ 1 秒),播完才顯示結算遮罩
const HURT_FLASH = 0.5; // 受傷閃爍秒數
const SPRING_SEC = 0.3; // 彈跳平台壓縮回彈
const LAND_SEC = 0.18; // 落地壓扁回彈
const HERO = 1.25; // 角色畫面放大倍率(碰撞框仍是 PLAYER,腳底對齊框底)
const MAX_PARTICLES = 60;
const MAX_PARTICLES_REDUCED = 12; // prefers-reduced-motion

// 色票:CSS 變數 --st-{key}(style.css 定義深淺兩套)。
export const PALETTE_KEYS = [
  'night', 'wall-top', 'wall-bot', 'brick-a', 'brick-b', 'win-frame', 'win-sky-a', 'win-sky-b', 'win-light', 'pillar', 'pillar-hi',
  'glow', 'flame', 'iron-hi', 'iron', 'iron-dark', 'glint', 'ink', 'shadow', 'warm', 'brick-spot', 'rust', 'rust-dark', 'rust-spot', 'beam', 'wood', 'wood-hi', 'wood-dark', 'old', 'old-hi', 'old-dark', 'axle',
  'warn', 'spike', 'bounce', 'bounce-hi', 'bounce-dark', 'coil', 'skin', 'hat', 'hat-hi', 'scarf', 'coat', 'sleeve', 'pants', 'boot',
  'eye', 'cheek', 'heart', 'empty', 'text', 'halo', 'danger', 'hud', 'dust',
  'coin', 'star', 'shield', 'cloud', 'enemy', 'enemy-hi', 'flag',
  ...['forest', 'cave', 'ice', 'factory', 'sky', 'tower'].flatMap((theme) => ['bg', 'scenery', 'board', 'hi', 'dark'].map((key) => `${theme}-${key}`)),
];

// cs = getComputedStyle(document.documentElement)(由呼叫端傳入,本模組不碰 DOM 全域)。
export function readPalette(cs) {
  return Object.fromEntries(PALETTE_KEYS.map((k) => [k, cs.getPropertyValue(`--st-${k}`).trim()]));
}

const themePalettes = new WeakMap();
function themePalette(pal, theme) {
  let themes = themePalettes.get(pal);
  if (!themes) { themes = new Map(); themePalettes.set(pal, themes); }
  if (themes.has(theme)) return themes.get(theme);
  const bg = pal[`${theme}-bg`];
  const scenery = pal[`${theme}-scenery`];
  const out = { ...pal, theme, 'wall-top': bg, 'wall-bot': bg,
    'brick-a': scenery, 'brick-b': bg, pillar: scenery, 'pillar-hi': pal[`${theme}-hi`],
    wood: pal[`${theme}-board`], 'wood-hi': pal[`${theme}-hi`], 'wood-dark': pal[`${theme}-dark`],
    iron: scenery, 'iron-hi': pal[`${theme}-hi`], 'iron-dark': pal[`${theme}-dark`],
    ...(theme === 'tower' ? { night: '1' } : {}) };
  themes.set(theme, out);
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hash = (a, b) => { // 固定的偽亂數(磚塊深淺、窗戶位置),同一格每張畫面都一樣
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---- 特效狀態(畫面層自己的,不進存檔)----

export function createFx() {
  return {
    particles: [], // { kind, x, y, vx, vy, life, max }
    texts: [], // { text, x, y, life, max }
    ghosts: [], // 翻落中的翻轉平台 { x, y, w, vy, rot, life }
    springs: new Map(), // 彈跳平台層號 → 剩餘秒數
    shake: 0,
    hurtFlash: 0,
    ending: null, // { t, kind: 'fall' 掉出底部 / 'ko' 生命歸零, x, y }
    banner: null, // RS39 最後階段大字 { text, life, max }
    show: null, // RS39 過關演出 { t, shells: [{ at, x, y, color }] }(煙火排程,畫面座標)
    sparks: [], // RS39 煙火粒子(畫面座標,不隨場景翻轉){ x, y, vx, vy, life, max, color }
    anim: { t: 0, facing: 1, moving: false, phase: 0, land: 0 },
  };
}

export const fxBusy = (fx) => fx.particles.length > 0 || fx.texts.length > 0 || fx.ghosts.length > 0
  || fx.shake > 0 || fx.hurtFlash > 0 || (fx.ending !== null && fx.ending.t < END_SEC)
  || fx.banner !== null || fx.sparks.length > 0 || (fx.show?.shells.length ?? 0) > 0;

// ---- RS39 最後階段大字、過關煙火 ----
export const BANNER_SEC = 1.6;
const FIREWORK_COLORS = ['warn', 'heart', 'shield', 'bounce-hi', 'star', 'flag'];
// 最後階段提示(ui 依 logic.finalCue 呼叫)。
export function fxBanner(fx, text) { fx.banner = { text, life: BANNER_SEC, max: BANNER_SEC }; }
// 過關演出開始:排好煙火。reduced = 不放煙火(改畫靜態星芒)。final = 6 關全過,放更多發。
export function fxCelebrate(fx, { seconds = 2, final = false, reduced = false } = {}) {
  const shells = [];
  if (!reduced) {
    const every = final ? 0.22 : 0.3;
    for (let at = 0.05, i = 0; at < seconds - 0.4; at += every, i++) {
      shells.push({ at, x: 1.2 + Math.random() * (W - 2.4), y: 2.2 + Math.random() * (H * 0.4), color: FIREWORK_COLORS[i % FIREWORK_COLORS.length] });
    }
  }
  fx.show = { t: 0, shells };
}
// 略過演出:停止尚未發射的煙火。
export function fxSkipCelebrate(fx) { if (fx.show) fx.show.shells = []; fx.sparks = []; }
function explode(fx, shell) {
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
    const v = 2.6 + Math.random() * 1.4;
    fx.sparks.push({ x: shell.x, y: shell.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9, max: 0.9, color: shell.color });
  }
}

export const endingDone = (fx) => fx.ending === null || fx.ending.t >= END_SEC;

const BURST = {
  dust: { n: 6, speed: 1.2, up: 0.6, grav: -0.4, life: 0.45 },
  spark: { n: 8, speed: 2.6, up: 1.5, grav: 8, life: 0.4 },
  star: { n: 8, speed: 2.2, up: 2.5, grav: 6, life: 0.6 },
  heart: { n: 6, speed: 1.6, up: 1.8, grav: 2, life: 0.7 },
};

function burst(fx, kind, x, y, reduced) {
  const b = BURST[kind];
  const cap = reduced ? MAX_PARTICLES_REDUCED : MAX_PARTICLES;
  const n = reduced ? Math.ceil(b.n / 3) : b.n;
  for (let i = 0; i < n && fx.particles.length < cap; i++) {
    const a = Math.PI * (0.1 + (0.8 * (i + 0.5)) / n) + (Math.random() - 0.5) * 0.4; // 往上扇形散開
    const v = b.speed * (0.6 + Math.random() * 0.6);
    fx.particles.push({ kind, x, y, vx: -Math.cos(a) * v, vy: -Math.sin(a) * v * (b.up / b.speed + 0.3), life: b.life, max: b.life });
  }
}

// 比對一步前後的 state,觸發特效。dir = 本步輸入方向。
export function fxEvents(fx, prev, next, { dir = 0, reduced = false } = {}) {
  prev = canonicalState(prev);
  next = canonicalState(next);
  const a = fx.anim;
  if (dir) a.facing = dir;
  a.moving = dir !== 0 && next.player.on !== null;
  const cx = next.player.x + PLAYER / 2;
  const feet = next.player.y + PLAYER;

  if (prev.player.on === null && next.player.on !== null) {
    const p = next.platforms.find((q) => q.n === next.player.on);
    burst(fx, p?.kind === 'spike' ? 'spark' : 'dust', cx, feet, reduced);
    a.land = LAND_SEC;
  }
  if (prev.player.vy >= 0 && next.player.vy < 0 && next.player.on === null) {
    const p = next.platforms.find((q) => q.kind === 'bounce' && Math.abs(q.y - feet) < 0.3);
    if (p) {
      fx.springs.set(p.n, SPRING_SEC);
      burst(fx, 'star', cx, feet, reduced);
      a.land = LAND_SEC;
    }
  }
  if (next.hurt > prev.hurt) { // 受傷 = hurt 被重設(同一步扣命又撿愛心時生命淨值不變,不能看生命增減)
    fx.hurtFlash = HURT_FLASH;
    if (!reduced) fx.shake = 0.3;
    burst(fx, 'spark', cx, next.player.y + PLAYER / 2, reduced);
  }
  if (next.picked) {
    burst(fx, ['heal', 'full'].includes(next.picked) ? 'heart' : 'star', cx, next.player.y + 0.2, reduced);
    const texts = { heal: '+1', full: '已滿', coin: '金幣 +1', star: '無敵 6 秒', shield: '護盾！', cloud: '乘雲駕霧！' };
    fx.texts.push({ text: texts[next.picked], x: cx, y: next.player.y - 0.5, life: 0.9, max: 0.9 });
  }
  if (next.stomps > prev.stomps) {
    burst(fx, 'star', cx, feet, reduced);
    fx.texts.push({ text: '踩敵 +5', x: cx, y: next.player.y - .5, life: .9, max: .9 });
  }
  if ((next.cloudSerial ?? 0) > (prev.cloudSerial ?? 0)) burst(fx, 'dust', cx, feet, reduced); // 駕雲結束生雲接住
  if (next.stageCleared && !prev.stageCleared) burst(fx, 'star', cx, feet, reduced);
  for (const p of prev.platforms) {
    if (p.kind === 'flip' && p.flip !== null && p.y > -0.5 && !next.platforms.some((q) => q.n === p.n)) {
      fx.ghosts.push({ x: p.x, y: p.y, w: p.w, vy: 0, rot: 0.25, life: 0.6 });
    }
  }
  if (next.over && !prev.over && !next.won) {
    const fell = next.player.y > H;
    fx.ending = { t: 0, kind: fell ? 'fall' : 'ko', x: next.player.x, y: Math.min(next.player.y, H - PLAYER) };
    if (fell) burst(fx, 'dust', cx, H - 0.1, reduced);
  }
}

// 每張畫面推進特效。scroll = 平台這段時間上移的速度(粒子跟著場景走)。
export function fxUpdate(fx, dt, scroll = 0) {
  const a = fx.anim;
  a.t += dt;
  if (a.moving) a.phase += dt * 14;
  a.land = Math.max(0, a.land - dt);
  for (const p of fx.particles) {
    p.x += p.vx * dt;
    p.y += (p.vy - (p.kind === 'dust' ? scroll : 0)) * dt;
    p.vy += BURST[p.kind].grav * dt;
    p.life -= dt;
  }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  for (const t of fx.texts) {
    t.y -= 0.8 * dt;
    t.life -= dt;
  }
  fx.texts = fx.texts.filter((t) => t.life > 0);
  for (const g of fx.ghosts) {
    g.vy += 20 * dt;
    g.y += g.vy * dt;
    g.rot += 3 * dt;
    g.life -= dt;
  }
  fx.ghosts = fx.ghosts.filter((g) => g.life > 0);
  for (const [n, left] of fx.springs) {
    if (left - dt <= 0) fx.springs.delete(n);
    else fx.springs.set(n, left - dt);
  }
  fx.shake = Math.max(0, fx.shake - dt);
  fx.hurtFlash = Math.max(0, fx.hurtFlash - dt);
  if (fx.ending) fx.ending.t += dt;
  if (fx.banner) { fx.banner.life -= dt; if (fx.banner.life <= 0) fx.banner = null; }
  if (fx.show) {
    fx.show.t += dt;
    while (fx.show.shells.length && fx.show.shells[0].at <= fx.show.t) explode(fx, fx.show.shells.shift());
  }
  for (const p of fx.sparks) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 1 - 1.6 * dt; p.vy = p.vy * (1 - 1.6 * dt) + 2.2 * dt; // 空氣阻力+微重力
    p.life -= dt;
  }
  fx.sparks = fx.sparks.filter((p) => p.life > 0);
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

export function heartPath(c, cx, cy, r) {
  c.beginPath();
  c.moveTo(cx, cy + r * 0.9);
  c.bezierCurveTo(cx - r * 1.35, cy + r * 0.05, cx - r * 0.95, cy - r, cx, cy - r * 0.38);
  c.bezierCurveTo(cx + r * 0.95, cy - r, cx + r * 1.35, cy + r * 0.05, cx, cy + r * 0.9);
  c.closePath();
}

// ---- 背景:高塔內部(遠景石磚牆+拱窗慢捲、近景石柱+壁燈快捲)----

const BRICK_H = 0.7;
const BRICK_W = 1.5;
const WIN_EVERY = 7; // 每幾排磚一扇窗

function drawWindow(c, pal, x, y, night) {
  const w = 1.3;
  const h = 1.9;
  c.fillStyle = pal['win-frame'];
  c.beginPath(); // 拱形窗框
  c.moveTo(x - 0.08, y + h + 0.08);
  c.lineTo(x - 0.08, y + w / 2);
  c.arc(x + w / 2, y + w / 2, w / 2 + 0.08, Math.PI, 0);
  c.lineTo(x + w + 0.08, y + h + 0.08);
  c.closePath();
  c.fill();
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, pal['win-sky-a']);
  g.addColorStop(1, pal['win-sky-b']);
  c.fillStyle = g;
  c.beginPath(); // 窗內天空
  c.moveTo(x, y + h);
  c.lineTo(x, y + w / 2);
  c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
  c.lineTo(x + w, y + h);
  c.closePath();
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = pal['win-light'];
  if (night) { // 夜:月亮+星星
    circle(c, x + w * 0.68, y + 0.55, 0.2);
    c.fill();
    for (const [sx, sy] of [[0.25, 0.5], [0.5, 1.1], [0.95, 1.4], [0.3, 1.55]]) {
      circle(c, x + sx, y + sy, 0.03);
      c.fill();
    }
  } else { // 日:窗外遠方的雲
    c.globalAlpha = 0.85;
    for (const [dx, dy, r] of [[0.35, 1.25, 0.22], [0.6, 1.15, 0.28], [0.9, 1.27, 0.2]]) {
      circle(c, x + dx, y + dy, r);
      c.fill();
    }
    c.globalAlpha = 1;
  }
  c.restore();
  c.strokeStyle = pal['win-frame']; // 窗櫺
  c.lineWidth = 0.07;
  c.beginPath();
  c.moveTo(x + w / 2, y);
  c.lineTo(x + w / 2, y + h);
  c.moveTo(x, y + h * 0.58);
  c.lineTo(x + w, y + h * 0.58);
  c.stroke();
}

function drawTorch(c, pal, x, y, t, reduced) {
  const flick = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 13 + x * 7) * Math.sin(t * 7.3 + y);
  const L = layersFor(c, pal);
  const r = 1.6 * flick;
  if (L) {
    c.drawImage(L.glow, x - r, y - 0.25 - r, r * 2, r * 2);
  } else {
    const g = c.createRadialGradient(x, y - 0.25, 0.05, x, y - 0.25, r);
    g.addColorStop(0, pal.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - 1.7, y - 1.9, 3.4, 3.4);
  }
  c.fillStyle = pal.beam; // 支架
  c.fillRect(x - 0.05, y - 0.05, 0.1, 0.45);
  roundRect(c, x - 0.15, y - 0.12, 0.3, 0.12, 0.04);
  c.fill();
  c.fillStyle = pal.flame; // 火焰
  c.beginPath();
  c.moveTo(x - 0.12, y - 0.12);
  c.quadraticCurveTo(x - 0.1, y - 0.4 * flick, x, y - 0.55 * flick);
  c.quadraticCurveTo(x + 0.1, y - 0.4 * flick, x + 0.12, y - 0.12);
  c.closePath();
  c.fill();
  c.fillStyle = pal['win-light'];
  circle(c, x, y - 0.22, 0.05);
  c.fill();
}

// 遠景牆:從 y0 起畫 count 排磚(排號依週期取樣,磚深淺、窗位都固定),平塗兩色磚+少量斑點、底邊一道暗線;每 WIN_EVERY 排一扇拱窗(左右交替)
const FAR_ROWS = WIN_EVERY * 2;
const FAR_PERIOD = FAR_ROWS * BRICK_H;
function paintFar(c, pal, firstRow, count, y0) {
  const wins = [];
  for (let i = 0; i < count; i++) {
    const r = (((firstRow + i) % FAR_ROWS) + FAR_ROWS) % FAR_ROWS;
    const y = y0 + i * BRICK_H;
    const shift = r % 2 ? BRICK_W / 2 : 0;
    for (let x = -shift, col = 0; x < W; x += BRICK_W, col++) {
      const h = hash(r, col);
      c.fillStyle = h < 0.5 ? pal['brick-a'] : pal['brick-b'];
      c.fillRect(x + 0.04, y + 0.04, BRICK_W - 0.08, BRICK_H - 0.08);
      c.fillStyle = pal['brick-spot'];
      c.fillRect(x + 0.04, y + BRICK_H - 0.1, BRICK_W - 0.08, 0.06);
      if (h < 0.35) {
        circle(c, x + 0.3 + h * 2, y + 0.25, 0.04);
        c.fill();
        circle(c, x + 0.5 + h * 1.5, y + 0.4, 0.025);
        c.fill();
      }
    }
    if (r % WIN_EVERY === 0) wins.push([(r / WIN_EVERY) % 2 ? 5.9 : 1.6, y + 0.35]);
  }
  for (const [x, y] of wins) drawWindow(c, pal, x, y, pal.night === '1');
}

// ---- 快取圖層:遠景牆、壁燈光暈、頂刺都是靜態的,預先畫好,每張畫面只貼圖 ----
// 依畫布縮放倍率分開存(遊戲場地與說明示範的倍率不同);換色票(切深淺色)就重畫。無 OffscreenCanvas(如測試環境)時直接畫。
const layers = new Map();
function layersFor(c, pal) {
  const scale = typeof OffscreenCanvas === 'function' ? c.getTransform?.()?.a : 0;
  if (!scale) return null;
  const key = Math.round(scale * 100);
  const hit = layers.get(key);
  if (hit && hit.pal === pal) return hit;
  const make = (w, h, paint) => {
    const cv = new OffscreenCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    const g = cv.getContext('2d');
    g.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
    paint(g);
    return cv;
  };
  const out = {
    pal,
    far: make(W, FAR_PERIOD, (g) => {
      g.fillStyle = pal['wall-bot']; // 磚縫
      g.fillRect(0, 0, W, FAR_PERIOD);
      if (pal.theme && pal.theme !== 'tower') paintThemeFar(g, pal);
      else paintFar(g, pal, 0, FAR_ROWS, 0);
    }),
    glow: make(3.2, 3.2, (g) => {
      const r = g.createRadialGradient(1.6, 1.6, 0.05, 1.6, 1.6, 1.6);
      r.addColorStop(0, pal.glow);
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 3.2, 3.2);
    }),
    ceil: make(W, CEIL_SPRITE_H, (g) => paintCeiling(g, pal, false)),
    ceilRed: make(W, CEIL_SPRITE_H, (g) => paintCeiling(g, pal, true)),
  };
  layers.set(key, out);
  return out;
}

// 壁燈位置(近景 0.7 倍速);背景畫燈、角色算受光都用這份
const TORCH_GAP = 5;
function torches(scroll) {
  const near = scroll * 0.7;
  const out = [];
  for (let k = Math.floor(near / TORCH_GAP); k * TORCH_GAP - near < H + 1; k++) {
    out.push({ x: k % 2 ? 0.75 : W - 0.75, y: k * TORCH_GAP - near + 2.5 });
  }
  return out;
}

// 共用描邊:場景物件(角色、平台、愛心、窗框)都用同一種深色細邊,畫風才一致
function ink(c, pal, w = 0.035) {
  c.strokeStyle = pal.ink;
  c.lineWidth = w;
  c.stroke();
}

function drawBackground(c, pal, scroll, t, reduced) {
  if (pal.theme && pal.theme !== 'tower') {
    const far = scroll * .3;
    const L = layersFor(c, pal);
    c.fillStyle = pal['wall-bot'];
    c.fillRect(0, 0, W, H);
    for (let y = -(far % FAR_PERIOD); y < H; y += FAR_PERIOD) {
      if (L) c.drawImage(L.far, 0, y, W, FAR_PERIOD);
      else { c.save(); c.translate(0, y); paintThemeFar(c, pal); c.restore(); }
    }
    return;
  }
  c.fillStyle = pal['wall-bot']; // 磚縫
  c.fillRect(-1, -1, W + 2, H + 2);

  // 遠景:石磚牆+拱窗(0.3 倍速);圖樣以 FAR_ROWS 排為週期,快取成一張圖貼上
  const far = scroll * 0.3;
  const L = layersFor(c, pal);
  if (L) {
    for (let y = -(far % FAR_PERIOD); y < H; y += FAR_PERIOD) c.drawImage(L.far, 0, y, W, FAR_PERIOD);
  } else {
    const first = Math.floor(far / BRICK_H);
    paintFar(c, pal, first, Math.ceil(H / BRICK_H) + 2, first * BRICK_H - far);
  }
  // 兩側稍暗(景深)
  const v = c.createLinearGradient(0, 0, W, 0);
  v.addColorStop(0, 'rgba(0,0,0,0.16)');
  v.addColorStop(0.16, 'rgba(0,0,0,0)');
  v.addColorStop(0.84, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.16)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);

  // 近景:左右石柱(平塗+一道亮面+描邊)+壁燈(0.7 倍速)
  const near = scroll * 0.7;
  for (const x0 of [0, W - 0.42]) {
    c.fillStyle = pal.pillar;
    c.fillRect(x0, 0, 0.42, H);
    c.fillStyle = pal['pillar-hi'];
    c.fillRect(x0 + 0.1, 0, 0.1, H);
    c.fillStyle = pal.ink;
    c.fillRect(x0 === 0 ? 0.4 : x0, 0, 0.025, H);
    const SEG = 1.4;
    for (let y = -(near % SEG); y < H; y += SEG) c.fillRect(x0, y, 0.42, 0.035); // 石柱接縫
  }
  for (const tr of torches(scroll)) drawTorch(c, pal, tr.x, tr.y, t, reduced);
}

// 每個場景是同一趟探險的環境，靜態週期圖層沿用既有快取。
function paintThemeFar(c, pal) {
  c.fillStyle = pal['wall-bot'];
  c.fillRect(0, 0, W, FAR_PERIOD);
  const scene = pal[`${pal.theme}-scenery`];
  for (let i = 0; i < 6; i++) {
    const x = i % 2 ? 6.4 : .5;
    const y = .7 + Math.floor(i / 2) * 3;
    c.fillStyle = scene;
    if (pal.theme === 'forest') {
      c.fillRect(x + .6, y + .5, .18, 2.2);
      for (const [dx, dy, r] of [[.1, .5, .55], [.7, 0, .65], [1.3, .5, .55]]) { circle(c, x + dx, y + dy, r); c.fill(); }
      c.strokeStyle = pal['wood-dark']; c.lineWidth = .04;
      c.beginPath(); c.moveTo(x + .68, y + 2.4); c.lineTo(x + .68, y + .8); c.stroke();
    } else if (pal.theme === 'cave') {
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 1.5, y - .2); c.lineTo(x + 1.1, y + 1.8); c.lineTo(x + .3, y + 1.4); c.closePath(); c.fill();
      c.strokeStyle = pal['wood-hi']; c.lineWidth = .03;
      c.beginPath(); c.moveTo(x + .2, y + .5); c.lineTo(x + .8, y + .1); c.lineTo(x + 1.2, y + .7); c.stroke();
    } else if (pal.theme === 'ice') {
      c.beginPath(); c.moveTo(x - .6, y + 1.6); c.lineTo(x + .6, y - .4); c.lineTo(x + 2, y + 1.6); c.closePath(); c.fill();
      c.fillStyle = pal['wood-hi']; c.beginPath(); c.moveTo(x + .6, y - .4); c.lineTo(x + .1, y + .45); c.lineTo(x + .7, y + .2); c.lineTo(x + 1.15, y + .4); c.closePath(); c.fill();
      for (let k = 0; k < 5; k++) { circle(c, x + k * .35, y + 2, .025); c.fill(); }
    } else if (pal.theme === 'factory') {
      c.strokeStyle = scene; c.lineWidth = .2;
      c.beginPath(); c.moveTo(x, y - 1); c.lineTo(x, y + 1); c.lineTo(x + 1.3, y + 1); c.lineTo(x + 1.3, y + 2); c.stroke();
      gearPath(c, x + .7, y + .3, .5); c.fillStyle = scene; c.fill();
      circle(c, x + .7, y + .3, .17); c.fillStyle = pal['wall-bot']; c.fill();
    } else if (pal.theme === 'sky') {
      cloudPath(c, x, y, 2.3, .65); c.fill();
      c.strokeStyle = pal['wood-hi']; c.lineWidth = .025; c.stroke();
    }
  }
}

function gearPath(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 32; i++) {
    const a = i * Math.PI / 16;
    const rr = i % 4 < 2 ? r : r * .77;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

function cloudPath(c, x, y, w, h) {
  c.beginPath();
  c.moveTo(x + .15, y + h);
  c.bezierCurveTo(x - .25, y + h * .3, x + w * .15, y, x + w * .3, y + h * .35);
  c.bezierCurveTo(x + w * .3, y - h * .45, x + w * .75, y - h * .45, x + w * .75, y + h * .3);
  c.bezierCurveTo(x + w * 1.1, y, x + w * 1.12, y + h, x + w - .15, y + h);
  c.closePath();
}

// ---- 平台:四種形狀、顏色都不同;一律平塗+上亮下暗+描邊 ----

function plank(c, pal, x, y, w, h, base, hi, dark) {
  roundRect(c, x, y, w, h, 0.07);
  c.fillStyle = base;
  c.fill();
  c.fillStyle = hi;
  c.fillRect(x + 0.06, y + 0.02, w - 0.12, 0.06);
  c.fillStyle = dark;
  c.fillRect(x + 0.06, y + h - 0.07, w - 0.12, 0.06);
  roundRect(c, x, y, w, h, 0.07);
  ink(c, pal);
}

// 普通:暖色木板+木紋+兩端釘子
function drawNormal(c, p, pal) {
  plank(c, pal, p.x, p.y, p.w, THICK, pal.wood, pal['wood-hi'], pal['wood-dark']);
  c.strokeStyle = pal['wood-dark'];
  c.lineWidth = 0.025;
  c.beginPath();
  for (let i = 0; i < p.w; i += 1) {
    c.moveTo(p.x + i + 0.2, p.y + 0.15);
    c.bezierCurveTo(p.x + i + 0.4, p.y + 0.11, p.x + i + 0.6, p.y + 0.19, p.x + i + 0.8, p.y + 0.14);
    if (i > 0) {
      c.moveTo(p.x + i, p.y + 0.07);
      c.lineTo(p.x + i, p.y + THICK - 0.06);
    }
  }
  c.stroke();
  c.fillStyle = pal['iron-dark'];
  for (const nx of [p.x + 0.14, p.x + p.w - 0.14]) {
    circle(c, nx, p.y + 0.15, 0.035);
    c.fill();
  }
}

// 鐵刺:左亮面、右暗面、中脊反光、刺尖亮點,描邊;redTip = 刺尖染紅(危險)
function ironSpike(c, pal, x0, x1, base, tip, redTip) {
  const mid = (x0 + x1) / 2;
  c.fillStyle = pal['iron-hi'];
  c.beginPath();
  c.moveTo(x0, base);
  c.lineTo(mid, tip);
  c.lineTo(mid, base);
  c.fill();
  c.fillStyle = pal['iron-dark'];
  c.beginPath();
  c.moveTo(mid, base);
  c.lineTo(mid, tip);
  c.lineTo(x1, base);
  c.fill();
  if (redTip) {
    const k = 0.38;
    c.fillStyle = pal.spike;
    c.beginPath();
    c.moveTo(mid - (mid - x0) * k, tip + (base - tip) * k);
    c.lineTo(mid, tip);
    c.lineTo(mid + (x1 - mid) * k, tip + (base - tip) * k);
    c.fill();
  }
  c.strokeStyle = pal.glint; // 中脊反光
  c.lineWidth = 0.018;
  c.beginPath();
  c.moveTo(mid - 0.01, base);
  c.lineTo(mid - 0.01, tip + (base - tip) * 0.12);
  c.stroke();
  c.beginPath();
  c.moveTo(x0, base);
  c.lineTo(mid, tip);
  c.lineTo(x1, base);
  ink(c, pal, 0.025);
}

// 刺:中世紀陷阱——生鏽鐵板(鉚釘、鏽斑)+一排紅尖鐵刺
function drawSpike(c, p, pal) {
  const base = p.y + 0.06;
  const h = THICK - 0.04;
  roundRect(c, p.x, base, p.w, h, 0.05);
  c.fillStyle = pal.rust;
  c.fill();
  c.fillStyle = pal['rust-dark'];
  c.fillRect(p.x + 0.05, base + h - 0.07, p.w - 0.1, 0.06);
  c.fillStyle = pal['rust-spot'];
  for (let x = p.x + 0.35; x < p.x + p.w - 0.2; x += 0.9) {
    c.beginPath();
    c.ellipse(x, base + 0.1, 0.12, 0.04, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = pal['iron-hi'];
  for (const rx of [p.x + 0.12, p.x + p.w - 0.12]) {
    circle(c, rx, base + h / 2, 0.035);
    c.fill();
  }
  roundRect(c, p.x, base, p.w, h, 0.05);
  ink(c, pal);
  const n = Math.round(p.w * 2.5);
  const step = p.w / n;
  for (let i = 0; i < n; i++) ironSpike(c, pal, p.x + i * step, p.x + (i + 1) * step, base, p.y - 0.36, true);
}

// 彈跳:綠色果凍軟墊+底下兩支大彈簧,踩下壓縮回彈
function drawBounce(c, p, pal, left) {
  const k = left === undefined ? 0 : left > SPRING_SEC * 2 / 3 ? (SPRING_SEC - left) / (SPRING_SEC / 3) : left / (SPRING_SEC * 2 / 3);
  const sq = clamp(k, 0, 1);
  const padH = 0.3 - 0.1 * sq;
  const padY = p.y + 0.1 * sq;
  const baseY = p.y + 0.72;
  c.fillStyle = pal['iron-dark'];
  roundRect(c, p.x + 0.12, baseY - 0.08, p.w - 0.24, 0.1, 0.04);
  c.fill();
  ink(c, pal, 0.025);
  c.strokeStyle = pal.coil;
  c.lineWidth = 0.09;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  for (const fx of [0.25, 0.75]) {
    const cx = p.x + p.w * fx;
    const top = padY + padH - 0.02;
    const bot = baseY - 0.08;
    c.beginPath();
    const zig = 5;
    for (let i = 0; i <= zig; i++) {
      const y = top + ((bot - top) * i) / zig;
      c.lineTo(cx + (i === 0 || i === zig ? 0 : i % 2 ? 0.2 : -0.2), y);
    }
    c.stroke();
  }
  const grow = 0.08 * sq; // 被壓時往兩側鼓起
  roundRect(c, p.x - grow, padY, p.w + grow * 2, padH, 0.13);
  const g = c.createLinearGradient(0, padY, 0, padY + padH);
  g.addColorStop(0, pal['bounce-hi']);
  g.addColorStop(0.45, pal.bounce);
  g.addColorStop(1, pal['bounce-dark']);
  c.fillStyle = g;
  c.fill();
  ink(c, pal);
  c.fillStyle = 'rgba(255,255,255,0.45)'; // 果凍高光
  c.beginPath();
  c.ellipse(p.x + 0.45, padY + 0.07, 0.25, 0.035, 0, 0, Math.PI * 2);
  c.fill();
}

// 翻轉:灰色舊木板+中間鐵轉軸+裂紋;踩上抖動並往一側傾斜,消失時繞轉軸翻落
function drawFlipBoard(c, pal, w, cracked) {
  plank(c, pal, -w / 2, -THICK / 2, w, THICK, pal.old, pal['old-hi'], pal['old-dark']);
  if (cracked) {
    c.strokeStyle = pal['old-dark'];
    c.lineWidth = 0.035;
    c.beginPath();
    for (const fx of [-0.3, 0.28]) {
      const x = w * fx;
      c.moveTo(x - 0.12, -THICK / 2);
      c.lineTo(x + 0.04, -0.02);
      c.lineTo(x - 0.06, 0.05);
      c.lineTo(x + 0.08, THICK / 2);
    }
    c.stroke();
  }
  c.fillStyle = pal.axle; // 轉軸支架與軸心
  c.fillRect(-0.05, -THICK / 2, 0.1, THICK);
  circle(c, 0, 0, 0.11);
  c.fill();
  ink(c, pal, 0.025);
  c.fillStyle = pal['iron-hi'];
  circle(c, 0, 0, 0.045);
  c.fill();
}

function drawFlip(c, p, pal, reduced) {
  const t = p.flip;
  const shake = t === null || reduced ? 0 : Math.sin(t * 70) * 0.05 * (0.4 + t / FLIP_DELAY);
  const tilt = t === null ? 0 : (t / FLIP_DELAY) * 0.12;
  c.save();
  c.translate(p.x + p.w / 2 + shake, p.y + THICK / 2);
  c.rotate(tilt);
  drawFlipBoard(c, pal, p.w, true);
  c.restore();
}

function drawHeartItem(c, p, pal, t) {
  const b = heartBox(p);
  const bob = Math.sin(t * 4 + p.n) * 0.05;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2 + bob;
  c.fillStyle = pal.halo;
  circle(c, cx, cy, b.w * 0.66);
  c.fill();
  heartPath(c, cx, cy, b.w / 2);
  c.fillStyle = pal.heart;
  c.fill();
  ink(c, pal);
  c.fillStyle = 'rgba(255,255,255,0.75)';
  circle(c, cx - b.w * 0.17, cy - b.w * 0.12, b.w * 0.08);
  c.fill();
}

function drawPlatforms(c, s, pal, fx, t, reduced) {
  for (const p of s.platforms) {
    if (p.y > H + 0.5) continue;
    c.globalAlpha = p.flip === null ? 1 : Math.max(0.45, 1 - (p.flip / FLIP_DELAY) * 0.5);
    if (p.kind === 'spike') drawSpike(c, p, pal);
    else if (p.kind === 'bounce') drawBounce(c, p, pal, fx?.springs.get(p.n));
    else if (p.kind === 'flip') drawFlip(c, p, pal, reduced);
    else if (p.kind === 'ice') {
      plank(c, pal, p.x, p.y, p.w, THICK, pal['ice-board'], pal['ice-hi'], pal['ice-dark']);
      c.strokeStyle = pal['ice-hi']; c.lineWidth = .06;
      c.beginPath();
      for (let dx = .3; dx < p.w; dx += .7) { c.moveTo(p.x + dx, p.y + .05); c.lineTo(p.x + dx + .2, p.y + .22); }
      c.stroke();
      for (let dx = .4; dx < p.w; dx += .8) ironSpike(c, { ...pal, 'iron-hi': pal['ice-hi'], 'iron-dark': pal['ice-dark'] }, p.x + dx, p.x + dx + .25, p.y + THICK, p.y + .6, false);
    }
    else if (p.kind === 'moving') {
      drawNormal(c, p, pal);
      for (const dx of [.4, p.w - .4]) {
        circle(c, p.x + dx, p.y + .4, .17); c.fillStyle = pal.iron; c.fill(); ink(c, pal);
        circle(c, p.x + dx, p.y + .4, .06); c.fillStyle = pal.glint; c.fill();
      }
      c.strokeStyle = pal['wood-dark']; c.lineWidth = .06;
      c.beginPath();
      for (const dx of [.8, p.w - .8]) { c.moveTo(p.x + dx, p.y + .08); c.lineTo(p.x + dx + (dx < 1 ? -.15 : .15), p.y + .15); c.lineTo(p.x + dx, p.y + .22); }
      c.stroke();
    }
    else drawNormal(c, p, pal);
    c.globalAlpha = 1;
    if (p.item === 'heart') drawHeartItem(c, p, pal, reduced ? 0 : t);
    else if (p.item) drawTreasure(c, p, pal);
    if (p.enemy) drawEnemy(c, p, pal);
    if (p.flag && s.mode !== 'adventure') drawFlag(c, p, pal);
  }
  for (const p of s.clouds ?? []) {
    c.globalAlpha = Math.min(1, p.life / .4);
    cloudPath(c, p.x, p.y - .12, p.w, .32);
    c.fillStyle = pal.cloud; c.fill(); ink(c, pal);
    c.globalAlpha = 1;
  }
  for (const g of fx?.ghosts ?? []) { // 翻落:繞轉軸翻轉往下掉、淡出
    c.save();
    c.globalAlpha = clamp(g.life / 0.6, 0, 1) * 0.85;
    c.translate(g.x + g.w / 2, g.y + THICK / 2);
    c.rotate(g.rot);
    drawFlipBoard(c, pal, g.w, true);
    c.restore();
  }
}

function starPath(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * .45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}
function shieldPath(c, x, y, r) {
  c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y - r);
  c.quadraticCurveTo(x + r, y + r * .6, x, y + r);
  c.quadraticCurveTo(x - r, y + r * .6, x - r, y - r); c.closePath();
}
function drawTreasure(c, p, pal) {
  const b = heartBox(p);
  const x = b.x + b.w / 2, y = b.y + b.h / 2;
  c.fillStyle = pal[p.item];
  if (p.item === 'coin') {
    c.beginPath(); c.ellipse(x, y, .22, .3, 0, 0, Math.PI * 2); c.fill(); ink(c, pal);
    c.strokeStyle = pal['wood-dark']; c.lineWidth = .035;
    c.beginPath(); c.ellipse(x, y, .14, .22, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(x, y - .12); c.lineTo(x, y + .12); c.stroke();
  } else if (p.item === 'star') {
    starPath(c, x, y, .32); c.fill(); ink(c, pal);
  } else if (p.item === 'shield') {
    shieldPath(c, x, y, .27); c.fill(); ink(c, pal);
    c.strokeStyle = pal.glint; c.lineWidth = .045;
    c.beginPath(); c.moveTo(x, y - .18); c.lineTo(x, y + .15); c.moveTo(x - .13, y - .05); c.lineTo(x + .13, y - .05); c.stroke();
  } else if (p.item === 'cloud') {
    cloudPath(c, b.x + .05, b.y + .12, b.w - .1, .3); c.fill(); ink(c, pal);
    c.strokeStyle = pal['sky-dark']; c.lineWidth = .04;
    c.beginPath(); c.moveTo(b.x, b.y + .5); c.lineTo(b.x + .2, b.y + .5); c.moveTo(b.x + .4, b.y + .55); c.lineTo(b.x + .65, b.y + .55); c.stroke();
  }
  c.fillStyle = pal.glint;
  circle(c, x - .08, y - .12, .04); c.fill();
}
function drawEnemy(c, p, pal) {
  const b = enemyBox(p), cx = b.x + b.w / 2;
  c.strokeStyle = pal.ink; c.lineWidth = .05;
  c.beginPath(); c.moveTo(cx - .15, b.y + .2); c.lineTo(cx - .22, b.y + .04); c.moveTo(cx + .15, b.y + .2); c.lineTo(cx + .22, b.y + .04); c.stroke();
  c.beginPath(); c.ellipse(cx, b.y + b.h * .62, b.w / 2, b.h * .38, 0, 0, Math.PI * 2);
  c.fillStyle = pal.enemy; c.fill(); ink(c, pal);
  c.fillStyle = pal['enemy-hi']; circle(c, cx - .12, b.y + .28, .08); c.fill();
  for (const dx of [-.13, .13]) {
    circle(c, cx + dx, b.y + .33, .075); c.fillStyle = pal.glint; c.fill();
    circle(c, cx + dx + p.enemy.dir * .025, b.y + .34, .035); c.fillStyle = pal.eye; c.fill();
  }
  c.strokeStyle = pal.eye; c.lineWidth = .025;
  c.beginPath(); c.arc(cx, b.y + .44, .06, 0, Math.PI); c.stroke();
  for (const dx of [-.2, .2]) { circle(c, cx + dx, p.y - .035, .07); c.fillStyle = pal['wood-dark']; c.fill(); ink(c, pal); }
}
function drawFlag(c, p, pal, scale = 1) {
  const x = p.x + p.w / 2;
  if (scale !== 1) { // 以旗桿底為中心放大
    c.save(); c.translate(x, p.y); c.scale(scale, scale); c.translate(-x, -p.y);
    drawFlag(c, p, pal); c.restore(); return;
  }
  c.strokeStyle = pal.iron; c.lineWidth = .06;
  c.beginPath(); c.moveTo(x, p.y); c.lineTo(x, p.y - 1.6); c.stroke();
  c.beginPath(); c.moveTo(x, p.y - 1.5); c.lineTo(x + .85, p.y - 1.2); c.lineTo(x, p.y - .9); c.closePath();
  c.fillStyle = pal.flag; c.fill(); ink(c, pal);
  starPath(c, x + .27, p.y - 1.2, .12); c.fillStyle = pal.star; c.fill();
  circle(c, x, p.y - 1.62, .09); c.fillStyle = pal.coin; c.fill(); ink(c, pal);
}


// ---- RS39 終點標示:旗子(層數/旗子關)、出口光門(存活關)、金幣光暈+方向指示(收集關)----
// 都畫在「規範座標」(往下的方向);第 5 關由 drawScene 整個翻轉,所以「底部」自動變成畫面頂部。

// 只翻字不翻位置(第 5 關畫面翻轉時字仍是正的)。
function uprightText(c, text, x, y, reversed, { size = 0.42, fill, stroke }) {
  c.save();
  c.translate(x, y);
  if (reversed) c.scale(1, -1);
  c.font = `bold ${size}px system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = size * 0.2; c.lineJoin = 'round';
  c.strokeStyle = stroke; c.strokeText(text, 0, 0);
  c.fillStyle = fill; c.fillText(text, 0, 0);
  c.restore();
}

function glow(c, x, y, r, color, alpha) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.save();
  c.globalAlpha = clamp(alpha, 0, 1);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
}

// 出口光門:石框拱門+發光門洞;rise 0~1 由畫面底部升起。在平台之前畫(不擋平台)。
function drawPortal(c, m, pal, t, reduced, reversed) {
  const w = 3, h = 3.4, x = (W - w) / 2;
  const top = H - h * m.rise + 0.1;
  const r = w / 2;
  const arch = (inset) => {
    c.beginPath();
    c.moveTo(x + inset, H + 1);
    c.lineTo(x + inset, top + r);
    c.arc(x + r, top + r, r - inset, Math.PI, 0);
    c.lineTo(x + w - inset, H + 1);
    c.closePath();
  };
  c.save();
  glow(c, x + r, top + r, 2.6, pal.warn, 0.35 + 0.4 * m.rise);
  arch(0); c.fillStyle = pal.iron; c.fill(); ink(c, pal, 0.05);
  arch(0.32);
  const g = c.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, pal.glint); g.addColorStop(0.5, pal.star); g.addColorStop(1, pal.warn);
  c.fillStyle = g; c.fill();
  // 門洞裡的光紋:reduced 時固定不動
  c.clip();
  c.strokeStyle = pal.glint; c.lineWidth = 0.08; c.globalAlpha = 0.7;
  const off = reduced ? 0 : (t * 1.2) % 0.8;
  c.beginPath();
  for (let yy = top + off; yy < H + 1; yy += 0.8) { c.moveTo(x, yy + 0.4); c.quadraticCurveTo(x + r, yy - 0.2, x + w, yy + 0.4); }
  c.stroke();
  c.restore();
  // 拱頂石+門上的字
  starPath(c, x + r, top + 0.16, 0.24); c.fillStyle = pal.star; c.fill(); ink(c, pal);
  uprightText(c, `出口 ${m.remaining} 秒`, x + r, top - 0.45, reversed, { size: 0.42, fill: pal.text, stroke: pal.hud });
}

// 終點旗(層數/旗子關):進畫面後隨距離變大、變亮;還沒進畫面就在底部邊緣顯示小旗+剩餘層數。
function drawGoalFlag(c, s, m, pal, t, reduced, reversed) {
  const p = s.platforms.find((q) => q.n === m.n);
  if (p && p.y <= H + 0.5) {
    const near = clamp(1 - (p.y - (s.player.y + PLAYER)) / (H - CEIL), 0, 1); // 1 = 就在腳下
    glow(c, p.x + p.w / 2, p.y - 0.9, 1.6 + near, pal.warn, 0.25 + 0.55 * near);
    const scale = 1 + 0.45 * near + (reduced ? 0 : 0.04 * Math.sin(t * 6));
    drawFlag(c, p, pal, scale);
    uprightText(c, '終點', p.x + p.w / 2, p.y + 0.75, reversed, { size: 0.38, fill: pal.text, stroke: pal.hud });
    return;
  }
  // 終點還在下方、畫面外(含已生成但還在底部之下)⇒ 邊緣小旗;已捲過頂端就不畫。接近(approach)前半透明,越近越清楚
  if (p ? p.y < 0 : m.n < s.nextN) return;
  // 放在角色的另一側,站在底部時不會被角色擋住
  const y = H - 0.15, x = s.player.x + PLAYER / 2 < W / 2 ? W - 2.05 : 2.05;
  c.save();
  c.globalAlpha = m.approach ? 1 : 0.6;
  c.fillStyle = pal.hud;
  roundRect(c, x - 1.6, y - 1.05, 3.2, 0.95, 0.3);
  drawFlag(c, { x: x - 1.45, y: y - 0.12, w: 0.5 }, pal, 0.55);
  // 往下的小箭頭:終點在這個方向
  c.fillStyle = pal.flag;
  const bob = reduced ? 0 : Math.abs(Math.sin(t * 4)) * 0.08;
  c.beginPath(); c.moveTo(x + 1.15, y - 0.3 + bob); c.lineTo(x + 0.95, y - 0.6 + bob); c.lineTo(x + 1.35, y - 0.6 + bob); c.closePath(); c.fill();
  uprightText(c, `還有 ${m.remaining} 層`, x + 0.05, y - 0.58, reversed, { size: 0.4, fill: pal.text, stroke: pal.hud });
  c.restore();
}

// 收集關最後 3 枚:每枚金幣加光暈;畫面邊緣一個箭頭指向最近的金幣。
function drawCoinGuide(c, s, m, pal, t, reduced, reversed) {
  const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 6);
  for (const p of s.platforms) {
    if (p.item !== 'coin' || p.y > H + 0.5) continue;
    const b = heartBox(p);
    glow(c, b.x + b.w / 2, b.y + b.h / 2, 1.1, pal.coin, 0.85 * pulse);
    c.strokeStyle = pal.warn; c.lineWidth = 0.06;
    circle(c, b.x + b.w / 2, b.y + b.h / 2, 0.48); c.stroke();
  }
  const coin = nearestCoin(s);
  if (!coin) return;
  const px = s.player.x + PLAYER / 2, py = s.player.y + PLAYER / 2;
  const dx = coin.x - px, dy = coin.y - py;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ux = dx / len, uy = dy / len;
  // 由玩家沿方向射到畫面邊框(內縮)的交點
  const box = { l: 0.55, r: W - 0.55, t: CEIL + 1.3, b: H - 0.55 };
  const ts = [ux > 0 ? (box.r - px) / ux : ux < 0 ? (box.l - px) / ux : Infinity, uy > 0 ? (box.b - py) / uy : uy < 0 ? (box.t - py) / uy : Infinity];
  const k = Math.max(0, Math.min(...ts));
  const ax = clamp(px + ux * k, box.l, box.r), ay = clamp(py + uy * k, box.t, box.b);
  c.save();
  c.translate(ax, ay);
  c.fillStyle = pal.hud;
  circle(c, 0, 0, 0.5); c.fill();
  c.rotate(Math.atan2(uy, ux));
  c.beginPath(); c.moveTo(0.42, 0); c.lineTo(-0.12, -0.3); c.lineTo(-0.12, 0.3); c.closePath();
  c.fillStyle = pal.coin; c.fill(); ink(c, pal, 0.05);
  c.restore();
  uprightText(c, `還差 ${m.remaining} 枚`, clamp(ax, 1.4, W - 1.4), ay + (ay > H / 2 ? -0.8 : 0.8), reversed, { size: 0.36, fill: pal.text, stroke: pal.hud });
}

// 過關演出(畫面座標,不翻轉):煙火粒子/靜態星芒、「過關！」大字。
function drawCelebration(c, s, fx, pal, reduced) {
  const max = s.celebrateMax || 1;
  const k = clamp(1 - s.celebrate / max, 0, 1); // 0 → 1
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(0, 0, W, H);
  if (reduced || !fx) { // 靜態星芒:固定位置、不閃爍
    const spots = [[1.6, 3.2, 0.5, 'warn'], [7.3, 2.8, 0.42, 'shield'], [2.4, 11.2, 0.38, 'heart'], [6.8, 11.8, 0.46, 'star'], [4.5, 1.9, 0.3, 'bounce-hi']];
    for (const [x, y, r, col] of spots) {
      c.strokeStyle = pal[col]; c.lineWidth = 0.07;
      c.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35); c.lineTo(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.6); }
      c.stroke();
      starPath(c, x, y, r); c.fillStyle = pal[col]; c.fill(); ink(c, pal, 0.04);
    }
  } else {
    for (const p of fx.sparks) {
      c.globalAlpha = clamp(p.life / p.max * 1.4, 0, 1);
      c.fillStyle = pal[p.color];
      circle(c, p.x, p.y, 0.09); c.fill();
    }
    c.globalAlpha = 1;
  }
  const text = s.won ? '全部通關！' : '過關！';
  const pop = reduced ? 1 : k < 0.15 ? 0.4 + 0.6 * (k / 0.15) * 1.15 : 1 + 0.03 * Math.sin(k * 30);
  c.translate(W / 2, H * 0.36);
  c.scale(pop, pop);
  c.font = `900 ${s.won ? 1.25 : 1.6}px system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = 0.32; c.strokeStyle = pal.ink; c.strokeText(text, 0, 0);
  c.fillStyle = pal.warn; c.fillText(text, 0, 0);
  if (s.won) {
    c.font = 'bold 0.5px system-ui, sans-serif';
    c.lineWidth = 0.14; c.strokeStyle = pal.hud; c.strokeText('六關全破，太厲害了！', 0, 1.15);
    c.fillStyle = pal.text; c.fillText('六關全破，太厲害了！', 0, 1.15);
  }
  c.restore();
  c.save();
  c.font = 'bold 0.36px system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 0.1; c.strokeStyle = pal.hud; c.strokeText('點畫面或按任意鍵略過', W / 2, H - 0.8);
  c.fillStyle = pal.text; c.fillText('點畫面或按任意鍵略過', W / 2, H - 0.8);
  c.restore();
}

// 最後階段大字(畫面座標):跳出後停留、淡出。
function drawBanner(c, b, pal, reduced) {
  const k = 1 - b.life / b.max; // 0 → 1
  const alpha = clamp(b.life / 0.4, 0, 1);
  const pop = reduced ? 1 : k < 0.12 ? 0.5 + 0.5 * (k / 0.12) * 1.1 : 1;
  c.save();
  c.globalAlpha = alpha;
  c.translate(W / 2, H * 0.3);
  c.scale(pop, pop);
  c.fillStyle = pal.hud;
  roundRect(c, -3.6, -0.85, 7.2, 1.7, 0.5);
  c.font = '900 1.05px system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = 0.22; c.strokeStyle = pal.ink; c.strokeText(b.text, 0, 0.04);
  c.fillStyle = pal.danger; c.fillText(b.text, 0, 0.04);
  c.restore();
}

// ---- 頂刺:鐵梁+鉚釘+雙面鋼刺(高光/陰影);玩家接近時頂端泛紅脈動 ----

function drawCeiling(c, s, pal, t, reduced) {
  const danger = clamp((3 - s.player.y) / (3 - CEIL), 0, 1);
  if (danger > 0) {
    const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 10);
    const g = c.createLinearGradient(0, 0, 0, 2.8);
    g.addColorStop(0, pal.danger);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = clamp((0.2 + 0.65 * danger) * pulse, 0, 1);
    c.fillStyle = g;
    c.fillRect(0, 0, W, 2.8);
    c.globalAlpha = 1;
  }
  const jitter = reduced ? 0 : Math.sin(t * 45) * 0.035 * danger;
  const red = danger > 0.5;
  const L = layersFor(c, pal);
  if (L) c.drawImage(red ? L.ceilRed : L.ceil, jitter, 0, W, CEIL_SPRITE_H);
  else paintCeiling(c, pal, red, jitter);
}

const CEIL_SPRITE_H = CEIL + 0.7;
// 鐵梁+投影+鐵刺(靜態部分;快取成圖層或直接畫)
function paintCeiling(c, pal, red, jitter = 0) {
  if (pal.theme) { paintThemeCeiling(c, pal, red, jitter); return; }
  // 鐵梁底下的投影:把頂刺和石牆的明度拉開
  const sh = c.createLinearGradient(0, 0.2, 0, CEIL + 0.6);
  sh.addColorStop(0, pal.shadow);
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sh;
  c.fillRect(0, 0.2, W, CEIL + 0.4);
  c.fillStyle = pal['iron-dark']; // 暗鐵梁+亮邊+鉚釘
  c.fillRect(0, 0, W, 0.22);
  c.fillStyle = pal.iron;
  c.fillRect(0, 0.03, W, 0.06);
  c.fillStyle = pal.ink;
  c.fillRect(0, 0.2, W, 0.03);
  for (let x = 0.25; x < W; x += 0.75) {
    c.fillStyle = pal['iron-hi'];
    circle(c, x, 0.12, 0.04);
    c.fill();
    c.fillStyle = pal.glint;
    circle(c, x - 0.012, 0.108, 0.014);
    c.fill();
  }
  const n = 18;
  const step = W / n;
  for (let i = 0; i < n; i++) ironSpike(c, pal, i * step + jitter, (i + 1) * step + jitter, 0.21, CEIL + 0.04, red);
  c.fillStyle = pal.glint; // 刺尖反光
  for (let i = 0; i < n; i++) {
    circle(c, (i + 0.45) * step + jitter, CEIL - 0.06, 0.016);
    c.fill();
  }
}

function paintThemeCeiling(c, pal, red, jitter) {
  c.fillStyle = pal['wood-dark']; c.fillRect(0, 0, W, .2);
  c.fillStyle = pal['wood-hi']; c.fillRect(0, .12, W, .035);
  if (pal.theme === 'factory') {
    for (let x = .35; x < W; x += .75) {
      gearPath(c, x + jitter, .32, .28); c.fillStyle = pal.iron; c.fill(); ink(c, pal);
      circle(c, x + jitter, .32, .09); c.fillStyle = pal['iron-dark']; c.fill();
      if (red) { circle(c, x + jitter, .32, .04); c.fillStyle = pal.spike; c.fill(); }
    }
    return;
  }
  const step = pal.theme === 'cave' ? .75 : .5;
  for (let x = 0; x < W; x += step) {
    const mid = x + step / 2 + jitter;
    c.fillStyle = red ? pal.spike : pal[`${pal.theme}-scenery`];
    c.beginPath(); c.moveTo(x + jitter, .2);
    if (pal.theme === 'forest') {
      c.quadraticCurveTo(mid - .03, .3, mid, CEIL);
      c.quadraticCurveTo(mid + .03, .3, x + step + jitter, .2);
    } else if (pal.theme === 'sky') {
      c.lineTo(mid + .06, .36); c.lineTo(mid - .05, .37); c.lineTo(mid, CEIL);
      c.lineTo(x + step + jitter, .2);
    } else if (pal.theme === 'tower') {
      c.lineTo(mid - .08, .37); c.lineTo(mid, CEIL); c.lineTo(mid + .08, .37); c.lineTo(x + step + jitter, .2);
    } else {
      c.lineTo(mid, CEIL); c.lineTo(x + step + jitter, .2);
    }
    c.closePath(); c.fill(); ink(c, pal, .025);
    c.strokeStyle = pal['wood-hi']; c.lineWidth = .025;
    c.beginPath(); c.moveTo(mid - .05, .26); c.lineTo(mid - .01, .48); c.stroke();
  }
}

// ---- 角色:戴紅毛帽、黃圍巾的大頭小探險家 ----
// 原點在腳底中央;pose:'idle' | 'walk' | 'jump' | 'fall';hurt = 受傷表情;tint = 閃紅時的顏色。

function limb(c, x, y, angle, len, outline) {
  const ex = x + Math.sin(angle) * len;
  const ey = y + Math.cos(angle) * len;
  if (outline) { // 先畫粗一點的深色描邊,再疊本色
    const { strokeStyle, lineWidth } = c;
    c.strokeStyle = outline;
    c.lineWidth = lineWidth + 0.05;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(ex, ey);
    c.stroke();
    c.strokeStyle = strokeStyle;
    c.lineWidth = lineWidth;
  }
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(ex, ey);
  c.stroke();
  return [ex, ey];
}

// 背光側陰影:在剛畫好的形狀(path)裡,把 x < cut 的那半邊壓暗
function shadeBack(c, cut, alpha = 0.2) {
  c.save();
  c.clip();
  c.fillStyle = `rgba(0,0,0,${alpha})`;
  c.fillRect(-1, -2, 1 + cut, 3);
  c.restore();
}

function drawHero(c, fx, fy, o, pal) {
  const { pose, facing, phase, t, hurt, tint, rot = 0, squash = 0, still = false } = o;
  const cheer = pose === 'cheer'; // RS39 過關歡呼:雙手高舉揮動、小跳、瞇眼笑
  const col = (k) => tint ?? pal[k];
  const line = pal.ink; // 四肢描邊
  const air = pose === 'fall' || pose === 'jump';
  const bob = cheer ? (still ? 0 : -Math.abs(Math.sin(t * 9)) * 0.14) : pose === 'idle' ? Math.sin(t * 4) * 0.02 : pose === 'walk' ? -Math.abs(Math.sin(phase)) * 0.04 : 0;
  c.save();
  c.translate(fx, fy);
  c.scale(HERO, HERO);
  if (rot) {
    c.translate(0, -0.5);
    c.rotate(rot);
    c.translate(0, 0.5);
  }
  c.scale((facing < 0 ? -1 : 1) * (1 + 0.18 * squash), 1 - 0.22 * squash); // 落地壓扁回彈
  c.translate(0, bob);
  c.lineCap = 'round';
  c.lineJoin = 'round';

  const swing = pose === 'walk' ? Math.sin(phase) * 0.7 : 0;
  const wave = cheer && still ? 0 : Math.sin(t * (air ? 18 : cheer ? 12 : 6));

  // 圍巾尾巴(在身體後面):走路往後飄、下墜往上飄
  c.strokeStyle = col('scarf');
  c.lineWidth = 0.09;
  c.beginPath();
  c.moveTo(-0.08, -0.55);
  if (pose === 'fall') {
    c.quadraticCurveTo(-0.3, -0.75 + wave * 0.05, -0.28 + wave * 0.06, -0.98);
  } else {
    const back = pose === 'walk' || pose === 'jump' ? 0.42 : 0.2;
    c.quadraticCurveTo(-0.25, -0.5 + wave * 0.03, -0.12 - back, -0.42 + wave * 0.05 + (pose === 'idle' ? 0.12 : 0));
  }
  c.stroke();

  // 腿+靴子
  c.strokeStyle = col('pants');
  c.lineWidth = 0.13;
  const legs = pose === 'fall' ? [1.0 + wave * 0.1, -1.0 - wave * 0.1] : pose === 'jump' ? [0.35, -0.1] : cheer ? [0.3, -0.3] : [swing, -swing];
  for (const [hx, a] of [[-0.08, legs[0]], [0.08, legs[1]]]) {
    const [ex, ey] = limb(c, hx, -0.3, a, pose === 'fall' ? 0.26 : 0.22, line);
    c.fillStyle = col('boot');
    c.beginPath();
    c.ellipse(ex + 0.04, ey + 0.01, 0.09, 0.055, 0, 0, Math.PI * 2);
    c.fill();
    ink(c, pal, 0.03);
  }

  // 身體(外套)
  c.fillStyle = col('coat');
  c.beginPath();
  c.moveTo(-0.15, -0.56);
  c.lineTo(0.15, -0.56);
  c.lineTo(0.2, -0.27);
  c.quadraticCurveTo(0, -0.22, -0.2, -0.27);
  c.closePath();
  c.fill();
  if (!tint) shadeBack(c, -0.03);
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(-0.2, -0.33, 0.4, 0.05); // 腰帶
  c.beginPath();
  c.moveTo(-0.15, -0.56);
  c.lineTo(0.15, -0.56);
  c.lineTo(0.2, -0.27);
  c.quadraticCurveTo(0, -0.22, -0.2, -0.27);
  c.closePath();
  ink(c, pal, 0.03);

  // 手臂:下墜時張開往上、彈起時高舉
  c.strokeStyle = col('sleeve');
  c.lineWidth = 0.1;
  const arms = pose === 'fall' ? [-1.85 - wave * 0.2, 1.85 + wave * 0.2] : pose === 'jump' ? [-2.6, 2.6]
    : cheer ? [-2.75 - wave * 0.2, 2.75 + wave * 0.2] : [-swing * 0.8 - 0.35, swing * 0.8 + 0.35];
  for (const [sx, a] of [[-0.15, arms[0]], [0.15, arms[1]]]) {
    const [ex, ey] = limb(c, sx, -0.5, a, pose === 'idle' || pose === 'walk' ? 0.2 : cheer ? 0.3 : 0.26, line);
    c.fillStyle = col('skin');
    circle(c, ex, ey, 0.05);
    c.fill();
    ink(c, pal, 0.025);
  }

  // 圍巾(脖子)
  c.fillStyle = col('scarf');
  roundRect(c, -0.18, -0.62, 0.36, 0.09, 0.045);
  c.fill();
  ink(c, pal, 0.03);

  // 頭:背光側一道弧形陰影
  const hy = -0.88;
  c.fillStyle = col('skin');
  circle(c, 0, hy, 0.29);
  c.fill();
  if (!tint) {
    c.save();
    circle(c, 0, hy, 0.29);
    c.clip();
    c.fillStyle = 'rgba(120,60,30,0.16)';
    circle(c, -0.2, hy + 0.06, 0.3);
    c.fill();
    c.restore();
  }
  circle(c, 0, hy, 0.29);
  ink(c, pal, 0.03);

  // 毛帽+毛球(下墜時毛球往上飄)
  c.fillStyle = col('hat');
  c.beginPath();
  c.arc(0, hy - 0.02, 0.3, Math.PI * 1.02, Math.PI * 1.98);
  c.closePath();
  c.fill();
  if (!tint) {
    shadeBack(c, -0.08, 0.18);
    c.strokeStyle = 'rgba(255,255,255,0.45)'; // 帽子高光
    c.lineWidth = 0.04;
    c.beginPath();
    c.arc(0, hy - 0.02, 0.22, Math.PI * 1.6, Math.PI * 1.85);
    c.stroke();
  }
  c.beginPath();
  c.arc(0, hy - 0.02, 0.3, Math.PI * 1.02, Math.PI * 1.98);
  c.closePath();
  ink(c, pal, 0.03);
  c.fillStyle = col('hat-hi');
  roundRect(c, -0.31, hy - 0.09, 0.62, 0.09, 0.045);
  c.fill();
  ink(c, pal, 0.03);
  const pomX = pose === 'fall' ? -0.04 + wave * 0.03 : -0.1 - (pose === 'walk' ? 0.05 : 0);
  const pomY = pose === 'fall' ? hy - 0.42 : hy - 0.36;
  c.fillStyle = col('hat-hi');
  circle(c, pomX, pomY, 0.08);
  c.fill();
  ink(c, pal, 0.03);

  // 臉:朝面向的方向偏
  const ex1 = 0.06;
  const ex2 = 0.19;
  const ey = hy + 0.03;
  if (!tint) {
    c.fillStyle = pal.cheek;
    for (const x of [-0.01, 0.25]) {
      circle(c, x, hy + 0.12, 0.045);
      c.fill();
    }
  }
  c.strokeStyle = tint ? pal['wall-top'] : pal.eye;
  c.fillStyle = tint ? pal['wall-top'] : pal.eye;
  c.lineWidth = 0.03;
  if (hurt) { // 受傷:>< 眼、波浪嘴
    for (const x of [ex1, ex2]) {
      c.beginPath();
      c.moveTo(x - 0.04, ey - 0.04);
      c.lineTo(x + 0.03, ey);
      c.lineTo(x - 0.04, ey + 0.04);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(0.06, hy + 0.15);
    c.quadraticCurveTo(0.09, hy + 0.12, 0.12, hy + 0.15);
    c.quadraticCurveTo(0.15, hy + 0.18, 0.18, hy + 0.15);
    c.stroke();
  } else if (cheer) { // ^ ^ 瞇眼+張口大笑
    for (const x of [ex1, ex2]) {
      c.beginPath();
      c.moveTo(x - 0.045, ey + 0.02);
      c.lineTo(x, ey - 0.03);
      c.lineTo(x + 0.045, ey + 0.02);
      c.stroke();
    }
    c.beginPath();
    c.arc(0.13, hy + 0.1, 0.07, 0, Math.PI);
    c.closePath();
    c.fill();
  } else {
    const blink = pose === 'idle' && t % 3.2 < 0.12;
    for (const x of [ex1, ex2]) {
      if (blink) {
        c.beginPath();
        c.moveTo(x - 0.04, ey);
        c.lineTo(x + 0.04, ey);
        c.stroke();
      } else {
        c.fillStyle = tint ? pal['wall-top'] : '#ffffff';
        c.beginPath();
        c.ellipse(x, ey, 0.05, pose === 'fall' ? 0.07 : 0.06, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = tint ? pal['wall-top'] : pal.eye;
        circle(c, x + 0.012, ey + 0.008, 0.03);
        c.fill();
      }
    }
    c.beginPath();
    if (pose === 'fall') { // 驚訝的 o 嘴
      c.ellipse(0.13, hy + 0.15, 0.03, 0.04, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      c.arc(0.13, hy + 0.11, 0.05, 0.2 * Math.PI, 0.8 * Math.PI);
      c.stroke();
    }
  }
  c.restore();
}

function drawPlayer(c, s, pal, fx, opts) {
  const a = fx?.anim ?? { t: 0, facing: 1, phase: 0, moving: false, land: 0 };
  const { x, y, vy, on } = s.player;
  const flashing = fx ? fx.hurtFlash > 0 : s.hurt > HURT_SEC - HURT_FLASH;
  const blink = flashing && (opts.reduced || opts.demo || Math.floor((fx?.hurtFlash ?? 0) * 12) % 2 === 0);
  const tint = blink ? pal.spike : s.star > 0 && !opts.reduced && Math.floor(a.t * 8) % 2 === 0 ? pal.star : undefined;
  const e = fx?.ending;
  const cx = x + PLAYER / 2;
  if (e) {
    if (e.kind === 'ko') { // 生命歸零:轉著往下掉
      const k = e.t;
      drawHero(c, e.x + PLAYER / 2, e.y + PLAYER + k * k * 10, { pose: 'fall', facing: a.facing, phase: 0, t: a.t, hurt: true, tint: pal.spike, rot: k * 9 }, pal);
    }
    return; // 掉出底部:角色已不在場內
  }
  if (y > H) return;
  if (s.star > 0 || s.shield) {
    c.save();
    c.strokeStyle = s.star > 0 ? pal.star : pal.shield; c.lineWidth = .07;
    c.globalAlpha = s.star > 0 && !opts.reduced ? .65 + .3 * Math.sin(a.t * 8) : .95;
    c.beginPath(); c.ellipse(cx, y + .05, .65, .95, 0, 0, Math.PI * 2); c.stroke();
    if (s.shield) { shieldPath(c, cx + .5, y - .4, .16); c.fillStyle = pal.shield; c.fill(); ink(c, pal); }
    c.restore();
  }
  const pose = celebrating(s) ? 'cheer' : on === null ? (vy < 0 ? 'jump' : vy > 2 ? 'fall' : 'idle') : a.moving ? 'walk' : 'idle';
  const squash = a.land > 0 ? Math.sin((1 - a.land / LAND_SEC) * Math.PI) : 0;
  if (on !== null) { // 腳下小陰影
    c.fillStyle = pal.shadow;
    c.beginPath();
    c.ellipse(cx, y + PLAYER + 0.02, 0.36, 0.07, 0, 0, Math.PI * 2);
    c.fill();
  }
  drawHero(c, cx, y + PLAYER, { pose, facing: a.facing, phase: a.phase, t: a.t, hurt: flashing && pose !== 'cheer', tint: pose === 'cheer' ? undefined : tint, squash, still: opts.reduced }, pal);
  // 壁燈附近:角色受到暖色光(只疊在角色周圍一小圈)
  const scroll = s.mode === 'adventure' ? s.speed * s.time : scrolledBy(s.difficulty, s.time);
  if (s.mode === 'adventure' && stageFor(s).theme !== 'tower') return;
  const lit = torches(scroll).map((tr) => ({ ...tr, d: Math.hypot(tr.x - cx, tr.y - (y + 0.2)) })).sort((p, q) => p.d - q.d)[0];
  if (lit && lit.d < 2.6) {
    const k = 1 - lit.d / 2.6;
    const side = Math.sign(lit.x - cx) * 0.25; // 光從燈的那一側來
    const g = c.createRadialGradient(cx + side, y + 0.1, 0, cx + side, y + 0.1, 0.9);
    g.addColorStop(0, pal.warm);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = clamp(0.7 * k, 0, 1);
    c.fillStyle = g;
    c.fillRect(cx - 1.2, y - 1, 2.4, 2.4);
    c.restore();
  }
}

function drawParticles(c, fx, pal, reversed) {
  for (const p of fx.particles) {
    const k = clamp(p.life / p.max, 0, 1);
    c.globalAlpha = k;
    if (p.kind === 'star') {
      c.fillStyle = pal.warn;
      const r = 0.12 * (0.5 + k / 2);
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 ? r * 0.4 : r;
        const ang = (i * Math.PI) / 4;
        c.lineTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr);
      }
      c.fill();
    } else if (p.kind === 'heart') {
      heartPath(c, p.x, p.y, 0.1);
      c.fillStyle = pal.heart;
      c.fill();
    } else {
      c.fillStyle = p.kind === 'spark' ? pal.spike : pal.dust;
      circle(c, p.x, p.y, p.kind === 'dust' ? 0.09 * (1.5 - k / 2) : 0.06);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  c.font = 'bold 0.42px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 0.08;
  for (const t of fx.texts) {
    c.save();
    c.translate(t.x, t.y);
    // 保留場景翻轉後的位置，只把字形翻回正向。
    if (reversed) c.scale(1, -1);
    c.globalAlpha = clamp((t.life / t.max) * 1.5, 0, 1);
    c.strokeStyle = pal['wall-top'];
    c.strokeText(t.text, 0, 0);
    c.fillStyle = pal.heart;
    c.fillText(t.text, 0, 0);
    c.restore();
  }
  c.globalAlpha = 1;
  c.textAlign = 'start';
}

function drawLives(c, lives, pal) {
  roundRect(c, 0.55, CEIL + 0.14, 0.6 * MAX_LIVES + 0.16, 0.66, 0.33); // 底板:壓在平台上也看得清
  c.fillStyle = pal.hud;
  c.fill();
  for (let i = 0; i < MAX_LIVES; i++) {
    heartPath(c, 0.93 + i * 0.6, CEIL + 0.47, 0.24);
    if (i < lives) {
      c.fillStyle = pal.heart;
      c.fill();
    } else {
      c.strokeStyle = pal.empty;
      c.lineWidth = 0.06;
      c.stroke();
    }
  }
}

// 畫一整個場面。fx = createFx() 的特效狀態(示範圖可傳 null);opts = { reduced, demo }。
export function drawScene(c, s, pal, fx = null, opts = {}) {
  const reversed = directionFor(s) === -1;
  if (s.mode === 'adventure') pal = themePalette(pal, stageFor(s).theme);
  s = canonicalState(s);
  const t = fx?.anim.t ?? 0;
  c.save();
  if (reversed) { c.translate(0, H); c.scale(1, -1); }
  if (fx && fx.shake > 0 && !opts.reduced) {
    const m = 0.12 * (fx.shake / 0.3);
    c.translate(Math.sin(t * 95) * m, Math.cos(t * 83) * m);
  }
  drawBackground(c, pal, s.mode === 'adventure' ? s.speed * s.time : scrolledBy(s.difficulty, s.time), t, opts.reduced);
  const marker = s.mode === 'adventure' && !opts.demo ? goalMarker(s) : null;
  if (marker?.kind === 'portal') drawPortal(c, marker, pal, t, opts.reduced, reversed);
  if (marker?.kind === 'coins') drawCoinGuide(c, s, marker, pal, t, opts.reduced, reversed); // 光暈在金幣後面
  drawPlatforms(c, s, pal, fx, t, opts.reduced);
  if (s.mode === 'adventure') { // 終點旗:旗子關的旗平台一律畫;層數關只在 goalMarker 有給時畫
    const m = marker?.kind === 'flag' ? marker : { kind: 'flag', n: stageFor(s).target, remaining: 0, approach: false };
    if (marker?.kind === 'flag' || stageFor(s).goal === 'flag') drawGoalFlag(c, s, m, pal, t, opts.reduced, reversed);
  }
  drawCeiling(c, s, pal, t, opts.reduced);
  if (s.mode === 'adventure' && s.cloudTime > 0) { // 駕雲中(IR48):腳下踩著一朵雲
    c.globalAlpha = s.cloudTime < 2 && !opts.reduced ? .55 + .45 * Math.abs(Math.sin(t * 8)) : 1; // 快到期閃爍
    cloudPath(c, s.player.x - .35, s.player.y + PLAYER - .12, PLAYER + .7, .32);
    c.fillStyle = pal.cloud; c.fill(); ink(c, pal);
    c.globalAlpha = 1;
  }
  drawPlayer(c, s, pal, fx, opts);
  if (fx) drawParticles(c, fx, pal, reversed);
  c.restore();
  c.save();
  drawLives(c, s.lives, pal);
  if (opts.demo) {
    c.font = 'bold 0.6px system-ui, sans-serif';
    c.textAlign = 'end';
    c.textBaseline = 'middle';
    c.lineWidth = 0.1;
    c.strokeStyle = pal.hud;
    c.strokeText(s.over ? '結束' : `${s.floors} 層`, W - 0.6, CEIL + 0.47);
    c.fillStyle = pal.text;
    c.fillText(s.over ? '結束' : `${s.floors} 層`, W - 0.6, CEIL + 0.47);
    c.textAlign = 'start';
  }
  c.restore();

  if (fx?.hurtFlash > 0) { // 受傷紅閃
    c.fillStyle = pal.danger;
    c.globalAlpha = clamp(0.3 * (fx.hurtFlash / HURT_FLASH), 0, 1); // 超出 0~1 的值 canvas 會忽略、沿用前值
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
  }
  if (fx?.banner && !celebrating(s)) drawBanner(c, fx.banner, pal, opts.reduced);
  if (celebrating(s)) drawCelebration(c, s, fx, pal, opts.reduced);
  if (fx?.ending) { // 結束:由下往上暗下來
    const k = clamp(fx.ending.t / END_SEC, 0, 1);
    const g = c.createLinearGradient(0, H, 0, H * (1 - k));
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
}
