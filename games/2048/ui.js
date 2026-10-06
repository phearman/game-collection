// 2048 畫面層:狀態、渲染、輸入。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  move, initState, stepState, undoState, continueState, settleState, canUndo, isInvalidMove, shownBest,
  toSave, fromSave, maxTile, overlayFor, isValidState, suggestMove,
} from './logic.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnGameOver, resultOnNewGame, needsQuitConfirm } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js';
import { settlePlay } from '../../shared/settle.js';
import { quitBestNote } from '../../shared/quit.js';
import { DEMO_STUCK_LEFT, DEMO_FULL } from './demo.js';
import { load, save } from '../../shared/storage.js';

const GAME_ID = '2048';
const MODE_KEY = 'mode:2048'; // 上次選的模式:normal / kids(RS6 小朋友模式 = 輔助局)
const modePref = () => (load(MODE_KEY, 'normal') === 'kids' ? 'kids' : 'normal');
let pendingMode = null; // 確認放棄後要切換的模式
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, newAchievements, isBest, bestBefore, score };結算中為 { pending: true }
let settle = false; // 勝利後按「新遊戲」:先顯示結算遮罩,按「確定」才開新局
let live = { xp: 0, achievements: [] }; // 本局局中即時解開的成就(profile 隨存檔保存)
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面

// 紀錄寫入依序執行,避免連按時存檔與結算交錯。
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

async function startNew(mode = modePref()) {
  state = initState(Math.random, { kids: mode === 'kids' });
  gameNo++;
  ended = null;
  settle = false;
  live = { xp: 0, achievements: [] };
  render();
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID);
  });
  render();
}

// 一局結束:依 §4.2 結算(每局只執行一次),結果顯示在遮罩。結算後不可復原、不可再移動。
function finish(result) {
  const snap = { score: state.score, max_tile: maxTile(state.board), assist: !!state.kids };
  state = settleState(state); // 結算後不可移動、不可復原
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, {
      result, score: snap.score, difficulty: 'normal', detail: { max_tile: snap.max_tile }, assist: snap.assist,
    });
    if (!out) { if (no === gameNo) startNew(); return; } // 結算失敗且選「不存了」:不記錄、開新局(IR6)
    if (out.play.is_best) best = Math.max(best, snap.score);
    if (no !== gameNo) return;
    ended = {
      xp: out.xpGained, // 已含局中即時成就 XP(profile 不重複加總)
      xpBreakdown: out.xpBreakdown,
      newAchievements: out.newAchievements,
      isBest: out.play.is_best,
      assist: snap.assist,
      bestBefore,
      score: snap.score,
    };
    render();
  });
}

// mode:切換模式時帶入(normal / kids);沒帶就沿用上次的模式。
function newGame(mode) {
  if (settle) return; // 結算遮罩只能按「確定」開新局
  if (ended) {
    if (!ended.pending) startNew(mode); // 已結算:直接開新局;結算中:忽略連點
    return;
  }
  if (needsQuitConfirm(state)) {
    pendingMode = mode ?? null;
    $('quit-best-note').textContent = quitBestNote({ score: state.score, best, assist: state.kids });
    $('quit-dlg').showModal(); // 防誤觸:會記為放棄的才問(RS4)
    return;
  }
  const result = resultOnNewGame(state);
  if (result === 'win') {
    settle = true; // 先看結算,按「確定」再開新局
    finish(result);
    return;
  }
  if (result) finish(result);
  startNew(mode);
}

function afterChange(prevWon) {
  render();
  if (state.won && !prevWon) {
    const max_tile = maxTile(state.board);
    const no = gameNo;
    run(async () => {
      await profile.unlock(GAME_ID, { max_tile, assist: !!state.kids }); // 小朋友模式不解 2048 專屬成就
      if (no !== gameNo) return;
      live = profile.liveRewards(GAME_ID);
      renderOverlay();
    });
  }
  if (state.over) {
    finish(resultOnGameOver(state));
  } else {
    const saved = toSave(state);
    run(() => profile.saveState(GAME_ID, saved));
  }
}

// 無效移動回饋:棋盤水平抖動(減少動態時改為邊框閃一下,見 style.css)。
function shake() {
  const board = $('board');
  board.classList.remove('shake');
  void board.offsetWidth; // 重新觸發動畫
  board.classList.add('shake');
}

function step(dir) {
  profile.input();
  const next = stepState(state, dir);
  if (next === state) {
    if (isInvalidMove(state, dir)) shake();
    return;
  }
  const prevWon = state.won;
  state = next;
  afterChange(prevWon);
}

function undo() {
  profile.input();
  if (!canUndo(state)) return;
  const prevWon = state.won;
  state = undoState(state);
  afterChange(prevWon);
}

function keepPlaying() {
  profile.input();
  if (state.settled) return;
  state = continueState(state);
  afterChange(state.won);
}

function tileClass(v) {
  if (v === 0) return 'tile';
  const color = v > 2048 ? 'vbig' : `v${v}`;
  return `tile ${color}${v >= 1024 ? ' big' : ''}`;
}

const ARROW = { left: '⬅', right: '➡', up: '⬆', down: '⬇' };

// 小朋友模式:建議方向 + 只標建議方向實際會合併的方塊(依真實滑動規則,見 logic.suggestMove)。
function suggestion() {
  if (!state.kids || state.settled || state.over || (state.won && !state.keepPlaying)) return null;
  return suggestMove(state.board);
}

function render() {
  const hint = suggestion();
  const marked = new Set((hint?.pairs ?? []).flat().map(([r, c]) => `${r},${c}`));
  $('board').innerHTML = state.board.flatMap((row, r) => row.map((v, c) => {
    const pop = state.fresh === `${r},${c}` ? ' pop' : '';
    const mark = marked.has(`${r},${c}`) ? ' merge-hint' : '';
    return `<div class="${tileClass(v)}${pop}${mark}" role="gridcell">${v || ''}</div>`;
  })).join('');
  $('suggest').hidden = !hint;
  $('suggest').innerHTML = hint ? `<span class="arrow" aria-hidden="true">${ARROW[hint.dir]}</span><span>建議:${hint.reason}</span>` : '';
  $('mode').value = state.kids ? 'kids' : 'normal';
  $('score').textContent = state.score.toLocaleString();
  $('best').textContent = (state.kids ? best : shownBest(best, state.score)).toLocaleString(); // 小朋友模式不刷新最佳
  $('undo').disabled = !canUndo(state);
  renderOverlay();
}

// 成就 id 可能來自匯入檔:只顯示白名單名稱,其餘一律 escape。
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const achName = (id) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return esc(a ? `${a.icon} ${a.name}` : id);
};

function infoHtml(kind) {
  if (!ended) {
    if (kind !== 'won' || live.achievements.length === 0) return '';
    return `<p>解開成就:${live.achievements.map(achName).join('、')}(+${Number(live.xp) || 0} XP)</p>`;
  }
  if (ended.pending) return '<p>結算中…</p>';
  const lines = [`<p class="overlay-xp">本局 +${ended.xp} XP</p>`, xpBreakdownHtml(ended.xpBreakdown)];
  if (ended.newAchievements.length) lines.push(`<p>新成就:${ended.newAchievements.map(achName).join('、')}</p>`);
  if (ended.assist) lines.push('<p class="overlay-assist">🧸 小朋友模式(輔助局):不刷新最佳</p>');
  lines.push(bestLineHtml(ended));
  return lines.join('');
}

function renderOverlay() {
  const overlay = $('overlay');
  const actions = $('overlay-actions');
  const kind = settle ? 'settle' : overlayFor(state);
  if (kind === 'settle') {
    $('overlay-title').textContent = '本局結算';
    actions.innerHTML = `<button class="btn" data-act="confirm"${ended?.pending ? ' disabled' : ''}>確定</button>`;
  } else if (kind === 'over') {
    $('overlay-title').textContent = '遊戲結束';
    actions.innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
  } else if (kind === 'won') {
    $('overlay-title').textContent = '達成 2048!';
    actions.innerHTML = '<button class="btn" data-act="continue">繼續玩</button><button class="btn" data-act="new">新遊戲</button>';
  } else if (kind === 'won-over') {
    $('overlay-title').textContent = '達成 2048!';
    actions.innerHTML = '<button class="btn" data-act="new">新遊戲</button>';
  } else {
    overlay.hidden = true;
    return;
  }
  $('overlay-info').innerHTML = infoHtml(kind);
  overlay.hidden = false;
}

const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
};

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  const dir = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!dir) return;
  e.preventDefault();
  step(dir);
});

let touch = null;
$('board').addEventListener('pointerdown', (e) => { touch = { x: e.clientX, y: e.clientY }; });
$('board').addEventListener('pointerup', (e) => {
  if (!touch) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  touch = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});

$('new').addEventListener('click', () => newGame()); // ⛔ 直接傳 newGame:click 事件會被當成模式參數(H2)
$('board').addEventListener('animationend', () => $('board').classList.remove('shake'));
$('quit-dlg').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  $('quit-dlg').close();
  const mode = pendingMode;
  pendingMode = null;
  if (act === 'quit' && !state.settled) {
    finish('quit');
    startNew(mode ?? undefined);
  } else {
    $('mode').value = state.kids ? 'kids' : 'normal'; // 不放棄:模式選單還原
  }
});
$('quit-dlg').addEventListener('cancel', () => {
  pendingMode = null;
  $('mode').value = state.kids ? 'kids' : 'normal';
});
$('mode').addEventListener('change', (e) => {
  const mode = e.target.value === 'kids' ? 'kids' : 'normal';
  if (ended?.pending || settle) {
    e.target.value = state.kids ? 'kids' : 'normal';
    return;
  }
  save(MODE_KEY, mode);
  newGame(mode);
});
$('undo').addEventListener('click', undo);
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (act === 'new') newGame();
  if (act === 'continue') keepPlaying();
  if (act === 'confirm' && ended && !ended.pending) startNew();
});

bindThemeToggle($('theme'));

// 載入:有存檔就自動還原(§4.1),否則開新局。
const saved = await profile.loadSave(GAME_ID);
if (saved && isValidState(saved)) {
  state = fromSave(saved);
  live = profile.liveRewards(GAME_ID);
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  render();
  if (state.over) finish(resultOnGameOver(state));
} else {
  await startNew();
}

// 示範用固定盤面:直接呼叫 logic.move,示範結果與實際規則一致(不放新方塊,避免畫面跳動)。
const row = (cells) => [cells, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const demoStep = (before, dir, caption, result) => ({ before, after: move(before, dir).board, caption, result });
setupHelp({
  gameId: GAME_ID,
  title: '2048 玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>按方向鍵或 W/A/S/D(手機在棋盤上滑動),<b>所有方塊</b>一起往該方向滑到底。</li>
      <li>兩個<b>相同數字</b>撞在一起會合成一個(2+2→4),合出的數字加進分數。</li>
      <li>每移動一次,空格會冒出一個新的 2(偶爾是 4)。</li>
      <li>棋盤滿了又無法合併,遊戲結束。</li>
      <li>「復原」可退回上一步;「新遊戲」重新開局。</li>
      <li><b>勝利</b>:合出一個 2048 方塊(可選擇繼續玩)。<b>分數</b> = 每次合併出的數字加總(2+2→4 得 4 分);<b>最佳</b> = 單局最高分;步數、時間都不計分。</li>
    </ol>
    <p>訣竅:把最大的方塊固定在一個角落,盡量只用兩、三個方向。</p>
    <p>小朋友模式:棋盤上方會提示建議方向,並框出往那邊會合併的方塊;復原可以一直按。這是<b>輔助局</b>:不刷新最佳、XP 打對折。</p>`,
  demo: {
    render: (board) => `<div class="board">${board.flatMap((r) => r.map((v) => `<div class="${tileClass(v)}">${v || ''}</div>`)).join('')}</div>`,
    steps: [
      { ...demoStep(row([2, 2, 0, 0]), 'left', '按 ← :兩個 2 往左滑…', '…撞在一起合成 4,分數 +4'), kind: 'ok' },
      { ...demoStep(row([2, 2, 2, 2]), 'left', '四個 2 往左…', '…兩兩合併成 4、4,不會一次合成 8'), kind: 'ok' },
      { ...demoStep(row([4, 0, 4, 4]), 'left', '4、空、4、4 往左…', '…先合靠左的兩個 4,得到 8、4'), kind: 'ok' },
      { ...demoStep([[0, 0, 0, 2], [0, 0, 0, 2], [0, 0, 0, 4], [0, 0, 0, 8]], 'down', '按 ↓ :直的一排也能合…', '…2+2→4,大數字留在右下角'), kind: 'ok' },
      { ...demoStep(DEMO_STUCK_LEFT, 'left', '方塊都已靠左、相鄰沒有相同數字,按 ← …', '…什麼都沒動,也不會冒新方塊(畫面抖一下)'), kind: 'fail' },
      { ...demoStep(DEMO_FULL, 'left', '棋盤滿了,上下左右都沒有相同數字相鄰…', '…哪個方向都動不了:遊戲結束'), kind: 'fail' },
    ],
  },
});
