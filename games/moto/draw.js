// Canvas 美術與短暫特效;不修改遊戲狀態。場地使用 logic 提供的尺寸。
import {
  W, H, ROAD_LEFT, LANE_WIDTH, DIST_SCALE, RIDER_Y, TRACK_LEN, CAR_HALF_LANE,
  CRASH_SEC, playerOf, ranking,
} from './logic.js?v=fea2bda';

export const PALETTE_KEYS = ['night', 'grass', 'grass-dark', 'road', 'road-hi', 'road-dark', 'ink', 'shadow',
  'mud', 'mud-hi', 'wood', 'danger', 'ramp', 'skin', 'player', 'blue', 'yellow', 'purple', 'white',
  'eye', 'cheek', 'metal', 'tire', 'hud', 'text', 'dust', 'lamp'];
export const readPalette = (cs) => Object.fromEntries(PALETTE_KEYS.map((k) => [k, cs.getPropertyValue(`--mt-${k}`).trim()]));
export const END_SEC = 0.6;
export const createFx = () => ({ t: 0, shake: 0, flash: 0, particles: [], landing: 0, message: '', messageLeft: 0, ending: null });
export const endingDone = (fx) => fx.ending === null || fx.ending >= END_SEC;
export const fxBusy = (fx) => !endingDone(fx) || fx.flash > 0 || fx.particles.length > 0 || fx.messageLeft > 0;
const screenX = (x) => ROAD_LEFT + (x + 0.5) * LANE_WIDTH;
const screenY = (y, playerY) => RIDER_Y - (y - playerY) * DIST_SCALE;

export function fxEvents(fx, prev, next, { reduced = false } = {}) {
  const a = playerOf(prev), b = playerOf(next);
  const crash = b.crash > a.crash;
  const land = a.air > 0 && b.air === 0;
  const jump = b.air > a.air;
  if (crash || land || jump) {
    if (crash) { fx.flash = 0.3; fx.shake = reduced ? 0 : 0.3; }
    if (land) fx.landing = 0.18;
    fx.message = crash ? '摔車!重新起步' : jump ? '飛起來了!' : '落地!';
    fx.messageLeft = 0.8;
    const count = reduced ? 3 : 9;
    for (let i = 0; i < count && fx.particles.length < (reduced ? 10 : 50); i++) {
      const angle = i * 2.4;
      fx.particles.push({ x: screenX(b.x), y: RIDER_Y + 0.4, vx: Math.cos(angle) * 1.5,
        vy: Math.sin(angle) * 1.1, life: 0.5 });
    }
  }
  if (next.over && !prev.over) { fx.ending = 0; fx.message = '衝過終點!'; fx.messageLeft = END_SEC; }
}
export function fxUpdate(fx, dt) {
  fx.t += dt;
  for (const k of ['shake', 'flash', 'landing', 'messageLeft']) fx[k] = Math.max(0, fx[k] - dt);
  for (const p of fx.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  if (fx.ending !== null) fx.ending += dt;
}

function oval(c, x, y, rx, ry, color, ink = null) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  if (ink) { c.strokeStyle = ink; c.lineWidth = 0.035; c.stroke(); }
}
function box(c, x, y, w, h, color, ink = null) {
  c.fillStyle = color; c.fillRect(x, y, w, h);
  if (ink) { c.strokeStyle = ink; c.lineWidth = 0.035; c.strokeRect(x, y, w, h); }
}
function line(c, points, color, width = 0.04) {
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
}

// 路面與兩側旗幟以四單位週期快取;Canvas 不支援 OffscreenCanvas 時直接畫。
let tileCache = null;
function terrainTile(c, p) {
  box(c, 0, 0, W, 4, p.grass);
  box(c, ROAD_LEFT, 0, LANE_WIDTH * 4, 4, p.road);
  for (const x of [ROAD_LEFT - 0.12, ROAD_LEFT + LANE_WIDTH * 4]) box(c, x, 0, 0.12, 4, p['road-dark']);
  for (let i = 1; i < 4; i++) box(c, ROAD_LEFT + i * LANE_WIDTH - 0.02, 0.7, 0.04, 1.8, p['road-hi']);
  for (let i = 0; i < 25; i++) {
    const x = ROAD_LEFT + 0.2 + ((i * 47) % 63) / 10;
    const y = ((i * 13) % 37) / 10;
    box(c, x, y, 0.08, 0.025, i % 2 ? p['road-hi'] : p['road-dark']);
  }
  for (const x of [0.4, 8.6]) {
    for (const y of [0.5, 2.5]) line(c, [[x - 0.15, y + 0.16], [x, y], [x + 0.13, y + 0.12]], p['grass-dark']);
    line(c, [[x, 0.8], [x, 2]], p.ink, 0.045);
    c.beginPath(); c.moveTo(x, 0.8); c.lineTo(x + (x < 4 ? 0.5 : -0.5), 1); c.lineTo(x, 1.2);
    c.fillStyle = p.danger; c.fill(); c.strokeStyle = p.ink; c.stroke();
    oval(c, x, 2.6, 0.2, 0.2, p.skin, p.ink); // 路邊觀眾
    box(c, x - 0.22, 2.75, 0.44, 0.4, p.blue, p.ink);
    if (Number(p.night)) {
      c.save(); c.globalAlpha = 0.12; oval(c, x, 3.7, 0.75, 0.8, p.lamp); c.restore();
      box(c, x - 0.12, 3.5, 0.24, 0.24, p.lamp, p.ink);
    }
  }
}
function terrain(c, p, offset) {
  const scale = Math.max(1, c.getTransform().a);
  const key = `${scale}|${JSON.stringify(p)}`;
  if (typeof OffscreenCanvas !== 'undefined' && tileCache?.key !== key) {
    const tile = new OffscreenCanvas(Math.ceil(W * scale), Math.ceil(4 * scale));
    const g = tile.getContext('2d'); g.setTransform(tile.width / W, 0, 0, tile.height / 4, 0, 0); terrainTile(g, p);
    tileCache = { key, tile };
  }
  for (let y = offset - 4; y < H; y += 4) {
    if (tileCache?.key === key) c.drawImage(tileCache.tile, 0, y, W, 4);
    else { c.save(); c.translate(0, y); terrainTile(c, p); c.restore(); }
  }
}

function object(c, o, y, p) {
  const x = screenX(o.lane), w = CAR_HALF_LANE * LANE_WIDTH * 2, h = o.length * DIST_SCALE;
  if (o.kind === 'mud') {
    oval(c, x, y - h / 2, w / 2, h / 2, p.mud, p.ink);
    for (const d of [-0.25, 0.15]) oval(c, x + d, y - h / 2, 0.14, 0.05, p['mud-hi']);
    line(c, [[x - 0.4, y - 0.22], [x, y - 0.17], [x + 0.32, y - 0.22]], p['mud-hi']);
  } else if (o.kind === 'barrier') {
    box(c, x - w / 2, y - h, w, h, p.wood, p.ink);
    box(c, x - w / 2, y - h, w, 0.045, p['road-hi']);
    for (const d of [-0.4, 0.4]) box(c, x + d - 0.05, y - 0.5, 0.1, 0.65, p.wood, p.ink);
    line(c, [[x - 0.4, y - 0.18], [x + 0.4, y - 0.05]], p.danger, 0.07);
    line(c, [[x - 0.4, y - 0.05], [x + 0.4, y - 0.18]], p.danger, 0.07);
  } else {
    c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x - w / 2 + 0.1, y - h - 0.2);
    c.lineTo(x + w / 2 - 0.1, y - h - 0.2); c.lineTo(x + w / 2, y); c.closePath();
    c.fillStyle = p.ramp; c.fill(); c.strokeStyle = p.ink; c.lineWidth = 0.035; c.stroke();
    box(c, x - w / 2 + 0.1, y - h - 0.2, w - 0.2, 0.06, p.white);
    line(c, [[x - 0.2, y - 0.1], [x, y - 0.3], [x + 0.2, y - 0.1]], p.white, 0.06);
  }
}

function rider(c, v, y, color, p, fx, reduced, ghost = false) {
  const x = screenX(v.x), flying = v.air > 0;
  const height = flying ? Math.sin(Math.PI * v.air / v.airDuration) : 0;
  c.save();
  if (ghost) c.globalAlpha = 0.4;
  oval(c, x, y + 0.45, 0.43 - height * 0.1, 0.18, p.shadow);
  c.translate(x, y - height * 0.38);
  const size = 1 + height * 0.14;
  c.scale(size, size);
  if (v.crash > 0) {
    c.rotate((CRASH_SEC - v.crash) * 8);
    if (!reduced && Math.floor(v.crash * 10) % 2) c.globalAlpha *= 0.55;
  }
  if (v.id === 0 && fx?.landing) c.scale(1.05, 0.92);
  // 輪胎、金屬車架與車身:角色頭徑約為總高四成。
  oval(c, 0, -0.72, 0.15, 0.3, p.tire, p.ink);
  oval(c, 0, 0.66, 0.17, 0.32, p.tire, p.ink);
  line(c, [[-0.3, -0.25], [0, 0.65], [0.3, -0.25]], p.ink, 0.14);
  line(c, [[-0.3, -0.25], [0, 0.65], [0.3, -0.25]], p.metal, 0.08);
  oval(c, 0, 0.2, 0.28, 0.53, color, p.ink);
  c.save(); c.globalAlpha *= 0.2; oval(c, 0.08, 0.3, 0.13, 0.4, p.ink); c.restore();
  box(c, -0.08, 0.28, 0.16, 0.3, p.white);
  // 粗短的手腳;騎乘時身體前傾,騰空時雙臂伸開。
  const lean = v.speed > 0 ? -0.08 : 0;
  for (const side of [-1, 1]) {
    const hand = flying ? 0.5 : 0.4;
    line(c, [[side * 0.17, 0.25], [side * 0.38, 0.48]], p.ink, 0.17);
    line(c, [[side * 0.17, 0.25], [side * 0.38, 0.48]], color, 0.11);
    line(c, [[side * 0.2, -0.15 + lean], [side * hand, -0.32]], p.ink, 0.17);
    line(c, [[side * 0.2, -0.15 + lean], [side * hand, -0.32]], color, 0.11);
    oval(c, side * hand, -0.32, 0.09, 0.09, p.skin, p.ink);
  }
  oval(c, 0, -0.05 + lean, 0.27, 0.32, color, p.ink);
  oval(c, 0, -0.48 + lean, 0.39, 0.4, p.skin, p.ink);
  c.save(); c.globalAlpha *= 0.16; oval(c, 0.15, -0.4 + lean, 0.19, 0.25, p.wood); c.restore();
  // 安全帽:上緣高光、側面陰影、賽車白條。
  oval(c, 0, -0.67 + lean, 0.4, 0.23, color, p.ink);
  box(c, -0.06, -0.86 + lean, 0.12, 0.32, p.white);
  oval(c, -0.18, -0.75 + lean, 0.1, 0.04, p.white);
  for (const side of [-1, 1]) {
    const ex = side * 0.15, ey = -0.45 + lean;
    if (v.crash > 0) line(c, [[ex - 0.05, ey - 0.05], [ex + side * 0.04, ey], [ex - 0.05, ey + 0.05]], p.eye);
    else { oval(c, ex, ey, 0.085, 0.09, p.white); oval(c, ex, ey - 0.015, 0.035, 0.045, p.eye); }
    oval(c, side * 0.25, -0.31 + lean, 0.07, 0.035, p.cheek);
  }
  if (flying) oval(c, 0, -0.28 + lean, 0.05, 0.06, p.eye);
  else line(c, [[-0.08, -0.28 + lean], [0, -0.24 + lean], [0.08, -0.28 + lean]], p.eye, 0.025);
  c.restore();
}

export function drawScene(c, s, p, fx = null, { reduced = false, ghost = null } = {}) {
  const player = playerOf(s);
  c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip();
  if (!reduced && fx?.shake) c.translate(Math.sin(fx.t * 91) * fx.shake * 0.13, 0);
  terrain(c, p, (player.y * DIST_SCALE) % 4);
  const finishY = screenY(TRACK_LEN, player.y);
  if (finishY > -1 && finishY < H + 1) {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      box(c, ROAD_LEFT + i * LANE_WIDTH / 4, finishY + j * 0.22, LANE_WIDTH / 4, 0.22, (i + j) % 2 ? p.tire : p.white);
    }
    c.fillStyle = p.text; c.font = 'bold 0.38px sans-serif'; c.textAlign = 'center'; c.fillText('終點', W / 2, finishY - 0.2);
  }
  for (const o of s.track) {
    const y = screenY(o.y, player.y);
    if (y > -1 && y < H + 2) object(c, o, y, p);
  }
  if (ghost) rider(c, { ...player, ...ghost, air: 0, crash: 0, id: -1 }, screenY(ghost.y, player.y), p.white, p, null, true, true);
  const colors = [p.player, p.blue, p.yellow, p.purple];
  for (const v of [...s.vehicles].sort((a, b) => b.y - a.y)) {
    const y = screenY(v.y, player.y);
    if (y > -2 && y < H + 2) {
      rider(c, v, y, colors[v.id], p, fx, reduced);
      c.fillStyle = p.text; c.font = 'bold 0.26px sans-serif'; c.textAlign = 'center';
      c.fillText(v.id === 0 ? '你' : `CPU ${v.id}`, screenX(v.x), y + 1.15);
    }
  }
  if (fx) {
    for (const particle of fx.particles) {
      c.save(); c.globalAlpha = particle.life * 2; oval(c, particle.x, particle.y, 0.07, 0.07, p.dust); c.restore();
    }
    if (fx.flash) { c.save(); c.globalAlpha = fx.flash * 0.35; box(c, 0, 0, W, H, p.danger); c.restore(); }
  }
  box(c, 0.25, 0.25, W - 0.5, 1.1, p.hud);
  c.fillStyle = p.text; c.font = 'bold 0.37px sans-serif'; c.textAlign = 'left';
  c.fillText(s.mode === 'race' ? `第 ${ranking(s).indexOf(0) + 1} / 4 名` : '計時賽', 0.5, 0.72);
  c.textAlign = 'right'; c.fillText(`${s.time.toFixed(1)} 秒`, W - 0.5, 0.72);
  c.font = '0.28px sans-serif'; c.fillText(`${Math.floor(player.y)} / ${TRACK_LEN} · 速度 ${Math.round(player.speed)}`, W - 0.5, 1.13);
  if (s.countdown > 0) {
    c.fillStyle = p.hud; oval(c, W / 2, 6, 1.1, 1.1, p.hud, p.ink);
    c.fillStyle = p.text; c.font = 'bold 1.6px sans-serif'; c.textAlign = 'center'; c.fillText(String(Math.ceil(s.countdown)), W / 2, 6.55);
  }
  const message = fx?.messageLeft ? fx.message : player.air > 0 ? '騰空:不能換道' : player.mud ? '泥坑:限速 50%' : player.y > TRACK_LEN - 200 ? '最後衝刺!' : '';
  if (message) {
    box(c, 1.25, 2, 6.5, 0.7, p.hud); c.fillStyle = p.text; c.font = 'bold 0.35px sans-serif';
    c.textAlign = 'center'; c.fillText(message, W / 2, 2.46);
  }
  if (fx?.ending !== null && fx?.ending !== undefined) {
    c.save(); c.globalAlpha = Math.min(0.3, fx.ending / END_SEC * 0.3); box(c, 0, 0, W, H, p.ink); c.restore();
  }
  c.restore();
}
