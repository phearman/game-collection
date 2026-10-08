// 足球守門員畫面層:狀態、Canvas 繪製、輸入、動畫迴圈。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  DIFFICULTIES, PARAMS, SHOTS_MIN, SHOTS_MAX, SHOTS_DEFAULT, ACTION_MS, FIELD_W,
  initState, startShot, actState, stepState, pauseState, resumeState, isPlaying, canPause, setMove, moveTo, isDrag, dragX,
  tally, movesOf, finishInfo, classifyGesture, normalizeShots, toSave, fromSave, isValidState,
} from './logic.js';
import { FIELD_H, drawScene, readPalette, createFx, fxEvents, fxUpdate, fxBusy } from './draw.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js';
import { settlePlay } from '../../shared/settle.js';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js';
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
let fx = createFx(); // 畫面特效(RS12;不進存檔)
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

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
  fx = createFx();
  held.clear();
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
    const out = await settlePlay(profile, GAME_ID, info);
    if (!out) { if (no === gameNo) startNew(); return; } // 結算失敗且選「不存了」:不記錄、開新局(IR6)
    if (out.play.is_best) best = Math.max(best, info.score);
    if (no !== gameNo) return;
    ended = {
      xp: out.xpGained,
      xpBreakdown: out.xpBreakdown,
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
let confirmingQuit = false;
async function newGame(opts) {
  if (confirmingQuit) return;
  if (ended?.pending) return; // 結算中:忽略連點
  if (!ended) {
    const result = resultOnNewGame({ everWon: false, moves: movesOf(state) });
    const note = { score: finishInfo(state).score, best, assist: state.assist };
    if (result === 'quit' && needsQuitBestConfirm(note)) {
      confirmingQuit = true;
      const running = !state.paused && ['wait', 'runup', 'flight', 'result'].includes(state.phase);
      if (running) timerPause();
      syncLoop();
      const quit = await confirmQuitBest(note);
      confirmingQuit = false;
      if (!quit) {
        render(); // 難度、球數選單還原
        if (running && document.visibilityState !== 'hidden' && !state.paused) timerResume();
        return;
      }
    }
    if (result) finish({ ...finishInfo(state), result });
  }
  if (opts) { save(DIFF_KEY, opts.difficulty); save(SHOTS_KEY, opts.total); }
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
  const dt = Math.max(0, Math.min(250, now - lastT));
  lastT = now;
  const before = state;
  if (!confirmingQuit) state = stepState(state, dt); // 確認框期間只播特效,規則不推進(K1)
  fxEvents(fx, before, state, { reduced: reducedMotion.matches });
  fxUpdate(fx, dt, state);
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

// 球進行中(含結果顯示)、或特效還沒播完時才跑動畫迴圈。
function syncLoop() {
  const want = (!confirmingQuit && !state.paused && ['wait', 'runup', 'flight', 'result'].includes(state.phase)) || fxBusy(fx);
  if (want && !frame) {
    lastT = performance.now();
    frame = requestAnimationFrame(tick);
  }
  if (!want && frame) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

// ---- Canvas 繪製(美術在 draw.js)----

const canvas = $('field');
const ctx = canvas.getContext('2d');
let pal = {};
const readColors = () => { pal = readPalette(getComputedStyle(document.documentElement)); };

function fitCanvas() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(FIELD_W * dpr);
  canvas.height = Math.round(FIELD_H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  if (!state) return;
  drawScene(ctx, state, pal, fx, { reduced: reducedMotion.matches });
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
  lines.push(`<p class="overlay-xp">本局 +${ended.xp} XP</p>`, xpBreakdownHtml(ended.xpBreakdown));
  if (ended.newAchievements.length) lines.push(`<p>新成就:${ended.newAchievements.map(achName).join('、')}</p>`);
  lines.push(bestLineHtml(ended));
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

const KEYS = { ArrowUp: 'jump', w: 'jump', z: 'diveL', x: 'diveR' };
const MOVE_KEYS = { ArrowLeft: -1, ArrowRight: 1, a: -1, d: 1 };

// 按住移動:鍵盤 ← →、畫面 ◀ ▶ 都記在 held(來源 → 方向),最後按下的優先;全部放開就停。
const held = new Map();
function syncMove() {
  const dir = held.size ? [...held.values()].at(-1) : 0;
  const next = setMove(state, dir);
  if (next === state) return;
  if (dir && isPlaying(state)) profile.input();
  state = next;
}
function hold(src, dir) {
  if (ended) return;
  held.delete(src);
  held.set(src, dir);
  syncMove();
}
function release(src) {
  if (!held.delete(src)) return;
  syncMove();
}

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
  const m = MOVE_KEYS[e.key] ?? MOVE_KEYS[e.key.toLowerCase()];
  if (m) {
    e.preventDefault();
    if (!e.repeat) hold(`key:${e.key.toLowerCase()}`, m);
    return;
  }
  const a = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!a) return;
  e.preventDefault();
  act(a);
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && !(e.target instanceof HTMLSelectElement) && !dialogOpen()) e.preventDefault();
  if (MOVE_KEYS[e.key] ?? MOVE_KEYS[e.key?.toLowerCase()]) release(`key:${e.key.toLowerCase()}`);
});
window.addEventListener('blur', () => { held.clear(); syncMove(); });

// 觸控手勢綁在球場:按住水平拖 ⇒ 守門員即時跟著手指(RS12);其餘放開時分類(點上半跳、斜上快滑撲,規則見 logic)。
let touch = null;
const wrap = $('board-wrap');
wrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  const rect = canvas.getBoundingClientRect();
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), upper: e.clientY - rect.top < rect.height / 2, startX: state.keeper.x, drag: false, width: rect.width };
  try { wrap.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真的指標,略過 */ }
});
wrap.addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id || ended) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  if (!touch.drag && isDrag({ dx, dy })) touch.drag = true;
  if (!touch.drag) return;
  const next = moveTo(state, dragX(touch.startX, dx, touch.width));
  if (next === state) {
    if (state.keeper.action) { touch.startX = state.keeper.x; touch.x = e.clientX; } // 撲救中:落地後從手指現在的位置接著拖
    return;
  }
  profile.input();
  state = next;
  draw();
});
wrap.addEventListener('pointerup', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  const t = touch;
  touch = null;
  const g = classifyGesture({ dx: e.clientX - t.x, dy: e.clientY - t.y, ms: performance.now() - t.t, upper: t.upper });
  const flick = g && (g.act === 'diveL' || g.act === 'diveR');
  if (t.drag && !flick) return; // 拖曳已即時移動,放開不再判定;但整段手勢符合快撲時,快撲優先(K3)
  if (g && isPlaying(state)) act(g.act, g.steps ?? 1);
});
wrap.addEventListener('pointercancel', () => { touch = null; });
wrap.addEventListener('contextmenu', (e) => e.preventDefault()); // 手機長按不跳選單

const pad = document.querySelector('.pad');
pad.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act);
});
// ◀ ▶:按住移動、放開(或手指滑出、取消)停止
for (const b of pad.querySelectorAll('[data-move]')) {
  const src = `pad:${b.dataset.move}`;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真的指標,略過 */ }
    hold(src, Number(b.dataset.move));
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => release(src));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}

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

function changeOption(e, opts) {
  if (ended?.pending) {
    render(); // 結算中:選單還原
    return;
  }
  newGame(opts);
  e.target.blur();
}
$('difficulty').addEventListener('change', (e) => {
  const d = e.target.value;
  changeOption(e, { difficulty: d, total: state.total });
});
shotsSel.addEventListener('change', (e) => {
  const n = normalizeShots(Number(e.target.value));
  changeOption(e, { difficulty: state.difficulty, total: n });
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
$('theme').addEventListener('click', () => { readColors(); draw(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
readColors();
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

// 示範圖:用遊戲同一套繪圖(draw.js)畫成圖片,美術與實際畫面一致。
function demoSvg(s) {
  const c = document.createElement('canvas');
  c.width = FIELD_W;
  c.height = FIELD_H;
  drawScene(c.getContext('2d'), s, pal, null, { reduced: true });
  return `<img class="demo-field" src="${c.toDataURL()}" alt="示範">`;
}

const half = ACTION_MS / 2;
setupHelp({
  gameId: GAME_ID,
  title: '足球守門員玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>小朋友會隨機等一下再射門,球飛向球門內任一點。</li>
      <li>按住 ← →/「◀」「▶」連續移動,或在球場上按住左右拖;↑/點上半跳;Z X/往左上右上快滑/「◀ 撲」「撲 ▶」撲救。</li>
      <li>球到門線那一刻,球在虛線框(手套範圍)裡就撲到,否則進球;看地上的球影子判斷球往哪飛。</li>
      <li>高球要跳、遠的球要移動或撲;太早跳會落地撲空。</li>
      <li>難度越高等待越短、球越快、手套範圍越小,XP 越多。</li>
      <li>勝利條件:撲到過半(≥ 一半球數);分數 = 撲到數 ×100 + 最長連續撲救 ×50。</li>
    </ol>`,
  demo: {
    render: demoSvg,
    steps: [
      { ...demoStep(demoState({ x: 80, y: 40 }, 300), ['right', 'right'], 300,
        '球往右邊低處飛來,往右移兩步…', '…手套碰到球:撲到了!'), kind: 'ok' },
      { ...demoStep(demoState({ x: -120, y: 60 }, 300), [], 300,
        '球往左邊角落飛,守門員站著不動…', '…搆不到:進球(GOAL!)'), kind: 'fail' },
      { ...demoStep(demoState({ x: 0, y: 115 }, half), ['jump'], half,
        '高球!在球到之前跳起…', '…跳到最高點剛好碰到:撲到了!'), kind: 'ok' },
      { ...demoStep(demoState({ x: 0, y: 115 }, 50), [], 50,
        '同樣的高球,站著不跳…', '…手搆不到那麼高:進球'), kind: 'fail' },
      { ...demoStep(demoState({ x: 70, y: 90 }, half), ['diveR'], half,
        '球往右上飛,按「撲 ▶」…', '…撲過去攔住:撲到了!'), kind: 'ok' },
    ],
  },
});
// 打開說明時先暫停,避免背後一直進球(shared/help.js 打開說明時發出 helpopen,IR15)。
document.addEventListener('helpopen', pause);
