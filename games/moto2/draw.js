// 側面斜視角 Canvas 與畫面特效;所有物理判定由 logic.js 提供。
import { W, H, DIST_SCALE, HEIGHT_SCALE, RIDER_X, LANE_Y, LANE_GAP, LANE_SKEW, ROAD_SKEW,
  PARALLAX, TRACK_LEN, MAX_SPEED, CAR_HALF_LANE, CRASH_SEC, playerOf, terrainAt } from './logic.js?v=a9ad940';

export const PALETTE_KEYS = ['night', 'sky', 'mountain', 'grass', 'grass-dark', 'road', 'road-hi', 'road-dark',
  'ink', 'shadow', 'mud', 'mud-hi', 'wood', 'danger', 'ramp', 'skin', 'player', 'blue', 'yellow', 'purple',
  'white', 'eye', 'cheek', 'metal', 'tire', 'hud', 'text', 'dust', 'lamp'];
export const readPalette = (cs) => Object.fromEntries(PALETTE_KEYS.map((k) => [k, cs.getPropertyValue(`--m2-${k}`).trim()]));
export const END_SEC = 0.6;
// RS49:影子車「最佳紀錄」標籤與玩家「你」標籤的版面(畫面單位)。
export const LABEL_H = 0.36, YOU_LABEL_W = 0.5, BEST_LABEL_W = 1.9;
// you/ghost=標籤基線錨點 {x,y};兩者會疊到時,影子標籤往上錯開直到不重疊。
export function ghostLabelY(you, ghost) {
  let y = ghost.y;
  for (let i = 0; i < 8 && Math.abs(you.x - ghost.x) < (YOU_LABEL_W + BEST_LABEL_W) / 2
    && Math.abs(you.y - y) < LABEL_H + 0.04; i++) y -= LABEL_H + 0.08;
  return y;
}
export const createFx = () => ({ t: 0, shake: 0, flash: 0, particles: [], landing: 0, message: '', messageLeft: 0, ending: null });
export const endingDone = (fx) => fx.ending === null || fx.ending >= END_SEC;
export const fxBusy = (fx) => !endingDone(fx) || fx.shake > 0 || fx.flash > 0 || fx.particles.length > 0 || fx.messageLeft > 0;
const screenX = (x, lane, camera) => RIDER_X + (x - camera) * DIST_SCALE + lane * LANE_SKEW;
const groundY = (lane, x = RIDER_X) => LANE_Y + lane * LANE_GAP - (x - RIDER_X) * ROAD_SKEW;

// 高畫布等比例放大車輛與物件,額外高度分給天空與前景;短畫布不裁掉四車道。
export function sceneView(width, height) {
  const zoom = Math.max(1, Math.min(1.25, height / (width * H / W)));
  const scale = width / W * zoom;
  const viewHeight = height / scale;
  return { scale, width: width / scale, height: viewHeight, offsetY: Math.max(0, viewHeight - H) * 0.65 };
}

export function fxEvents(fx, prev, next, { reduced = false } = {}) {
  const a = playerOf(prev), b = playerOf(next);
  const crash = b.crash > a.crash, land = b.landing !== null, hot = b.overheat > a.overheat;
  if (crash || land || hot) {
    if (crash || land) fx.shake = reduced ? 0 : 0.25;
    if (crash) fx.flash = 0.3;
    if (land) fx.landing = 0.18;
    fx.message = hot ? '過熱!冷卻 3 秒' : crash ? '摔車!快跑回車上' : b.landing === 'perfect' ? '完美!' : '落地!';
    fx.messageLeft = 0.9;
    for (let i = 0; i < (reduced ? 3 : 10) && fx.particles.length < (reduced ? 10 : 50); i++) {
      const x = screenX(b.x, b.lanePos, b.x);
      fx.particles.push({ x, y: groundY(b.lanePos, x) - b.h * HEIGHT_SCALE,
        vx: Math.cos(i * 2.4) * 2, vy: -Math.abs(Math.sin(i * 2.4)) * 2, life: 0.5 });
    }
  }
  if (next.over && !prev.over) { fx.ending = 0; fx.message = '衝過終點!'; fx.messageLeft = END_SEC; }
}
export function fxUpdate(fx, dt) {
  fx.t += dt;
  for (const k of ['shake', 'flash', 'landing', 'messageLeft']) fx[k] = Math.max(0, fx[k] - dt);
  for (const p of fx.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += dt * 4; p.life -= dt; }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  if (fx.ending !== null) fx.ending += dt;
}

function oval(c, x, y, rx, ry, color, ink) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  if (ink) { c.strokeStyle = ink; c.lineWidth = 0.045; c.stroke(); }
}
function box(c, x, y, w, h, color, ink) {
  c.fillStyle = color; c.fillRect(x, y, w, h);
  if (ink) { c.strokeStyle = ink; c.lineWidth = 0.045; c.strokeRect(x, y, w, h); }
}
function path(c, points, color, ink) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.fillStyle = color; c.fill(); if (ink) { c.strokeStyle = ink; c.lineWidth = 0.045; c.stroke(); }
}
function line(c, points, color, width = 0.045) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function limb(c, points, color, ink, width = 0.13) {
  line(c, points, ink, width + 0.07); line(c, points, color, width);
}

// 三個週期背景依解析度與色票快取;沒有 OffscreenCanvas 時直接繪製。
const PERIODS = [24, 10, 8];
let layers = null;
function layerTile(c, p, layer) {
  if (layer === 0) {
    box(c, 0, 0, 24, 5.2, p.sky);
    for (let i = 0; i < 4; i++) {
      const x = i * 6;
      path(c, [[x, 5.2], [x + 3, 1.8 + i % 2 * 0.5], [x + 6, 5.2]], p.mountain);
      path(c, [[x + 2.4, 2.5 + i % 2 * 0.5], [x + 3, 1.8 + i % 2 * 0.5], [x + 3.7, 2.6 + i % 2 * 0.5]], p['road-hi']);
      oval(c, x + 1.8, 1.1, 0.65, 0.14, p.white);
    }
    oval(c, 18, 1.2, 0.42, 0.42, p.lamp);
    if (Number(p.night)) for (let i = 0; i < 18; i++) oval(c, (i * 3.7) % 24, 0.4 + i % 4 * 0.32, 0.025, 0.025, p.white);
  } else if (layer === 1) {
    box(c, 0, 3.8, 10, 1.3, p['grass-dark']);
    for (let i = 0; i < 10; i++) {
      const x = i + 0.35;
      oval(c, x, 4.12 + i % 2 * 0.18, 0.13, 0.13, p.skin, p.ink);
      box(c, x - 0.15, 4.26 + i % 2 * 0.18, 0.3, 0.28, [p.blue, p.yellow, p.purple][i % 3], p.ink);
      if (i % 3 === 0) {
        line(c, [[x + 0.3, 3.35], [x + 0.3, 4.55]], p.ink);
        path(c, [[x + 0.3, 3.35], [x + 0.9, 3.5], [x + 0.3, 3.7]], p.danger, p.ink);
      }
    }
    box(c, 0, 4.7, 10, 0.17, p.wood, p.ink);
  } else {
    box(c, 0, 10.8, 8, 1.2, p.grass);
    for (let i = 0; i < 8; i++) {
      line(c, [[i + 0.15, 11.6], [i + 0.25, 11.3], [i + 0.45, 11.6]], p['grass-dark'], 0.07);
      if (i % 3 === 0) oval(c, i + 0.7, 11.7, 0.25, 0.13, p['road-dark'], p.ink);
    }
  }
}
function background(c, p, camera, layer) {
  const scale = Math.max(1, c.getTransform().a), key = `${scale}|${JSON.stringify(p)}`;
  if (typeof OffscreenCanvas !== 'undefined' && layers?.key !== key) {
    layers = { key, tiles: PERIODS.map((period, index) => {
      const tile = new OffscreenCanvas(Math.ceil(period * scale), Math.ceil(H * scale));
      const g = tile.getContext('2d'); g.setTransform(tile.width / period, 0, 0, tile.height / H, 0, 0);
      layerTile(g, p, index); return tile;
    }) };
  }
  const period = PERIODS[layer], offset = camera * DIST_SCALE * PARALLAX[layer] % period;
  for (let x = -offset; x < W; x += period) {
    if (layers?.key === key) c.drawImage(layers.tiles[layer], x, 0, period, H);
    else { c.save(); c.translate(x, 0); layerTile(c, p, layer); c.restore(); }
  }
}
function road(c, s, p, camera, visible) {
  box(c, 0, 5, W, 6, p.road);
  for (let lane = 0; lane < 4; lane++) {
    const points = [];
    for (let sx = -1; sx <= W + 1; sx += 0.25) {
      const x = camera + (sx - RIDER_X - lane * LANE_SKEW) / DIST_SCALE;
      points.push([sx, groundY(lane, sx) - terrainAt(x, lane, visible).h * HEIGHT_SCALE]);
    }
    path(c, [...points, [W + 1, groundY(lane, W + 1) + 0.75], [-1, groundY(lane, -1) + 0.75]], lane % 2 ? p.road : p['road-hi']);
    line(c, points, p['road-dark'], 0.05);
    for (let i = 0; i < 20; i++) {
      const sx = ((i * 1.7 - camera * DIST_SCALE) % 17 + 17) % 17;
      const x = camera + (sx - RIDER_X - lane * LANE_SKEW) / DIST_SCALE;
      const y = groundY(lane, sx) + 0.4 - terrainAt(x, lane, visible).h * HEIGHT_SCALE;
      box(c, sx, y, 0.17, 0.025, p['road-dark']);
    }
  }
  const end = screenX(TRACK_LEN, 0, camera);
  if (end > -2 && end < W + 1) for (let lane = 0; lane < 4; lane++) {
    const x = end + lane * LANE_SKEW;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) box(c, x + i * 0.2, groundY(lane, x) + j * 0.22, 0.2, 0.22, (i + j) % 2 ? p.tire : p.white);
  }
}
function obstacle(c, o, camera, p) {
  const x = screenX(o.x, Math.max(0, o.lane), camera), y = groundY(Math.max(0, o.lane), x);
  const length = o.length * DIST_SCALE, depth = CAR_HALF_LANE * LANE_GAP * 2;
  if (o.kind === 'mud') {
    oval(c, x + length / 2, y + 0.25, length / 2, depth / 2.5, p.mud, p.ink);
    line(c, [[x + 0.3, y + 0.23], [x + 0.7, y + 0.16], [x + 1, y + 0.23]], p['mud-hi'], 0.06);
  } else if (o.kind === 'barrier') {
    box(c, x, y - 0.7, length, 0.16, p.wood, p.ink);
    for (const d of [0.04, length - 0.12]) box(c, x + d, y - 0.6, 0.1, 0.75, p.wood, p.ink);
    line(c, [[x, y - 0.7], [x + length, y - 0.35]], p.danger, 0.08);
    line(c, [[x, y - 0.35], [x + length, y - 0.7]], p.danger, 0.08);
  } else if (o.kind === 'ramp') {
    const points = [[x, y + 0.15]];
    for (let i = 0; i <= 12; i++) points.push([x + length * i / 12, y - length * i / 12 * ROAD_SKEW - o.height * Math.sin(i / 12 * Math.PI / 2) * HEIGHT_SCALE]);
    points.push([x + length, y + 0.15]); path(c, points, p.ramp, p.ink);
    line(c, [[x + 0.3, y + 0.03], [x + 0.6, y - 0.1], [x + 0.5, y - 0.13]], p.white, 0.05);
  } else if (o.kind === 'cooling') {
    line(c, [[x, 3.95], [x, 5.1]], p.metal, 0.08);
    box(c, x - 0.3, 3.9, 0.6, 0.65, p.blue, p.ink);
    // 雪花藍牌:形狀與文字雙重辨识。
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) line(c, [[x - Math.cos(a) * 0.19, 4.22 - Math.sin(a) * 0.19], [x + Math.cos(a) * 0.19, 4.22 + Math.sin(a) * 0.19]], p.white);
  }
}

function face(c, p, mood) {
  oval(c, 0.16, -1.18, 0.31, 0.32, p.skin, p.ink);
  oval(c, 0.02, -1.16, 0.09, 0.24, p.shadow);
  if (mood === 'hurt') {
    line(c, [[0.2, -1.25], [0.26, -1.2], [0.2, -1.15]], p.eye, 0.035);
    line(c, [[0.36, -1.25], [0.3, -1.2], [0.36, -1.15]], p.eye, 0.035);
    line(c, [[0.19, -1.03], [0.23, -1.06], [0.29, -1.03], [0.33, -1.06]], p.eye, 0.03);
  } else {
    oval(c, 0.24, -1.23, 0.075, 0.095, p.white, p.ink);
    oval(c, 0.28, -1.21, 0.028, 0.05, p.eye);
    if (mood === 'effort') oval(c, 0.32, -1.04, 0.045, 0.05, p.eye);
    else line(c, [[0.23, -1.03], [0.28, -0.99], [0.34, -1.03]], p.eye, 0.03);
  }
  oval(c, 0.17, -1.08, 0.055, 0.035, p.cheek);
}
function rider(c, v, camera, p, color, fx, reduced, ghost = false) {
  const x = screenX(v.x, v.lanePos, camera), y = groundY(v.lanePos, x), t = fx?.t ?? 0;
  if (x < -2 || x > W + 2) return;
  c.save(); if (ghost) c.globalAlpha = 0.35;
  const height = v.h * HEIGHT_SCALE;
  oval(c, x, y + 0.18, Math.max(0.2, 0.72 - height * 0.12), 0.1, p.shadow);
  c.translate(x, y - height - 0.1);
  c.rotate(-v.angle * Math.PI / 180 - Math.atan(ROAD_SKEW) + (v.crash && !reduced ? Math.min(1, (CRASH_SEC - v.crash) / 0.5) * Math.PI * 2 : 0));
  const squash = v.id === 0 && fx?.landing ? 1 - fx.landing * 0.5 : 1; c.scale(1, squash);
  if (v.sprinting) path(c, [[-0.65, -0.32], [-1.35, -0.1], [-1.1, -0.3], [-1.4, -0.45]], p.yellow, p.danger);
  for (const wheel of [-0.48, 0.55]) {
    oval(c, wheel, 0, 0.27, 0.27, p.tire, p.ink); oval(c, wheel, 0, 0.14, 0.14, p.metal, p.ink);
    const spin = reduced ? 0 : v.x * 0.12;
    line(c, [[wheel - Math.cos(spin) * 0.13, -Math.sin(spin) * 0.13], [wheel + Math.cos(spin) * 0.13, Math.sin(spin) * 0.13]], p.white, 0.025);
  }
  path(c, [[-0.5, -0.1], [-0.3, -0.5], [0.25, -0.45], [0.55, -0.05], [-0.08, -0.12]], color, p.ink);
  box(c, -0.38, -0.45, 0.3, 0.26, p.shadow);
  line(c, [[-0.42, -0.5], [0.27, -0.5]], p.white, 0.07);
  limb(c, [[0.55, -0.05], [0.35, -0.64], [0.5, -0.66]], p.metal, p.ink, 0.07);
  if (!v.crash || v.crash > 0.6) {
    limb(c, [[-0.1, -0.72], [-0.3, -0.42], [0.03, -0.25]], p.metal, p.ink);
    path(c, [[-0.24, -0.79], [0.08, -0.97], [0.19, -0.63], [-0.04, -0.56]], color, p.ink);
    path(c, [[-0.24, -0.79], [-0.14, -0.86], [-0.05, -0.57]], p.shadow);
    limb(c, [[0.02, -0.82], [0.22, -0.63], [0.4, -0.64]], color, p.ink, 0.1);
    face(c, p, v.crash ? 'hurt' : v.air || v.sprinting || v.overheat ? 'effort' : 'smile');
    // 彩色安全帽與可辨識的白色護目鏡帶。
    path(c, [[-0.15, -1.24], [-0.13, -1.49], [0.05, -1.58], [0.32, -1.51], [0.48, -1.32], [0.18, -1.35]], color, p.ink);
    path(c, [[-0.15, -1.24], [-0.13, -1.49], [0.02, -1.55], [0.03, -1.33]], p.shadow);
    line(c, [[-0.09, -1.43], [0.19, -1.47]], p.white, 0.04);
  }
  c.restore();
  if (v.crash && v.crash <= 0.6) {
    c.save(); c.translate(x - v.crash * 2, y);
    const swing = reduced ? 0 : Math.sin(t * 24) * 0.17;
    limb(c, [[0, -0.55], [-0.15 + swing, -0.2], [-0.2, 0]], color, p.ink);
    limb(c, [[0, -0.55], [0.15 - swing, -0.2], [0.2, 0]], p.metal, p.ink);
    box(c, -0.15, -0.85, 0.3, 0.35, color, p.ink); face(c, p, 'hurt'); c.restore();
  }
  if (v.overheat) for (let i = 0; i < (reduced ? 2 : 5); i++) {
    const phase = (t * 0.7 + i * 0.2) % 1;
    c.save(); c.globalAlpha = (1 - phase) * 0.5;
    oval(c, x - 0.3 - phase * 0.3, y - 0.5 - phase * 1.5, 0.12 + phase * 0.22, 0.12 + phase * 0.2, p.metal); c.restore();
  }
  if (v.speed > 10 && !v.air && !ghost) for (let i = 0; i < (reduced ? 1 : 4); i++) {
    const phase = (v.x * 0.025 + i * 0.25) % 1;
    c.save(); c.globalAlpha = (1 - phase) * 0.45;
    oval(c, x - 0.8 - phase * 0.8, y + 0.1 - phase * 0.2, 0.06 + phase * 0.12, 0.04 + phase * 0.1, p.dust); c.restore();
  }
  c.fillStyle = p.text; c.font = 'bold 0.32px system-ui'; c.textAlign = 'center';
  if (!ghost) c.fillText(v.id === 0 ? '你' : `CPU ${v.id}`, x, y + 0.65);
}

export function drawScene(c, s, p, fx = null, { reduced = false, ghost = null, lead = null,
  view = { width: W, height: H, offsetY: 0 } } = {}) {
  const player = playerOf(s), camera = player.x;
  c.save(); c.beginPath(); c.rect(0, 0, view.width, view.height); c.clip();
  box(c, 0, 0, view.width, view.height, p.sky);
  box(c, 0, view.offsetY + 10.8, view.width, Math.max(0, view.height - view.offsetY - 10.8), p.grass);
  c.translate(0, view.offsetY);
  if (fx?.shake && !reduced) c.translate(Math.sin(fx.t * 91) * fx.shake * 0.2, Math.cos(fx.t * 83) * fx.shake * 0.2);
  background(c, p, camera, 0); background(c, p, camera, 1);
  const visible = s.track.filter((o) => o.x + o.length > camera - 130 && o.x < camera + 270);
  road(c, s, p, camera, visible);
  for (const o of visible.filter((o) => o.kind === 'cooling')) obstacle(c, o, camera, p);
  const colors = [p.player, p.blue, p.yellow, p.purple];
  for (let lane = 0; lane < 4; lane++) {
    for (const o of visible.filter((o) => o.lane === lane)) obstacle(c, o, camera, p);
    if (ghost && Math.round(ghost.lane) === lane) rider(c, { ...player, x: ghost.x, lanePos: ghost.lane, h: ghost.h, angle: 0, crash: 0,
      sprinting: false, overheat: 0, air: 1 }, camera, p, p.white, null, true, true);
    for (const v of s.vehicles.filter((v) => Math.round(v.lanePos) === lane)) rider(c, v, camera, p, colors[v.id], fx, reduced);
  }
  if (ghost) { // 標籤最後畫,蓋在所有車上;與「你」標籤重疊時往上錯開。
    const gx = screenX(ghost.x, ghost.lane, camera), gy = groundY(ghost.lane, gx);
    const you = { x: screenX(player.x, player.lanePos, camera), y: groundY(player.lanePos, screenX(player.x, player.lanePos, camera)) + 0.65 };
    const ly = ghostLabelY(you, { x: gx, y: gy - 2 - ghost.h * HEIGHT_SCALE });
    c.fillStyle = p.text; c.font = 'bold 0.32px system-ui'; c.textAlign = 'center';
    c.fillText('最佳紀錄', gx, ly);
  }
  background(c, p, camera, 2);
  if (player.speed >= MAX_SPEED * 0.85 && !reduced) {
    c.save(); c.globalAlpha = 0.28;
    for (let i = 0; i < 9; i++) {
      const x = ((i * 2.3 - camera * DIST_SCALE * 2) % 17 + 17) % 17;
      line(c, [[x, 2.5 + i * 0.9], [x - 1.2, 2.5 + i * 0.9]], p.white, 0.035);
    } c.restore();
  }
  if (fx) {
    for (const q of fx.particles) { c.save(); c.globalAlpha = Math.min(1, q.life * 2); oval(c, q.x, q.y, 0.08, 0.06, p.dust); c.restore(); }
    if (fx.flash) { c.save(); c.globalAlpha = fx.flash * 0.35; box(c, 0, -view.offsetY, view.width, view.height, p.danger); c.restore(); }
  }
  if (s.countdown) {
    oval(c, view.width / 2, 3, 0.85, 0.85, p.hud, p.ink);
    c.fillStyle = p.text; c.font = 'bold 1.2px system-ui'; c.textAlign = 'center'; c.fillText(String(Math.ceil(s.countdown)), view.width / 2, 3.45);
  }
  const message = fx?.messageLeft ? fx.message : player.overheat ? '過熱:等待冷卻' : player.air ? '空中:前傾 / 後仰' : player.mud ? '泥坑:限速 50%' : player.x > TRACK_LEN - 250 ? '最後衝刺!' : '';
  if (message) {
    box(c, view.width / 2 - 3.5, 0.4, 7, 0.7, p.hud);
    c.fillStyle = p.text; c.font = 'bold 0.4px system-ui'; c.textAlign = 'center'; c.fillText(message, view.width / 2, 0.88);
  }
  if (lead) {
    box(c, 0.3, 0.4, 3.6, 0.7, p.hud);
    c.fillStyle = p.text; c.font = 'bold 0.4px system-ui'; c.textAlign = 'center'; c.fillText(lead, 2.1, 0.88);
  }
  if (fx?.ending != null) { c.save(); c.globalAlpha = Math.min(0.3, fx.ending / END_SEC * 0.3); box(c, 0, -view.offsetY, view.width, view.height, p.ink); c.restore(); }
  c.restore();
}
