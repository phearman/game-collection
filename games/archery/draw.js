// 弓箭射擊繪圖(Canvas,⛔ 圖檔)。只讀狀態畫圖,不改規則;座標用 logic 單位,y 向上,這裡翻成畫面座標。
import { W, H, ARCHER, GRAB_R } from './logic.js?v=6d7df09';

export const FLASH_MS = 200;
export const flashOpacity = (startedAt, now) => startedAt === null ? 0 : Math.max(0, 1 - (now - startedAt) / FLASH_MS);

// 色票:CSS 變數 --ar-{key}(style.css 定義深淺兩套)。
export const PALETTE_KEYS = [
  'sky-a', 'sky-b', 'hill', 'ground', 'ground-dark', 'wood', 'wood-dark', 'skin', 'coat', 'hat', 'pants',
  'bow', 'string', 'arrow', 'fletch', 'ring-1', 'ring-2', 'ring-3', 'ring-4', 'ring-5', 'stand',
  'ink', 'text', 'preview', 'trail', 'flag', 'pole', 'halo', 'star',
];
export function readPalette(cs) {
  return Object.fromEntries(PALETTE_KEYS.map((k) => [k, cs.getPropertyValue(`--ar-${k}`).trim()]));
}

const Y = (y) => H - y;
const deg = (a) => a * Math.PI / 180;

function background(ctx, pal) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, pal['sky-a'] || '#8ccbf0');
  sky.addColorStop(1, pal['sky-b'] || '#e6f5ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // 遠山剪影
  ctx.fillStyle = pal.hill || '#9cc59a';
  ctx.beginPath();
  ctx.moveTo(0, Y(12));
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, Y(30 + 14 * Math.sin(x / 47) + 8 * Math.sin(x / 19)));
  ctx.lineTo(W, Y(12));
  ctx.closePath();
  ctx.fill();
  // 草地
  ctx.fillStyle = pal.ground || '#6bb35a';
  ctx.fillRect(0, Y(12), W, 12);
  ctx.fillStyle = pal['ground-dark'] || '#4c8a3e';
  for (let x = 4; x < W; x += 13) ctx.fillRect(x, Y(12), 2, 3);
}

function windFlag(ctx, pal, wind) {
  const x = W - 22;
  const top = Y(H - 14);
  ctx.strokeStyle = pal.pole || '#5b4a3a';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + 34); ctx.stroke();
  const len = 6 + Math.min(40, Math.abs(wind)) * 0.45;
  const dir = wind === 0 ? 0 : Math.sign(wind);
  ctx.fillStyle = pal.flag || '#e9475c';
  ctx.beginPath();
  if (dir === 0) { ctx.moveTo(x, top); ctx.lineTo(x + 3, top + 8); ctx.lineTo(x, top + 14); }
  else { ctx.moveTo(x, top); ctx.lineTo(x + dir * len, top + 5); ctx.lineTo(x, top + 10); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.text || '#2c2c2a';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(wind === 0 ? '無風' : `風 ${wind > 0 ? '→' : '←'} ${Math.abs(wind)}`, x - 6, top + 10);
}

function tower(ctx, pal) {
  ctx.fillStyle = pal.wood || '#b9743a';
  ctx.fillRect(ARCHER.x - 16, Y(ARCHER.y - 12), 32, ARCHER.y - 12);
  ctx.fillStyle = pal['wood-dark'] || '#6e3f17';
  ctx.fillRect(ARCHER.x - 18, Y(ARCHER.y - 12), 36, 4);
  for (let y = 14; y < ARCHER.y - 14; y += 12) ctx.fillRect(ARCHER.x - 16, Y(y), 32, 2);
}

// 弓手:圓頭小人,弓朝瞄準角度,拉弓時弓弦往後拉(力度越大拉越開)。
function archer(ctx, pal, aim, pulling) {
  const cx = ARCHER.x - 4;
  const foot = Y(ARCHER.y - 12);
  ctx.strokeStyle = pal.pants || '#3b3552';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 3, foot); ctx.lineTo(cx - 1, foot - 9); ctx.lineTo(cx + 2, foot); ctx.stroke();
  ctx.fillStyle = pal.coat || '#2f6fd6';
  ctx.fillRect(cx - 5, foot - 22, 10, 14);
  ctx.fillStyle = pal.skin || '#ffd8b4';
  ctx.beginPath(); ctx.arc(cx, foot - 28, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.hat || '#e2343f';
  ctx.beginPath(); ctx.arc(cx, foot - 29, 6.3, Math.PI, 0); ctx.fill();
  ctx.fillStyle = pal.ink || '#222';
  ctx.fillRect(cx + 2, foot - 29, 1.5, 1.5);
  // 弓(以手的位置為中心,朝瞄準方向)
  const hx = ARCHER.x + 2, hy = Y(ARCHER.y);
  const a = -deg(aim.angle);
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(a);
  const pull = pulling ? 4 + aim.power * 10 : 2;
  ctx.strokeStyle = pal.bow || '#7a4720';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, 13, -Math.PI / 2.4, Math.PI / 2.4); ctx.stroke();
  const ex = 13 * Math.cos(Math.PI / 2.4), ey = 13 * Math.sin(Math.PI / 2.4);
  ctx.strokeStyle = pal.string || '#f4efe4';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ex, -ey); ctx.lineTo(-pull, 0); ctx.lineTo(ex, ey); ctx.stroke();
  if (pulling) arrowShape(ctx, pal, -pull, 0, 0);
  ctx.restore();
  // 拉弓的手
  ctx.strokeStyle = pal.skin || '#ffd8b4';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + 4, foot - 18); ctx.lineTo(hx, hy); ctx.stroke();
}

// 箭:尾端在 (x, y),朝 angle(弧度,畫面座標)方向,長 18。
function arrowShape(ctx, pal, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = pal.arrow || '#5a3a20';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(18, 0); ctx.stroke();
  ctx.fillStyle = pal.arrow || '#5a3a20';
  ctx.beginPath(); ctx.moveTo(21, 0); ctx.lineTo(16, -2.5); ctx.lineTo(16, 2.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.fletch || '#e9475c';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4, -3); ctx.lineTo(6, 0); ctx.lineTo(4, 3); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// 靶:直立靶面(側看畫成窄橢圓),五環由外而內。
function target(ctx, pal, t) {
  const x = t.x, y = Y(t.y);
  ctx.strokeStyle = pal.stand || '#7a4a24';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, Y(0)); ctx.moveTo(x + 4, y); ctx.lineTo(x - 2, Y(0)); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const ratio = 1 - i * 0.2;
    ctx.fillStyle = pal[`ring-${i + 1}`] || ['#f4f1ea', '#2c2c2a', '#3d8bff', '#e2343f', '#ffcc33'][i];
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(2, t.r * 0.32 * ratio), t.r * ratio, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = pal.ink || '#222';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(x, y, t.r * 0.32, t.r, 0, 0, Math.PI * 2); ctx.stroke();
}

function dotted(ctx, points, color, dash) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, Y(p.y)) : ctx.moveTo(p.x, Y(p.y))));
  ctx.stroke();
  ctx.restore();
}

// view:{ aim, pulling, preview, trail, grabHint(0~1), flash(0~1), reduced }
export function drawScene(ctx, state, pal, view = {}) {
  const aim = view.aim ?? state.aim;
  background(ctx, pal);
  windFlag(ctx, pal, state.wind);
  target(ctx, pal, state.target);
  tower(ctx, pal);
  if (view.grabHint > 0) {
    ctx.save();
    ctx.globalAlpha = view.grabHint;
    ctx.strokeStyle = pal.halo || '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(ARCHER.x, Y(ARCHER.y), GRAB_R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (!view.reduced) dotted(ctx, view.trail, pal.trail || 'rgba(255,255,255,0.6)');
  if (state.phase === 'aim') dotted(ctx, view.preview, pal.preview || '#2c2c2a', [3, 3]);
  archer(ctx, pal, aim, state.phase === 'aim' && view.pulling);
  const shot = state.shot;
  if (shot && (state.phase === 'flying' || state.phase === 'result')) {
    const angle = Math.atan2(-shot.vy, shot.vx);
    const hit = state.hit;
    if (state.phase === 'result' && hit?.points > 0) arrowShape(ctx, pal, hit.x - 16 * Math.cos(angle), Y(hit.y) - 16 * Math.sin(angle), angle);
    else arrowShape(ctx, pal, shot.x - 18 * Math.cos(angle), Y(shot.y) - 18 * Math.sin(angle), angle);
  }
  if (state.phase === 'result' && state.hit) {
    const { x, y, points } = state.hit;
    if (points === 10 && view.flash > 0 && !view.reduced) {
      ctx.save();
      ctx.globalAlpha = view.flash;
      ctx.fillStyle = pal.star || '#fff083';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 6 : 14;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        ctx.lineTo(x + r * Math.cos(a), Y(y) + r * Math.sin(a));
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = pal.text || '#2c2c2a';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tx = Math.min(W - 30, Math.max(30, x)), ty = Math.max(20, Math.min(H - 10, Y(y) - 18));
    ctx.strokeStyle = pal.halo || '#ffffff';
    ctx.lineWidth = 3;
    const label = points > 0 ? `+${points}` : '脫靶';
    ctx.strokeText(label, tx, ty);
    ctx.fillText(label, tx, ty);
  }
}
