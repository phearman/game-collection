// 畫面層:事件、固定步長迴圈與紀錄串接;規則只呼叫 logic.js。
import {
  W, H, DT, DIFFICULTIES, MODES, initState, stepState, pauseState, resumeState,
  overlayFor, playerOf, resultFor, toSave, fromSave, isValidGhost, ghostFor, betterGhost, ghostAt,
} from './logic.js?v=53ac788';
import { drawScene, readPalette, createFx, fxEvents, fxUpdate, fxBusy, endingDone } from './draw.js?v=53ac788';
import { createProfile } from '../../shared/profile.js?v=53ac788';
import { LocalStore } from '../../shared/stores/local.js?v=53ac788';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js?v=53ac788';
import { bindThemeToggle } from '../../shared/theme.js?v=53ac788';
import { play } from '../../shared/sound.js?v=53ac788';
import { setupHelp } from '../../shared/help.js?v=53ac788';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=53ac788';
import { settlePlay } from '../../shared/settle.js?v=53ac788';
import { load, save } from '../../shared/storage.js?v=53ac788';

const GAME_ID = 'moto';
const SAVE_EVERY = 30;
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let state, best = 0, ended = null, ghost = null, fx = createFx();
let gameNo = 0, changing = false;
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };
const pref = (key, choices, fallback) => {
  const value = load(`${key}:${GAME_ID}`, fallback);
  return choices.includes(value) ? value : fallback;
};

// 影子跑法使用規格指定的原始鍵;不透過 profile 或通用 storage 的前綴。
function readGhost(difficulty) {
  try {
    const g = JSON.parse(localStorage.getItem(`moto:ghost:${difficulty}`));
    return isValidGhost(g) ? g : null;
  } catch { return null; }
}
function writeGhost(s) {
  const old = readGhost(s.difficulty), candidate = ghostFor(s);
  const next = betterGhost(old, candidate);
  if (next !== candidate) return;
  try { localStorage.setItem(`moto:ghost:${s.difficulty}`, JSON.stringify(next)); } catch { /* 無儲存空間仍能完賽 */ }
}

function persist() {
  if (!state.moves || state.over || ended) return;
  const saved = toSave(state);
  run(() => profile.saveState(GAME_ID, saved));
}
async function startNew(difficulty = pref('difficulty', DIFFICULTIES, 'normal'), mode = pref('mode', MODES, 'race')) {
  state = initState(Math.random, difficulty, mode);
  fx = createFx(); ended = null; gameNo++; clearInput();
  ghost = mode === 'time' ? readGhost(difficulty) : null;
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID); profile.setVisible(false);
  });
  render();
}

// 同一局結算只有一個 Promise;新局等存檔/結算佇列清空後再開始。
function finish(quit = false) {
  if (ended) return queue;
  const snap = structuredClone(state), args = resultFor(snap, quit), no = gameNo;
  ended = { pending: true }; clearInput();
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, args);
    if (no !== gameNo) return;
    if (!out) { ended = { abandoned: true }; render(); return; }
    if (!quit && snap.mode === 'time') writeGhost(snap);
    best = await profile.best(GAME_ID);
    ended = { ...args, xp: out.xpGained, xpBreakdown: out.xpBreakdown, newAchievements: out.newAchievements,
      isBest: out.play.is_best, bestBefore };
    render();
  }).then(async () => {
    if (no === gameNo && ended?.abandoned && !quit && !changing) await startNew(snap.difficulty, snap.mode);
  });
}
async function newGame(difficulty = state.difficulty, mode = state.mode) {
  if (changing || ended?.pending) { render(); return; }
  changing = true;
  pause();
  if (!ended) {
    const result = resultOnNewGame({ everWon: false, moves: state.moves });
    if (result) await finish(true);
    else await run(() => profile.discardSave(GAME_ID));
  }
  save('difficulty:moto', difficulty); save('mode:moto', mode);
  await startNew(difficulty, mode);
  changing = false;
  render();
}
function pause() {
  clearInput();
  if (state.paused || state.over || ended) return;
  state = pauseState(state); persist();
  run(() => profile.setVisible(false)); render();
}
function resume() {
  if (!state.paused || state.over || ended || document.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return;
  clearInput(); state = resumeState(state);
  if (state.ticks === 0 && state.countdown > 0) play('countdown');
  run(() => { profile.setVisible(true); profile.input(); }); render();
}
function togglePause() { if (state.paused) resume(); else pause(); }

const held = new Map(); // 來源(實體鍵 / pointerId) → 油門或煞車
let pendingDir = 0, lastInput = 0;
const noteInput = () => { profile.input(); lastInput = performance.now(); };
function clearInput() {
  held.clear(); pendingDir = 0;
  document.querySelectorAll('[data-control]').forEach((b) => b.classList.remove('held'));
}
const acceptsInput = () => !changing && !ended && !state.paused && !state.over && state.countdown === 0;
function press(src, action) {
  if (!acceptsInput()) return; // 倒數中按住的鍵也不帶入起跑。
  noteInput();
  if (action === 'left' || action === 'right') pendingDir = action === 'left' ? -1 : 1;
  else held.set(src, action);
}
function release(src) { held.delete(src); }

let running = false, last = 0, acc = 0;
const playing = () => !changing && !state.paused && !state.over && !ended;
function frame(t) {
  if (!playing() && !fxBusy(fx)) { running = false; return; }
  const dt = Math.max(0, Math.min(0.25, (t - last) / 1000)); last = t;
  if (playing()) {
    acc += dt;
    if (held.size && t - lastInput >= 1000) noteInput();
    while (acc >= DT && playing()) {
      acc -= DT;
      const prev = state;
      state = stepState(state, {
        throttle: [...held.values()].includes('throttle'), brake: [...held.values()].includes('brake'), dir: pendingDir,
      }, DT);
      pendingDir = 0;
      if (Math.ceil(state.countdown) < Math.ceil(prev.countdown)) play(state.countdown > 0 ? 'countdown' : 'go');
      if (playerOf(state).crash > playerOf(prev).crash) play('crash');
      if (state.over && !prev.over) play('win');
      fxEvents(fx, prev, state, { reduced: reduced.matches });
      if (state.over) finish();
      else if (state.ticks % SAVE_EVERY === 0) persist();
    }
  }
  fxUpdate(fx, dt); render(); requestAnimationFrame(frame);
}
function syncLoop() {
  if (running || (!playing() && !fxBusy(fx))) return;
  running = true; last = performance.now(); acc = 0; requestAnimationFrame(frame);
}

const canvas = $('field'), ctx = canvas.getContext('2d');
let pal;
const readColors = () => { pal = readPalette(getComputedStyle(document.documentElement)); };
function draw() {
  if (!state || !pal || !canvas.width) return;
  const scale = canvas.width / W; ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawScene(ctx, state, pal, fx, { reduced: reduced.matches, ghost: ghostAt(ghost, state.time) });
}
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr)); draw();
}
function paragraph(container, text, className = '') {
  if (!text) return;
  const p = document.createElement('p'); p.className = className; p.textContent = text; container.append(p);
}
let overlaySignature = '';
function renderOverlay() {
  let kind = overlayFor(state);
  if (kind === 'over' && !endingDone(fx)) kind = null;
  const signature = `${gameNo}|${kind}|${ended?.pending ? 'pending' : ended ? 'done' : ''}`;
  if (signature === overlaySignature) return;
  overlaySignature = signature;
  $('overlay').hidden = kind === null;
  if (!kind) return;
  const info = $('overlay-info'), actions = $('overlay-actions'); info.replaceChildren(); actions.replaceChildren();
  const button = document.createElement('button'); button.className = 'btn'; button.type = 'button';
  if (kind === 'ready' || kind === 'paused') {
    $('overlay-title').textContent = kind === 'ready' ? '準備出發' : '已暫停';
    paragraph(info, kind === 'ready' ? '倒數後按住油門,用左右鍵閃障礙' : '繼續後按住油門接著跑');
    if (state.mode === 'time') paragraph(info, ghost ? `影子最佳 ${(ghost.ms / 1000).toFixed(2)} 秒` : '完賽後留下你的第一台影子車');
    button.textContent = kind === 'ready' ? '▶ 開始' : '▶ 繼續'; button.dataset.act = 'resume';
  } else {
    $('overlay-title').textContent = ended?.result === 'win' ? (state.mode === 'time' ? '完賽!' : '第一名!') : '比賽結束';
    if (ended?.pending) paragraph(info, '結算中…');
    else if (ended?.abandoned) paragraph(info, '本局紀錄未儲存');
    else if (ended) {
      paragraph(info, `${state.mode === 'race' ? `第 ${ended.detail.place} 名 · ` : ''}${(ended.detail.ms / 1000).toFixed(2)} 秒`);
      paragraph(info, `${ended.score.toLocaleString()} 分 · 本局 +${ended.xp} XP`, 'overlay-xp');
      appendXpBreakdown(info, ended.xpBreakdown);
      if (ended.newAchievements.length) paragraph(info, `新成就:${ended.newAchievements.map((id) => {
        const a = ACHIEVEMENTS.find((x) => x.id === id); return a ? `${a.icon} ${a.name}` : id;
      }).join('、')}`);
      paragraph(info, bestLine(ended));
    }
    button.textContent = '再玩一次'; button.dataset.act = 'new'; button.disabled = !!ended?.pending;
  }
  actions.append(button);
}
let statusSignature = '';
function render() {
  if (!state) return;
  $('score').textContent = state.over ? resultFor(state).score.toLocaleString() : '0';
  $('best').textContent = best.toLocaleString();
  $('mode').value = state.mode; $('difficulty').value = state.difficulty;
  $('pause').textContent = state.paused ? '▶' : '⏸';
  $('pause').setAttribute('aria-label', state.paused ? '開始或繼續' : '暫停');
  $('pause').disabled = !!ended || state.over;
  for (const id of ['new', 'mode', 'difficulty']) $(id).disabled = changing || !!ended?.pending;
  document.querySelectorAll('[data-control]').forEach((b) => {
    b.disabled = !acceptsInput();
    b.classList.toggle('held', [...held.values()].includes(b.dataset.control));
  });
  const player = playerOf(state);
  const status = `${state.paused ? '已暫停' : state.countdown ? `倒數 ${Math.ceil(state.countdown)}` : player.crash ? '摔車' : player.air ? '騰空' : player.mud ? '泥坑減速' : '騎乘中'} · 進度 ${Math.floor(player.y / 100) * 100}`;
  if (status !== statusSignature) { $('status').textContent = status; statusSignature = status; }
  draw(); renderOverlay(); syncLoop();
}

const KEYS = { ArrowUp: 'throttle', w: 'throttle', ArrowDown: 'brake', s: 'brake', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || e.target instanceof HTMLSelectElement) return;
  if (e.key.toLowerCase() === 'p') {
    e.preventDefault(); if (!e.repeat) { noteInput(); togglePause(); } return;
  }
  const action = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault(); if (!e.repeat) press(`key:${e.code}`, action);
});
document.addEventListener('keyup', (e) => release(`key:${e.code}`));
window.addEventListener('blur', pause);
document.querySelectorAll('[data-control]').forEach((b) => {
  const action = b.dataset.control;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !acceptsInput()) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真指標 */ }
    press(`pointer:${e.pointerId}`, action); render();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(event, (e) => { release(`pointer:${e.pointerId}`); render(); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); if (!e.repeat) { press(`button:${action}`, action); render(); }
  });
  b.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); release(`button:${action}`); render();
  });
  b.addEventListener('blur', () => { release(`button:${action}`); render(); });
  b.addEventListener('click', (e) => {
    if (e.detail !== 0 || !acceptsInput() || held.has(`button:${action}`)) return;
    press('assistive', action); setTimeout(() => { release('assistive'); render(); }, 200); render();
  });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pause(); });
window.addEventListener('pagehide', () => { pause(); persist(); });
$('pause').addEventListener('click', togglePause);
$('new').addEventListener('click', () => newGame());
$('mode').addEventListener('change', (e) => newGame(state.difficulty, e.target.value));
$('difficulty').addEventListener('change', (e) => newGame(e.target.value, state.mode));
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'resume') resume(); if (act === 'new') newGame();
});
bindThemeToggle($('theme'));
$('theme').addEventListener('click', () => { readColors(); draw(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
readColors(); new ResizeObserver(resize).observe(canvas);

const saved = await profile.loadSave(GAME_ID);
if (saved) {
  state = fromSave(saved); gameNo++;
  ghost = state.mode === 'time' ? readGhost(state.difficulty) : null;
  best = await profile.best(GAME_ID); profile.startTimer(GAME_ID); profile.setVisible(false); render();
} else await startNew();
resize();

// 示範初始場面為教學固定題;結果、速度與摔車/騰空都由 stepState 計算。
const demoState = (track) => {
  const s = initState(() => 0.4, 'normal', 'time');
  return { ...s, paused: false, countdown: 0, track, vehicles: [{ ...playerOf(s), y: 50, speed: 42 }] };
};
const demoRun = (s, count) => { for (let i = 0; i < count; i++) s = stepState(s, { throttle: true }); return s; };
const obstacle = (id, y, kind, length) => ({ id, lane: 0, y, kind, length });
function demoImage(s) {
  const c = document.createElement('canvas'); c.width = W * 40; c.height = H * 40;
  const g = c.getContext('2d'); g.setTransform(40, 0, 0, 40, 0, 0);
  drawScene(g, s, pal, null, { reduced: true });
  return `<img class="demo-field" src="${c.toDataURL()}" alt="機車示範場面">`;
}
const crashDemo = demoState([obstacle(0, 51, 'barrier', 5)]);
const jumpDemo = demoState([obstacle(0, 51, 'ramp', 7), obstacle(1, 62, 'barrier', 5)]);
const mudDemo = demoState([obstacle(0, 51, 'mud', 22)]);
document.addEventListener('helpopen', pause);
setupHelp({
  gameId: GAME_ID, title: '越野機車玩法', mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>
    <li>↑ W／油門按住加速;↓ S／煞車按住減速。</li>
    <li>← → A D／◀ ▶按一下換道;放開油門會慢慢減速。</li>
    <li>泥坑限速一半;路障摔車停1.2秒;跳台騰空可飛越障礙,空中不能換道。</li>
    <li>⏸／P暫停;開說明、離開分頁也暫停。</li>
    <li>競速與3台電腦車比;計時賽挑戰同難度最佳影子。</li>
    <li>競速第一名／計時賽完賽獲勝;分數=名次分／1000+剩餘150秒×10。</li>
  </ol>`,
  demo: { render: demoImage, steps: [
    { before: crashDemo, after: demoRun(crashDemo, 3), kind: 'fail', caption: '地面直撞木欄…', result: '…摔車停住,等1.2秒再加速' },
    { before: jumpDemo, after: demoRun(jumpDemo, 28), kind: 'ok', caption: '先騎上跳台…', result: '…騰空飛越木欄,速度不受影響' },
    { before: mudDemo, after: demoRun(mudDemo, 15), caption: '油門按住通過泥坑…', result: '…最高速度只有一半,出泥坑再加速' },
  ] },
});
