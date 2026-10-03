// 貪食蛇畫面層:狀態、渲染、輸入、tick 計時器。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  SIZE, TICK_MS, DIFFICULTIES, initState, turnState, tickState, pauseState, resumeState, overlayFor,
  toSave, fromSave, isValidState,
} from './logic.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnGameOver, resultOnNewGame } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { xpBreakdownHtml } from '../../shared/xp-explain.js';
import { load, save } from '../../shared/storage.js';

const GAME_ID = 'snake';
const DIFF_KEY = 'difficulty:snake'; // 上次選的難度(開新局用)
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, newAchievements, isBest, bestBefore, score };結算中為 { pending: true }
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面
let loop = null; // tick 計時器

// 紀錄寫入依序執行,避免存檔與結算交錯。
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

// 暫停中不算遊戲時間:暫停時通知 profile「不可見」,繼續時恢復並記一次輸入。
const timerPause = () => run(() => profile.setVisible(false));
const timerResume = () => run(() => { profile.setVisible(true); profile.input(); });

function difficultyPref() {
  const d = load(DIFF_KEY, 'normal');
  return DIFFICULTIES.includes(d) ? d : 'normal';
}

async function startNew(difficulty = difficultyPref()) {
  state = initState(Math.random, difficulty);
  gameNo++;
  ended = null;
  render();
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID);
    profile.setVisible(false); // 開局暫停
  });
  render();
}

// 一局結束:依 §4.2 結算(每局只執行一次),結果顯示在遮罩。
function finish(result) {
  const snap = { score: state.score, difficulty: state.difficulty, length: state.snake.length };
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await profile.finishPlay(GAME_ID, {
      result, score: snap.score, difficulty: snap.difficulty, detail: { length: snap.length },
    });
    best = Math.max(best, snap.score);
    if (no !== gameNo) return;
    ended = {
      xp: out.xpGained,
      xpBreakdown: out.xpBreakdown,
      newAchievements: out.newAchievements,
      isBest: out.play.is_best,
      bestBefore,
      score: snap.score,
    };
    render();
  });
}

// 新遊戲(含切換難度):未動不記錄、已動未結束 ⇒ quit。
function newGame(difficulty) {
  if (ended?.pending) return; // 結算中:忽略連點
  if (!ended) {
    const result = resultOnNewGame({ everWon: state.won, moves: state.steps });
    if (result) finish(result);
  }
  startNew(difficulty);
}

function tick() {
  const next = tickState(state);
  if (next === state) return;
  state = next;
  if (state.over) {
    finish(resultOnGameOver({ everWon: state.won }));
  } else {
    const saved = toSave(state);
    run(() => profile.saveState(GAME_ID, saved));
  }
  render();
}

function pause() {
  if (ended || state.paused) return;
  state = pauseState(state);
  timerPause();
  render();
}

function resume() {
  if (ended || !state.paused) return;
  state = resumeState(state);
  timerResume();
  render();
}

function togglePause() {
  if (state.paused) resume();
  else pause();
}

// 方向輸入:暫停中(含開局)先繼續,再轉向;反向或同 tick 第二次轉向由 logic 擋掉。
function steer(dir) {
  if (ended) return;
  profile.input();
  if (state.paused) resume();
  state = turnState(state, dir);
}

// 只在「進行中且未結算」時跑 tick;難度決定間隔。
function syncLoop() {
  const want = !state.paused && !state.over && !ended;
  if (want && !loop) loop = setInterval(tick, TICK_MS[state.difficulty]);
  if (!want && loop) {
    clearInterval(loop);
    loop = null;
  }
}

// ---- 渲染 ----

const cells = [];
function buildBoard(el) {
  el.innerHTML = '';
  for (let i = 0; i < SIZE * SIZE; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.setAttribute('role', 'gridcell');
    el.append(d);
    cells.push(d);
  }
}

// 蛇身、蛇頭、食物 → 每格 class(示範與正式盤面共用)。
function cellClasses(s) {
  const cls = Array(SIZE * SIZE).fill('cell');
  if (s.food) cls[s.food[0] * SIZE + s.food[1]] = 'cell food';
  s.snake.forEach(([r, c], i) => {
    cls[r * SIZE + c] = i === 0 ? `cell head${s.over && !s.won ? ' dead' : ''}` : 'cell body';
  });
  return cls;
}

function render() {
  cellClasses(state).forEach((c, i) => { if (cells[i].className !== c) cells[i].className = c; });
  $('score').textContent = state.score.toLocaleString();
  $('best').textContent = Math.max(best, state.score).toLocaleString();
  $('difficulty').value = state.difficulty;
  const pauseBtn = $('pause');
  pauseBtn.textContent = state.paused ? (state.steps === 0 ? '▶ 開始' : '▶ 繼續') : '⏸ 暫停';
  pauseBtn.disabled = !!ended || state.over;
  renderOverlay();
  syncLoop();
}

// 成就 id 可能來自匯入檔:只顯示白名單名稱,其餘一律 escape。
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const achName = (id) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return esc(a ? `${a.icon} ${a.name}` : id);
};

function infoHtml() {
  if (!ended) return '';
  if (ended.pending) return '<p>結算中…</p>';
  const lines = [`<p class="overlay-xp">本局 +${ended.xp} XP</p>`, xpBreakdownHtml(ended.xpBreakdown)];
  if (ended.newAchievements.length) lines.push(`<p>新成就:${ended.newAchievements.map(achName).join('、')}</p>`);
  lines.push(ended.isBest
    ? '<p>🎉 新的最佳分數!</p>'
    : `<p>距最佳 ${ended.bestBefore.toLocaleString()} 還差 ${(ended.bestBefore - ended.score).toLocaleString()}</p>`);
  return lines.join('');
}

let shownKind = null;
function renderOverlay() {
  const overlay = $('overlay');
  const kind = overlayFor(state);
  const sig = `${kind}|${ended ? (ended.pending ? 'p' : 'd') : ''}`;
  if (sig === shownKind) return; // tick 期間不重繪遮罩
  shownKind = sig;
  const actions = $('overlay-actions');
  let info = '';
  if (kind === 'ready') {
    $('overlay-title').textContent = '準備開始';
    info = '<p>按方向鍵 / WASD,或在棋盤上滑動開始</p>';
    actions.innerHTML = '<button class="btn" data-act="resume">▶ 開始</button>';
  } else if (kind === 'paused') {
    $('overlay-title').textContent = '已暫停';
    info = '<p>按 P、方向鍵或「繼續」接著玩</p>';
    actions.innerHTML = '<button class="btn" data-act="resume">▶ 繼續</button>';
  } else if (kind === 'won') {
    $('overlay-title').textContent = '填滿全盤!';
    actions.innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
  } else if (kind === 'over') {
    $('overlay-title').textContent = '遊戲結束';
    actions.innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
  } else {
    overlay.hidden = true;
    return;
  }
  $('overlay-info').innerHTML = kind === 'won' || kind === 'over' ? infoHtml() : info;
  overlay.hidden = false;
}

// ---- 輸入 ----

const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
};

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.target instanceof HTMLSelectElement) return; // 難度選單用方向鍵切換選項
  if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (ended) return;
    profile.input();
    togglePause();
    return;
  }
  const dir = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!dir) return;
  e.preventDefault();
  steer(dir);
});

// 滑動綁在棋盤外框,遮罩蓋住時(開局、暫停)也能滑動開始。
let touch = null;
$('board-wrap').addEventListener('pointerdown', (e) => { touch = { x: e.clientX, y: e.clientY }; });
$('board-wrap').addEventListener('pointerup', (e) => {
  if (!touch) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  touch = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
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
$('difficulty').addEventListener('change', (e) => {
  const d = e.target.value;
  if (ended?.pending) {
    e.target.value = state.difficulty;
    return;
  }
  save(DIFF_KEY, d);
  newGame(d);
});
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (act === 'new') newGame();
  if (act === 'resume') {
    profile.input();
    resume();
  }
});

bindThemeToggle($('theme'));
buildBoard($('board'));

// 載入:有存檔就自動還原(暫停狀態),否則開新局。
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

// ---- 說明與示範:盤面一律由 logic 實算 ----

const fixed = () => 0;
const demoState = (fields) => ({ ...initState(fixed), paused: false, steps: 1, ...fields });
const demoStep = (before, act, caption, result) => ({ before, after: act(before), caption, result });
const tickOnce = (s) => tickState(s, fixed);
setupHelp({
  gameId: GAME_ID,
  title: '貪食蛇玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>蛇會一直往前走;用方向鍵、W/A/S/D 或在棋盤上滑動轉彎。</li>
      <li>不能直接回頭(朝右時按 ← 無效)。</li>
      <li>吃到紅色食物:蛇長 1 格、分數 +10。</li>
      <li>撞牆或撞到自己就結束。</li>
      <li>P 鍵或「⏸ 暫停」可暫停;難度越高蛇走越快,XP 越多。</li>
      <li>勝利條件:蛇填滿整個棋盤;分數只來自吃食物,最佳 = 單局最高分。</li>
    </ol>`,
  demo: {
    render: (s) => `<div class="board">${cellClasses(s).map((c) => `<div class="${c}"></div>`).join('')}</div>`,
    steps: [
      { ...demoStep(demoState({ snake: [[7, 7], [7, 6], [7, 5]], food: [7, 8] }), tickOnce,
        '前方是食物…', '…吃到了:蛇長 1 格,分數 +10'), kind: 'ok' },
      { ...demoStep(demoState({ snake: [[7, 7], [7, 6], [7, 5]], food: [2, 2] }), (s) => tickOnce(turnState(s, 'left')),
        '朝右時按 ← …', '…不能回頭,蛇照樣往右'), kind: 'fail' },
      demoStep(demoState({ snake: [[7, 7], [7, 6], [7, 5]], food: [2, 2] }), (s) => tickOnce(turnState(s, 'up')),
        '按 ↑ …', '…下一格轉彎往上'),
      { ...demoStep(demoState({ snake: [[7, 14], [7, 13], [7, 12]], food: [2, 2] }), tickOnce,
        '前方是牆…', '…撞牆,遊戲結束(撞到自己也一樣)'), kind: 'fail' },
    ],
  },
});
// 打開說明時先暫停,避免蛇在背後撞死。
document.querySelector('.topbar .btn').nextElementSibling.addEventListener('click', pause);
