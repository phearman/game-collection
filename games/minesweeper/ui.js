// 踩地雷畫面層:狀態、渲染、輸入。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  DIFFICULTIES, initState, stateWithMines, revealState, flagState, tickState, scoreFor, resultOf, isOver,
  remainingMines, cellView, toSave, fromSave, isValidState,
} from './logic.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js';
import { settlePlay } from '../../shared/settle.js';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js';

const GAME_ID = 'minesweeper';
const LONG_PRESS_MS = 400;
const LABELS = { normal: '初級', hard: '中級', expert: '高級' };
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, newAchievements, isBest, bestBefore, score, seconds };結算中為 { pending: true }
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面
let flagMode = false;
let focusIdx = 0; // 鍵盤焦點所在格(roving tabindex)
let peek = false; // 結束後按「看盤面」:暫時收起遮罩

// 紀錄寫入依序執行,避免連按時存檔與結算交錯。
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

async function startNew(difficulty = state?.difficulty ?? 'normal') {
  state = initState(difficulty);
  gameNo++;
  ended = null;
  peek = false;
  focusIdx = Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2);
  buildBoard();
  render();
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID);
  });
  render();
}

// 一局結束:依 §4.2 結算(每局只執行一次),結果顯示在遮罩。
function finish(result) {
  const snap = { score: scoreFor(result, state.seconds), seconds: state.seconds, mines: state.mineCount, difficulty: state.difficulty };
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, {
      result, score: snap.score, difficulty: snap.difficulty, detail: { seconds: snap.seconds, mines: snap.mines },
    });
    if (!out) { if (no === gameNo) startNew(snap.difficulty); return; } // 結算失敗且選「不存了」:不記錄、開新局(IR6)
    if (out.play.is_best) best = Math.max(best, snap.score);
    if (no !== gameNo) return;
    ended = {
      result,
      xp: out.xpGained,
      xpBreakdown: out.xpBreakdown,
      newAchievements: out.newAchievements,
      isBest: out.play.is_best,
      bestBefore,
      score: snap.score,
      seconds: snap.seconds,
    };
    render();
  });
}

// 新遊戲 / 切換難度:有操作未結束 ⇒ quit;0 次操作不記錄;已結算直接開新局。
let confirmingQuit = false;
async function newGame(difficulty = state.difficulty) {
  if (confirmingQuit) return;
  if (ended) {
    if (!ended.pending) startNew(difficulty); // 結算中:忽略連點
    else render();
    return;
  }
  const result = resultOnNewGame({ everWon: state.status === 'win', moves: state.moves });
  const note = { score: scoreFor(result, state.seconds), best, assist: state.assist };
  if (result === 'quit' && needsQuitBestConfirm(note)) {
    confirmingQuit = true;
    const quit = await confirmQuitBest(note);
    confirmingQuit = false;
    if (!quit) { $('difficulty').value = state.difficulty; return; }
  }
  if (result) finish(result);
  startNew(difficulty);
}

function act(i, kind) {
  profile.input();
  if (ended || isOver(state)) return;
  const next = kind === 'flag' ? flagState(state, i) : revealState(state, i);
  if (next === state) return;
  state = next;
  render();
  const result = resultOf(state);
  if (result) {
    finish(result);
  } else {
    const saved = toSave(state);
    run(() => profile.saveState(GAME_ID, saved));
  }
}

// 點一下:插旗模式下對未翻開格插旗,其餘一律翻開(點已翻開的數字 = 快速翻開)。
function tap(i) {
  act(i, flagMode && !state.open[i] ? 'flag' : 'reveal');
}

// ---- 渲染 ----

const SHOW = {
  hidden: ['', '未翻開'],
  flag: ['🚩', '旗'],
  mine: ['💣', '地雷'],
  exploded: ['💥', '踩到的地雷'],
  wrong: ['❌', '插錯的旗'],
  0: ['', '空白'],
};

function buildBoard() {
  const board = $('board');
  board.style.setProperty('--cols', state.cols);
  board.dataset.size = state.difficulty;
  board.innerHTML = state.open.map((_, i) => `<button class="cell" type="button" role="gridcell" tabindex="-1" data-i="${i}"></button>`).join('');
}

function renderCells() {
  const cells = $('board').children;
  for (let i = 0; i < cells.length; i++) {
    const v = cellView(state, i);
    const [text, label] = SHOW[v] ?? [v, v];
    const el = cells[i];
    const open = /^\d$/.test(v);
    el.className = `cell${open ? ` open n${v}` : ` is-${v}`}`;
    el.textContent = text;
    el.setAttribute('aria-label', `${Math.floor(i / state.cols) + 1} 列 ${(i % state.cols) + 1} 欄:${label}`);
    el.tabIndex = i === focusIdx ? 0 : -1;
  }
}

function render() {
  renderCells();
  $('seconds').textContent = state.seconds.toLocaleString();
  $('best').textContent = best.toLocaleString();
  $('difficulty').value = state.difficulty;
  $('flag-mode').setAttribute('aria-pressed', String(flagMode));
  $('flag-mode').classList.toggle('is-on', flagMode);
  const d = DIFFICULTIES[state.difficulty];
  $('status').textContent = `💣 剩餘 ${remainingMines(state)} · ${LABELS[state.difficulty]} ${d.cols}×${d.rows} · ${d.mines} 雷${flagMode ? ' · 插旗模式中' : ''}`;
  renderOverlay();
}

// 成就 id 可能來自匯入檔:只顯示白名單名稱,其餘一律 escape。
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const achName = (id) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return esc(a ? `${a.icon} ${a.name}` : id);
};

function infoHtml() {
  if (ended.pending) return '<p>結算中…</p>';
  const lines = [
    `<p>${ended.seconds.toLocaleString()} 秒 · 分數 ${ended.score.toLocaleString()}</p>`,
    `<p class="overlay-xp">本局 +${ended.xp} XP</p>`,
    xpBreakdownHtml(ended.xpBreakdown),
  ];
  if (ended.newAchievements.length) lines.push(`<p>新成就:${ended.newAchievements.map(achName).join('、')}</p>`);
  if (ended.result !== 'win') {
    lines.push(`<p>勝利才有分數${ended.bestBefore > 0 ? `(最佳 ${ended.bestBefore.toLocaleString()})` : ''}</p>`);
  } else lines.push(bestLineHtml(ended));
  return lines.join('');
}

function renderOverlay() {
  const overlay = $('overlay');
  if (!ended || peek) {
    overlay.hidden = true;
    return;
  }
  $('overlay-title').textContent = state.status === 'win' ? '🎉 全部找出來了!' : '💥 踩到地雷';
  $('overlay-info').innerHTML = infoHtml();
  $('overlay-actions').innerHTML = '<button class="btn" type="button" data-act="new">再玩一次</button>'
    + '<button class="btn" type="button" data-act="peek">看盤面</button>';
  overlay.hidden = false;
}

// ---- 輸入:滑鼠點擊/右鍵、手機點擊/長按、鍵盤 ----

const cellOf = (e) => e.target.closest?.('.cell');
let press = null; // { i, x, y, timer, long }
let lastPointer = 'mouse';

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

$('board').addEventListener('pointerdown', (e) => {
  lastPointer = e.pointerType;
  const el = cellOf(e);
  if (!el || e.button !== 0) return;
  cancelPress();
  const i = Number(el.dataset.i);
  press = { i, x: e.clientX, y: e.clientY, long: false, timer: null };
  if (e.pointerType !== 'mouse') {
    press.timer = setTimeout(() => {
      if (!press) return;
      press.long = true;
      act(press.i, 'flag');
    }, LONG_PRESS_MS);
  }
});
$('board').addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress(); // 在捲動,不算點擊
});
$('board').addEventListener('pointerup', (e) => {
  if (!press) return;
  const { i, long } = press;
  cancelPress();
  if (long || cellOf(e)?.dataset.i !== String(i)) return;
  focusIdx = i;
  tap(i);
});
$('board').addEventListener('pointercancel', cancelPress);
$('board').addEventListener('contextmenu', (e) => {
  e.preventDefault(); // 手機長按由計時器處理;滑鼠右鍵在這裡插旗
  const el = cellOf(e);
  if (el && lastPointer === 'mouse') {
    focusIdx = Number(el.dataset.i);
    act(focusIdx, 'flag');
  }
});

const MOVES = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
$('board').addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const el = cellOf(e);
  if (!el) return;
  const i = Number(el.dataset.i);
  if (MOVES[e.key]) {
    e.preventDefault();
    const [dr, dc] = MOVES[e.key];
    const r = Math.min(state.rows - 1, Math.max(0, Math.floor(i / state.cols) + dr));
    const c = Math.min(state.cols - 1, Math.max(0, (i % state.cols) + dc));
    focusIdx = r * state.cols + c;
    renderCells();
    $('board').children[focusIdx].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    focusIdx = i;
    tap(i);
  } else if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    focusIdx = i;
    act(i, 'flag');
  }
});

$('new').addEventListener('click', () => newGame());
$('difficulty').addEventListener('change', (e) => newGame(e.target.value));
$('flag-mode').addEventListener('click', () => {
  flagMode = !flagMode;
  render();
});
$('overlay-actions').addEventListener('click', (e) => {
  const cmd = e.target.dataset.act;
  if (cmd === 'new') newGame();
  if (cmd === 'peek') {
    peek = true;
    renderOverlay();
  }
});

// 計時:第一下開始,每秒 +1(分頁隱藏時暫停);離頁或隱藏時把秒數寫進存檔。
setInterval(() => {
  if (ended || state.status !== 'playing' || document.visibilityState === 'hidden') return;
  state = tickState(state);
  $('seconds').textContent = state.seconds.toLocaleString();
}, 1000);
const flushSeconds = () => {
  if (!ended && state.status === 'playing') {
    const saved = toSave(state);
    run(() => profile.saveState(GAME_ID, saved));
  }
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSeconds(); });
window.addEventListener('pagehide', flushSeconds);

bindThemeToggle($('theme'));

// 載入:有存檔就自動還原(§4.1),否則開新局。
const saved = await profile.loadSave(GAME_ID);
if (saved && isValidState(saved)) {
  state = fromSave(saved);
  gameNo++;
  focusIdx = Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2);
  buildBoard();
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  render();
  const result = resultOf(state);
  if (result) finish(result);
} else {
  await startNew('normal');
}

// 示範用固定盤面(5×5,雷在第 1 列第 4 格與第 2 列第 5 格):每步都呼叫 logic.js 實算。
const demoCols = 5;
const pos = (r, c) => (r - 1) * demoCols + (c - 1);
const d0 = stateWithMines(5, demoCols, [pos(1, 4), pos(2, 5)]);
const d1 = revealState(d0, pos(5, 1));
const d2 = flagState(flagState(d1, pos(1, 4)), pos(2, 5));
const d3 = revealState(d2, pos(2, 4));
const w0 = flagState(flagState(d1, pos(1, 5)), pos(2, 5));
const w1 = revealState(w0, pos(2, 4));
const demoBoard = (s) => `<div class="board demo" style="--cols:${s.cols}">${s.open.map((_, i) => {
  const v = cellView(s, i);
  const open = /^\d$/.test(v);
  return `<div class="cell${open ? ` open n${v}` : ` is-${v}`}">${(SHOW[v] ?? [v])[0]}</div>`;
}).join('')}</div>`;

setupHelp({
  gameId: GAME_ID,
  title: '踩地雷玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>點格子翻開;數字 = 周圍 8 格的地雷數,翻到空白會自動展開。<b>第一下必定安全</b>。</li>
      <li>右鍵、長按或「🚩 插旗模式」在雷上插旗;插旗的格子不會被翻開。</li>
      <li>點已翻開的數字:周圍旗數等於該數字時,一次翻開其餘鄰格(旗插錯會踩雷)。</li>
      <li>翻到地雷就輸。鍵盤:方向鍵移動、Enter 翻開、F 插旗。</li>
      <li><b>勝利</b>:翻開所有不是雷的格子。<b>分數</b> = 10000 − 秒數(越快越高),輸了 0 分。</li>
    </ol>`,
  demo: {
    render: demoBoard,
    steps: [
      { before: d0, after: d1, caption: '點左下角:第一下必定安全…', result: '…翻到空白,連鎖展開到數字為止' },
      { before: d1, after: d2, caption: '數字推得出雷在哪…', result: '…右上兩顆雷插上旗' },
      { before: d2, after: d3, kind: 'ok', caption: '點「2」,周圍已有 2 面旗…', result: '…其餘鄰格一次翻開,全部找出來,勝利!' },
      { before: w0, after: w1, kind: 'fail', caption: '旗插錯了,又點「2」快速翻開…', result: '…翻到真正的雷,踩雷結束(❌ = 插錯的旗)' },
    ],
  },
});
