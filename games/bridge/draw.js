import { FIELD_W, FIELD_H, PILLAR_H, FALL_SECONDS, DROP_SECONDS, comboText } from './logic.js?v=4577fc1';
import { skinPalette } from '../stairs/skins.js?v=4577fc1';

export function readPalette(css, skin = 'classic', dark = false) {
  const base = {
    'wall-top': dark ? '#182c49' : '#a6d7f3', 'wall-bot': dark ? '#344767' : '#eef7f5',
    pillar: dark ? '#263244' : '#34485b', 'pillar-hi': dark ? '#526781' : '#577086',
    wood: '#b77b47', 'wood-hi': '#efbc78', 'wood-dark': '#694123',
    coat: '#4388df', pants: '#283d58', boot: '#142538', hat: '#ed6d52',
    ink: dark ? '#0c1526' : '#203445', text: css.getPropertyValue('--text').trim() || (dark ? '#f4f6ff' : '#172f46'),
    hud: css.getPropertyValue('--surface').trim() || (dark ? '#182333' : '#ffffff'),
    skin: '#ffd4ae', red: dark ? '#ff8a83' : '#e63838',
  };
  return skinPalette(base, skin, dark);
}

export function createFx() { return { time: 0, flash: 0, pop: 0, cameraFrom: null, scroll: 0 }; }
export function fxEvents(fx, before, after) {
  if (before.phase === 'falling' && after.phase === 'walking' && after.landing === 'perfect') { fx.flash = 0.2; fx.pop = 0.2; }
  if (after.pillars > before.pillars) { fx.cameraFrom = before.current.x + before.current.width - 60; fx.scroll = 0.18; }
}
export function fxUpdate(fx, dt) {
  fx.time += dt;
  for (const key of ['flash', 'pop', 'scroll']) fx[key] = Math.max(0, fx[key] - dt);
}
export const fxBusy = (fx) => fx.flash > 0 || fx.pop > 0 || fx.scroll > 0;

function line(c, x, y, ex, ey, color, width) {
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
}
function kid(c, s, p, x, y, reduced) {
  const dropping = ['dropping', 'over'].includes(s.phase);
  const fall = dropping ? Math.min(1, s.elapsed / DROP_SECONDS) : 0;
  c.save();
  if (reduced && dropping) c.globalAlpha = 1 - fall;
  c.translate(x, y + (reduced ? 0 : fall * fall * PILLAR_H));
  if (!reduced && dropping) c.rotate(fall * Math.PI * 1.7);
  const stride = s.phase === 'walking' && !reduced ? (Math.floor(s.walk / 12) % 2 ? 4 : -4) : 2;
  line(c, -2, -12, -4 - stride, 0, p.pants, 4);
  line(c, 2, -12, 4 + stride, 0, p.pants, 4);
  line(c, -4 - stride, 0, -1 - stride, 0, p.boot, 4);
  line(c, 4 + stride, 0, 7 + stride, 0, p.boot, 4);
  line(c, 0, -24, 0, -12, p.coat, 10);
  line(c, -3, -22, -8, -13, p.coat, 4);
  line(c, 3, -22, 8, -16, p.coat, 4);
  c.beginPath(); c.arc(0, -32, 8, 0, Math.PI * 2); c.fillStyle = p.skin; c.fill();
  c.strokeStyle = p.ink; c.lineWidth = 1.2; c.stroke();
  c.beginPath(); c.arc(0, -34, 8, Math.PI, 0); c.fillStyle = p.hat; c.fill();
  c.fillStyle = p.ink; c.fillRect(3, -33, 2, 2);
  c.restore();
}
export function drawScene(c, s, p, fx = null, { reduced = false } = {}) {
  c.save();
  const sky = c.createLinearGradient(0, 0, 0, FIELD_H);
  sky.addColorStop(0, p['wall-top']); sky.addColorStop(1, p['wall-bot']);
  c.fillStyle = sky; c.fillRect(0, 0, FIELD_W, FIELD_H);
  const origin = s.current.x + s.current.width;
  const cameraTo = origin - 60;
  const camera = fx?.scroll && !reduced ? cameraTo + (fx.cameraFrom - cameraTo) * fx.scroll / 0.18 : cameraTo;
  for (const [y, period, parallax, opacity] of [[205, 150, 0.12, 0.15], [250, 110, 0.24, 0.22]]) {
    const offset = ((camera * parallax) % period + period) % period;
    c.fillStyle = p.pillar; c.globalAlpha = opacity;
    c.beginPath(); c.moveTo(-period, FIELD_H);
    for (let x = -period - offset; x < FIELD_W + period; x += period) { c.lineTo(x, y + 50); c.lineTo(x + period / 2, y); }
    c.lineTo(FIELD_W + period, FIELD_H); c.closePath(); c.fill();
  }
  c.globalAlpha = 1;
  const top = FIELD_H - PILLAR_H;
  for (const pillar of [s.current, s.next]) {
    const x = pillar.x - camera;
    c.fillStyle = p.pillar; c.fillRect(x, top, pillar.width, PILLAR_H);
    c.fillStyle = p['pillar-hi']; c.fillRect(x, top, pillar.width, 5);
  }
  const center = s.next.x + s.next.width / 2 - camera;
  line(c, center, top - 4, center, top + 7, p.red, 3);
  // 菱形與紅線一起提示中心，不只依靠顏色。
  c.fillStyle = p.red; c.beginPath(); c.moveTo(center, top - 14); c.lineTo(center + 4, top - 10); c.lineTo(center, top - 6); c.lineTo(center - 4, top - 10); c.closePath(); c.fill();
  if (fx?.flash && !reduced) {
    c.save(); c.globalAlpha = fx.flash / 0.2; c.strokeStyle = p['wood-hi']; c.lineWidth = 2;
    c.beginPath(); c.arc(center, top, 10 + 20 * (1 - fx.flash / 0.2), 0, Math.PI * 2); c.stroke(); c.restore();
  }
  if (s.bridgeLength > 0) {
    const angle = s.phase === 'growing' ? -Math.PI / 2 : s.phase === 'falling' ? -Math.PI / 2 * (1 - s.elapsed / FALL_SECONDS) : 0;
    c.save(); c.translate(origin - camera, top - 2); c.rotate(angle);
    c.fillStyle = p['wood-dark']; c.fillRect(0, -3, s.bridgeLength, 6);
    c.fillStyle = p.wood; c.fillRect(0, -2, s.bridgeLength, 3);
    c.fillStyle = p['wood-hi']; c.fillRect(0, -3, s.bridgeLength, 1); c.restore();
  }
  kid(c, s, p, origin + s.walk - camera, top - 3, reduced);
  c.fillStyle = p.hud; c.globalAlpha = 0.93; c.fillRect(16, 16, FIELD_W - 32, 38); c.globalAlpha = 1;
  c.fillStyle = p.text; c.textAlign = 'center'; c.font = '600 16px system-ui, sans-serif';
  c.fillText(s.phase === 'growing' ? `橋長 ${Math.round(s.bridgeLength)}` : comboText(s) || '按住搭橋 · 放開過橋', FIELD_W / 2, 40);
  if (fx?.pop && !reduced) {
    c.font = '800 25px system-ui, sans-serif'; c.lineWidth = 5; c.strokeStyle = p.hud;
    c.strokeText(comboText(s), FIELD_W / 2, 110); c.fillStyle = p.text; c.fillText(comboText(s), FIELD_W / 2, 110);
  }
  c.restore();
}
