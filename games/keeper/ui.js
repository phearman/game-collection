// 足球守門員畫面層:狀態、Canvas 繪製、輸入、動畫迴圈。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  DIFFICULTIES, PARAMS, SHOTS_MIN, SHOTS_MAX, SHOTS_DEFAULT, GOAL_HALF_W, GOAL_H, RUNUP_MS, ACTION_MS,
  initState, startShot, actState, stepState, pauseState, resumeState, isPlaying, canPause, keeperPose, reachHeight,
  lastResult, tally, movesOf, finishInfo, classifyGesture, normalizeShots, toSave, fromSave, isValidState, paramsFor,
} from './logic.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { load, save } from '../../shared/storage.js';

const GAME_ID = 'keeper';
const DIFF_KEY = 'difficulty:keeper'; // 上次選的難度(開新局用)
const SHOTS_KEY = 'shots:keeper'; // 上次選的球數
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, newAchievements, isBest, bestBefore, score, result };結算中為 { pending: true }
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面
let reveal = false; // 結束遮罩延後一下才出現,先讓最後一球的結果看得到
let frame = null; // requestAnimationFrame id
let lastT = 0;

// 紀錄寫入依序執行,避免存檔與結算交錯。
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

// 球沒在進行(開局、暫停)不算遊戲時間。
const timerPause = () => run(() => profile.setVisible(false));
const timerResume = () => run(() => { profile.setVisible(true); profile.input(); });

function prefs() {
  const d = load(DIFF_KEY, 'normal');
  return { difficulty: DIFFICULTIES.includes(d) ? d : 'normal', total: normalizeShots(load(SHOTS_KEY, SHOTS_DEFAULT)) };
}

async function startNew(opts = prefs()) {
  state = initState(opts);
  gameNo++;
  ended = null;
  reveal = false;
  render();
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID);
    profile.setVisible(false); // 開局等開始
  });
  render();
}

// 一局結束:結算每局只執行一次,結果顯示在遮罩。
function finish(info) {
  ended = { pending: true };
  const no = gameNo;
  setTimeout(() => {
    if (no !== gameNo) return;
    reveal = true;
    render();
  }, 900);
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await profile.finishPlay(GAME_ID, info);
    best = Math.max(best, info.score);
    if (no !== gameNo) return;
    ended = {
      xp: out.xpGained,
      newAchievements: out.newAchievements,
      isBest: out.play.is_best,
      bestBefore,
      score: info.score,
      result: info.result,
    };
    render();
  });
}

// 新遊戲(含切換難度、球數):未動不記錄、已動未結束 ⇒ quit。
function newGame(opts) {
  if (ended?.pending) return; // 結算中:忽略連點
  if (!ended) {
    const result = resultOnNewGame({ everWon: false, moves: movesOf(state) });
    if (result) finish({ ...finishInfo(state), result });
  }
  startNew(opts);
}

function begin() {
  if (ended) return;
  if (state.phase === 'ready') {
    state = startShot(state);
    timerResume();
  } else if (state.paused) {
    state = resumeState(state);
    timerResume();
  } else return;
  render();
}

function pause() {
  if (ended || !canPause(state)) return;
  state = pauseState(state);
  timerPause();
  render();
}

function togglePause() {
  if (state.paused || state.phase === 'ready') begin();
  else pause();
}

// 守門員動作;steps = 連續移動幾步(滑動距離決定)。
function act(a, steps = 1) {
  if (ended) return;
  profile.input();
  for (let i = 0; i < steps; i++) state = actState(state, a);
  draw();
}

// 時間前進;每踢完一球(log 變長)就存檔或結算。
// 玩家還沒有任何有效操作就不存檔(§4.2:零操作不記錄,也不留下存檔)。
function tick(now) {
  frame = null;
  const dt = Math.min(250, now - lastT);
  lastT = now;
  const before = state;
  state = stepState(state, dt);
  if (state.log.length > before.log.length) {
    if (state.phase === 'over') finish(finishInfo(state));
    else if (state.actions > 0) {
      const saved = toSave(state);
      run(() => profile.saveState(GAME_ID, saved));
    }
  }
  if (state.phase !== before.phase) render(); // 球數文字、暫停鈕隨階段更新
  else draw();
  syncLoop();
}

// 球進行中(含結果顯示)才跑動畫迴圈。
function syncLoop() {
  const want = !state.paused && ['wait', 'runup', 'flight', 'result'].includes(state.phase);
  if (want && !frame) {
    lastT = performance.now();
    frame = requestAnimationFrame(tick);
  }
  if (!want && frame) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

// ---- Canvas 繪製 ----

const W = 360;
const H = 420;
const CX = W / 2;
const GROUND = 200; // 門線(世界 y=0)在畫面上的高度
const SPOT = { x: CX, y: 360 }; // 罰球點
const canvas = $('field');
const ctx = canvas.getContext('2d');

function fitCanvas() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const sx = (x) => CX + x;
const sy = (y) => GROUND - y;

function drawPitch() {
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#3f8f3a' : '#47993f';
    ctx.fillRect(0, i * (H / 8), W, H / 8);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  ctx.lineTo(W, GROUND);
  ctx.moveTo(sx(-GOAL_HALF_W - 20), GROUND);
  ctx.lineTo(sx(-GOAL_HALF_W - 40), GROUND + 70);
  ctx.lineTo(sx(GOAL_HALF_W + 40), GROUND + 70);
  ctx.lineTo(sx(GOAL_HALF_W + 20), GROUND);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(SPOT.x, SPOT.y + 6, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawGoal() {
  const l = sx(-GOAL_HALF_W);
  const r = sx(GOAL_HALF_W);
  const top = sy(GOAL_H);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(l, top, r - l, GOAL_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = l + 15; x < r; x += 15) { ctx.moveTo(x, top); ctx.lineTo(x, GROUND); }
  for (let y = top + 14; y < GROUND; y += 14) { ctx.moveTo(l, y); ctx.lineTo(r, y); }
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(l, GROUND);
  ctx.lineTo(l, top);
  ctx.lineTo(r, top);
  ctx.lineTo(r, GROUND);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// 守門員:腳在離地 h,雙臂平舉在可及高度,手套間距 = 本難度水平容許值(判定範圍看得見)。
function drawKeeper(keeper, difficulty) {
  const { x, h } = keeperPose(keeper);
  const tol = paramsFor(difficulty).tolerance;
  const reach = reachHeight(h);
  const tilt = keeper.action === 'diveL' || keeper.action === 'diveR'
    ? (keeper.action === 'diveL' ? -1 : 1) * Math.sin(Math.PI * Math.min(1, keeper.at / ACTION_MS)) * 0.9
    : 0;
  ctx.save();
  ctx.translate(sx(x), sy(reach));
  ctx.rotate(tilt);
  const foot = reach - h; // 肩到腳的距離(=站立手高)
  ctx.strokeStyle = '#1c2a3a';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, 18); ctx.lineTo(-8, foot);
  ctx.moveTo(5, 18); ctx.lineTo(8, foot);
  ctx.stroke();
  ctx.fillStyle = '#f2b705';
  ctx.fillRect(-11, -4, 22, 26);
  ctx.strokeStyle = '#f2b705';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-10, 0); ctx.lineTo(-tol + 8, 0);
  ctx.moveTo(10, 0); ctx.lineTo(tol - 8, 0);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  for (const gx of [-tol + 6, tol - 6]) {
    ctx.beginPath();
    ctx.arc(gx, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c2a3a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = '#f1c9a5';
  ctx.beginPath();
  ctx.arc(0, -13, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineCap = 'butt';
}

// 射手:等待時站在球後,助跑時跑向球,起腳後停在球旁。
function drawShooter(s) {
  let p = 0;
  if (s.phase === 'runup') p = s.t / RUNUP_MS;
  else if (s.phase === 'flight' || s.phase === 'result' || s.phase === 'over') p = 1;
  const x = SPOT.x - 70 + 48 * p;
  const y = SPOT.y + 30 - 42 * p;
  const stride = s.phase === 'runup' ? Math.sin(s.t / 45) * 7 : 0;
  const kick = p === 1 && s.phase === 'flight' && s.t < 200 ? 12 : 0;
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 3, y); ctx.lineTo(x - 5 - stride, y + 20);
  ctx.moveTo(x + 3, y); ctx.lineTo(x + 6 + stride + kick, y + 20 - kick);
  ctx.stroke();
  ctx.fillStyle = '#d6453d';
  ctx.fillRect(x - 9, y - 22, 18, 24);
  ctx.fillStyle = '#f1c9a5';
  ctx.beginPath();
  ctx.arc(x, y - 30, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a3b1c';
  ctx.beginPath();
  ctx.arc(x, y - 33, 8, Math.PI, 0);
  ctx.fill();
  ctx.lineCap = 'butt';
}

// 球的位置:起腳點 → 目標點,中段略抬高;r 由近而遠變小。
function ballAt(target, p) {
  const tx = sx(target.x);
  const ty = sy(target.y);
  const lift = Math.sin(Math.PI * p) * 30;
  return { x: SPOT.x + (tx - SPOT.x) * p, y: SPOT.y + (ty - SPOT.y) * p - lift, r: 10 - 4 * p };
}

function drawBall({ x, y, r }) {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrail(target) {
  ctx.strokeStyle = 'rgba(255, 230, 120, 0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const b = ballAt(target, i / 20);
    if (i === 0) ctx.moveTo(b.x, b.y);
    else ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function banner(text, color) {
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, CX, 280);
  ctx.fillStyle = color;
  ctx.fillText(text, CX, 280);
}

function draw() {
  const s = state;
  drawPitch();
  drawGoal();
  const shot = s.shot;
  const showResult = (s.phase === 'result' || s.phase === 'over') && lastResult(s);
  if (showResult === 'goal' && shot) drawTrail(shot.target);
  drawKeeper(s.keeper, s.difficulty);
  drawShooter(s);
  if (s.phase === 'flight' && shot) drawBall(ballAt(shot.target, s.t / PARAMS[s.difficulty].flight));
  else if (showResult === 'goal' && shot) drawBall(ballAt(shot.target, 1));
  else if (showResult === 'save' && shot) {
    // 撲到:球被擋出,往門外彈開
    const b = ballAt(shot.target, 1);
    const k = Math.min(1, s.t / 500);
    drawBall({ x: b.x + (shot.target.x >= 0 ? 1 : -1) * 40 * k, y: b.y + 50 * k, r: b.r });
  } else drawBall({ x: SPOT.x, y: SPOT.y, r: 10 });
  if (showResult === 'save') banner('撲到了!', '#7ef09a');
  if (showResult === 'goal') banner('GOAL!', '#ff8a7a');
}

// ---- 畫面(DOM)----

function render() {
  const t = tally(state.log);
  $('score').textContent = t.score.toLocaleString();
  $('best').textContent = Math.max(best, t.score).toLocaleString();
  $('difficulty').value = state.difficulty;
  $('shots').value = String(state.total);
  const shotNo = Math.min(state.total, state.log.length + (['result', 'over'].includes(state.phase) ? 0 : 1));
  $('tally').textContent = `第 ${shotNo} / ${state.total} 球 · 撲救 ${t.saves} / 失分 ${t.conceded}`;
  const pauseBtn = $('pause');
  pauseBtn.textContent = state.phase === 'ready' ? '▶ 開始' : state.paused ? '▶ 繼續' : '⏸ 暫停';
  pauseBtn.disabled = !!ended || state.phase === 'over';
  document.querySelectorAll('.pad-btn').forEach((b) => { b.disabled = !!ended; });
  renderOverlay();
  draw();
  syncLoop();
}

// 成就 id 可能來自匯入檔:只顯示白名單名稱,其餘一律 escape。
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const achName = (id) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return esc(a ? `${a.icon} ${a.name}` : id);
};

function infoHtml() {
  const t = tally(state.log);
  const lines = [`<p>撲救 ${t.saves} / 失分 ${t.conceded} · 最長連續撲救 ${t.bestStreak}</p>`];
  if (ended.pending) return `${lines.join('')}<p>結算中…</p>`;
  lines.push(`<p class="overlay-xp">本局 +${ended.xp} XP</p>`);
  if (ended.newAchievements.length) lines.push(`<p>新成就:${ended.newAchievements.map(achName).join('、')}</p>`);
  if (ended.isBest) lines.push('<p>🎉 新的最佳分數!</p>');
  else if (ended.bestBefore > 0) {
    lines.push(`<p>距最佳 ${ended.bestBefore.toLocaleString()} 還差 ${(ended.bestBefore - ended.score).toLocaleString()}</p>`);
  }
  return lines.join('');
}

let shown = null;
function renderOverlay() {
  const overlay = $('overlay');
  let kind = null;
  if (state.phase === 'over') kind = reveal ? 'over' : null;
  else if (state.phase === 'ready') kind = 'ready';
  else if (state.paused) kind = 'paused';
  const sig = `${gameNo}|${state.total}|${kind}|${ended ? (ended.pending ? 'p' : 'd') : ''}|${state.log.length}`;
  if (sig === shown) return;
  shown = sig;
  const actions = $('overlay-actions');
  if (kind === 'ready') {
    const first = state.log.length === 0;
    $('overlay-title').textContent = first ? '準備開始' : '繼續比賽';
    $('overlay-info').innerHTML = `<p>${first ? `本回合 ${state.total} 球` : `接著踢第 ${state.log.length + 1} / ${state.total} 球`}</p><p>按空白鍵或「開始」</p>`;
    actions.innerHTML = '<button class="btn" data-act="begin">▶ 開始</button>';
  } else if (kind === 'paused') {
    $('overlay-title').textContent = '已暫停';
    $('overlay-info').innerHTML = '<p>按 P、空白鍵或「繼續」接著玩</p>';
    actions.innerHTML = '<button class="btn" data-act="begin">▶ 繼續</button>';
  } else if (kind === 'over') {
    const win = finishInfo(state).result === 'win';
    $('overlay-title').textContent = win ? '守住了!' : '失守了';
    $('overlay-info').innerHTML = infoHtml();
    actions.innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
  } else {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
}

// ---- 輸入 ----

const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump',
  a: 'left', d: 'right', w: 'jump', z: 'diveL', x: 'diveR',
};

const dialogOpen = () => document.querySelector('dialog[open]');

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || dialogOpen()) return;
  if (e.target instanceof HTMLSelectElement) return; // 選單用方向鍵切換選項
  if (e.key === ' ') {
    e.preventDefault(); // 空白鍵只用來開始,不觸發焦點所在的按鈕
    profile.input();
    begin();
    return;
  }
  if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (ended) return;
    profile.input();
    togglePause();
    return;
  }
  const a = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!a) return;
  e.preventDefault();
  act(a);
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && !(e.target instanceof HTMLSelectElement) && !dialogOpen()) e.preventDefault();
});

// 觸控手勢綁在球場:放開時依位移與時間分類(規則見 logic.classifyGesture)。
let touch = null;
const wrap = $('board-wrap');
wrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  const rect = canvas.getBoundingClientRect();
  touch = { x: e.clientX, y: e.clientY, t: performance.now(), upper: e.clientY - rect.top < rect.height / 2 };
});
wrap.addEventListener('pointerup', (e) => {
  if (!touch) return;
  const g = classifyGesture({ dx: e.clientX - touch.x, dy: e.clientY - touch.y, ms: performance.now() - touch.t, upper: touch.upper });
  touch = null;
  if (g && isPlaying(state)) act(g.act, g.steps ?? 1);
});
wrap.addEventListener('pointercancel', () => { touch = null; });
wrap.addEventListener('contextmenu', (e) => e.preventDefault()); // 手機長按不跳選單

document.querySelector('.pad').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act);
});

// 分頁隱藏自動暫停。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pause();
});

$('new').addEventListener('click', () => newGame());
$('pause').addEventListener('click', () => {
  profile.input();
  togglePause();
});

const shotsSel = $('shots');
for (let n = SHOTS_MIN; n <= SHOTS_MAX; n++) shotsSel.add(new Option(`${n} 球`, String(n)));

function changeOption(e, key, value, opts) {
  if (ended?.pending) {
    render(); // 結算中:選單還原
    return;
  }
  save(key, value);
  newGame(opts);
  e.target.blur();
}
$('difficulty').addEventListener('change', (e) => {
  const d = e.target.value;
  changeOption(e, DIFF_KEY, d, { difficulty: d, total: state.total });
});
shotsSel.addEventListener('change', (e) => {
  const n = normalizeShots(Number(e.target.value));
  changeOption(e, SHOTS_KEY, n, { difficulty: state.difficulty, total: n });
});
$('overlay-actions').addEventListener('click', (e) => {
  const a = e.target.dataset.act;
  if (a === 'new') newGame();
  if (a === 'begin') {
    profile.input();
    begin();
  }
});

bindThemeToggle($('theme'));
fitCanvas();
window.addEventListener('resize', () => { fitCanvas(); draw(); });

// 載入:有存檔就自動還原到下一球開始前,否則開新局。
const saved = await profile.loadSave(GAME_ID);
if (saved && isValidState(saved)) {
  state = fromSave(saved);
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  profile.setVisible(false);
  render();
} else {
  await startNew();
}

// ---- 說明與示範:每一步都由 logic 實算(球飛到門線那一刻判定)----

// 球還差 remain 毫秒到門線的局面(普通難度)。
const demoState = (target, remain, x = 0) => ({
  ...initState({ difficulty: 'normal', total: 3 }),
  phase: 'flight',
  t: PARAMS.normal.flight - remain,
  shot: { wait: 0, target },
  keeper: { x, action: null, at: 0, from: x },
});
const demoStep = (before, acts, remain, caption, result) => {
  let s = before;
  for (const a of acts) s = actState(s, a);
  return { before, after: stepState(s, remain), caption, result };
};

function demoSvg(s) {
  const { x, h } = keeperPose(s.keeper);
  const tol = paramsFor(s.difficulty).tolerance;
  const reach = reachHeight(h);
  const r = s.phase === 'flight' ? null : lastResult(s);
  const p = s.phase === 'flight' ? s.t / PARAMS.normal.flight : 1;
  const tx = 180 + s.shot.target.x;
  const ty = 160 - s.shot.target.y;
  const bx = 180 + (tx - 180) * p;
  const by = 230 + (ty - 230) * p;
  const label = r === 'save' ? '<text x="180" y="210" fill="#7ef09a" font-size="24" font-weight="700" text-anchor="middle">撲到了!</text>'
    : r === 'goal' ? '<text x="180" y="210" fill="#ff8a7a" font-size="24" font-weight="700" text-anchor="middle">GOAL!</text>' : '';
  return `<svg class="demo-field" viewBox="0 0 360 240" role="img" aria-label="示範">
    <rect width="360" height="240" fill="#3f8f3a"/>
    <rect x="30" y="20" width="300" height="140" fill="rgba(255,255,255,0.12)" stroke="#fff" stroke-width="5"/>
    <line x1="0" y1="160" x2="360" y2="160" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>
    <line x1="${180 + x}" y1="${160 - h}" x2="${180 + x}" y2="${160 - reach}" stroke="#1c2a3a" stroke-width="8"/>
    <line x1="${180 + x - tol + 6}" y1="${160 - reach}" x2="${180 + x + tol - 6}" y2="${160 - reach}" stroke="#f2b705" stroke-width="6"/>
    <circle cx="${180 + x - tol + 6}" cy="${160 - reach}" r="7" fill="#fff"/>
    <circle cx="${180 + x + tol - 6}" cy="${160 - reach}" r="7" fill="#fff"/>
    <circle cx="${180 + x}" cy="${160 - reach - 14}" r="9" fill="#f1c9a5"/>
    <circle cx="${bx}" cy="${by}" r="8" fill="#fff" stroke="#222" stroke-width="1.5"/>
    ${label}
  </svg>`;
}

const half = ACTION_MS / 2;
setupHelp({
  gameId: GAME_ID,
  title: '足球守門員玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>小朋友會隨機等一下再射門,球飛向球門內任一點。</li>
      <li>← →/左右滑移動;↑/點上半跳;Z X/往左上右上快滑/「◀ 撲」「撲 ▶」撲救。</li>
      <li>球到門線那一刻,手套範圍碰到球就撲到,否則進球。</li>
      <li>高球要跳、遠的球要移動或撲;太早跳會落地撲空。</li>
      <li>難度越高等待越短、球越快、手套範圍越小,XP 越多。</li>
      <li>勝利條件:撲到過半(≥ 一半球數);分數 = 撲到數 ×100 + 最長連續撲救 ×50。</li>
    </ol>`,
  demo: {
    render: demoSvg,
    steps: [
      demoStep(demoState({ x: 80, y: 40 }, 300), ['right', 'right'], 300,
        '球往右邊低處飛來,往右移兩步…', '…手套碰到球:撲到了!'),
      demoStep(demoState({ x: -120, y: 60 }, 300), [], 300,
        '球往左邊角落飛,守門員站著不動…', '…搆不到:進球(GOAL!)'),
      demoStep(demoState({ x: 0, y: 115 }, half), ['jump'], half,
        '高球!在球到之前跳起…', '…跳到最高點剛好碰到:撲到了!'),
      demoStep(demoState({ x: 0, y: 115 }, 50), [], 50,
        '同樣的高球,站著不跳…', '…手搆不到那麼高:進球'),
      demoStep(demoState({ x: 70, y: 90 }, half), ['diveR'], half,
        '球往右上飛,按「撲 ▶」…', '…撲過去攔住:撲到了!'),
    ],
  },
});
// 打開說明時先暫停,避免背後一直進球。
document.querySelector('.topbar .btn').nextElementSibling.addEventListener('click', pause);
