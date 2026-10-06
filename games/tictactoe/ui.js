import { PLAYER, AI, DIFFICULTIES, ORDERS, initState, newGameState, stepState, aiStepState, undoState, cursorMove, winningLine, demoSteps } from './logic.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js';
import { settlePlay } from '../../shared/settle.js';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js';
import { load, save } from '../../shared/storage.js';

const GAME_ID = 'tictactoe';
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const saved = await profile.loadSave(GAME_ID);
const PREF_KEY = `preferences:${GAME_ID}`;
const preferences = load(PREF_KEY, {});
let state = saved ?? initState(
  DIFFICULTIES.includes(preferences?.difficulty) ? preferences.difficulty : 'normal',
  ORDERS.includes(preferences?.order) ? preferences.order : 'player',
  preferences?.lastFirst,
);
function savePreferences() {
  save(PREF_KEY, { difficulty: state.difficulty, order: state.order, lastFirst: state.first });
}
savePreferences();
let best = await profile.best(GAME_ID);
let cursor = 0;
let ended = null;
let restarting = false;
let aiTimer = null;
let generation = 0;
let queue = Promise.resolve();
const run = (fn) => {
  queue = queue.then(fn).catch((error) => { console.error(error); });
  return queue;
};

const symbols = { X: '✕', O: '◯' };
const cells = Array.from({ length: 9 }, (_, i) => {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'cell';
  cell.dataset.index = i;
  $('board').append(cell);
  return cell;
});

function cancelAi() {
  clearTimeout(aiTimer);
  aiTimer = null;
  generation++;
}

function render() {
  const line = winningLine(state.board);
  cells.forEach((cell, i) => {
    const mark = state.board[i];
    cell.textContent = symbols[mark] ?? '';
    cell.className = `cell${mark === PLAYER ? ' player' : ''}${line?.includes(i) ? ' winner' : ''}`;
    cell.setAttribute('aria-label', `第 ${Math.floor(i / 3) + 1} 列第 ${i % 3 + 1} 格，${symbols[mark] ?? '空格'}`);
    cell.setAttribute('aria-disabled', String(!!ended || restarting || state.turn !== PLAYER || mark !== null));
    cell.tabIndex = !ended && !restarting && i === cursor ? 0 : -1;
  });
  $('score').textContent = state.score;
  $('best').textContent = Math.max(best, state.score);
  $('difficulty').value = state.difficulty;
  $('difficulty').disabled = restarting || !!ended?.pending;
  $('order').value = state.order;
  $('order').disabled = restarting || !!ended?.pending;
  $('new').disabled = restarting || !!ended?.pending;
  $('undo').disabled = !state.prev || !!ended || restarting;
  $('status').textContent = state.result ? '本局已結束' : restarting ? '正在開新局…' : state.turn === AI ? 'AI 思考中…' : '輪到你，選一格下 ✕';
  $('overlay').hidden = !state.result;
  $('again').disabled = !ended || !!ended.pending || restarting;
  if (!state.result) return;
  $('overlay-title').textContent = { win: '你贏了！', lose: 'AI 勝利', draw: '平手！' }[state.result];
  const info = $('overlay-info');
  info.replaceChildren();
  const add = (text, className = '') => {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    info.append(p);
  };
  if (!ended?.play) { add('結算中…'); return; }
  add(`本局 +${ended.xpGained} XP`, 'overlay-xp');
  appendXpBreakdown(info, ended.xpBreakdown, document);
  if (ended.newAchievements.length) add(`新成就：${ended.newAchievements.map((id) => {
    const a = ACHIEVEMENTS.find((item) => item.id === id);
    return a ? `${a.icon} ${a.name}` : id;
  }).join('、')}`);
  const bestText = bestLine({ isBest: ended.play.is_best, bestBefore: ended.bestBefore, score: state.score });
  if (bestText) add(bestText);
}

function finish(result) {
  if (ended) return queue;
  cancelAi();
  const snap = structuredClone(state);
  ended = { pending: true };
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, {
      result, score: snap.score, difficulty: snap.difficulty, detail: { moves: snap.moves, first: snap.first },
    });
    if (!out) { // 結算失敗且選「不存了」:不記錄、開新局(IR6);開新局流程中則交給它
      ended = { abandoned: true };
      if (!restarting) newGame();
      return;
    }
    if (out.play.is_best) best = Math.max(best, snap.score);
    ended = { ...out, bestBefore };
    render();
    if (snap.result && !document.querySelector('dialog[open]')) $('again').focus();
  });
}

function scheduleAi() {
  if (state.turn !== AI || ended || restarting) return;
  const token = generation;
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (token !== generation || ended || restarting) return;
    state = aiStepState(state);
    afterChange();
  }, 300);
}

function afterChange(persist = true) {
  render();
  if (state.result) { finish(state.result); return; }
  if (persist) {
    const snap = structuredClone(state);
    run(() => profile.saveState(GAME_ID, snap));
  }
  scheduleAi();
}

function play(index) {
  profile.input();
  if (ended || restarting) return;
  const next = stepState(state, index);
  if (next === state) return;
  state = next;
  afterChange();
}

function undo() {
  profile.input();
  if (ended || restarting) return;
  const next = undoState(state);
  if (next === state) return;
  cancelAi();
  state = next;
  afterChange();
}

let confirmingQuit = false;
async function newGame(difficulty = state.difficulty, order = state.order) {
  if (confirmingQuit || restarting || ended?.pending) { render(); return; }
  const result = resultOnNewGame(state);
  const note = { score: state.score, best, assist: state.assist };
  if (!ended && result === 'quit' && needsQuitBestConfirm(note)) {
    confirmingQuit = true;
    const quit = await confirmQuitBest(note);
    confirmingQuit = false;
    if (!quit) { render(); return; }
  }
  profile.input();
  if (restarting || ended?.pending) return;
  restarting = true;
  cancelAi();
  render();
  if (!ended && result) await finish(result);
  await queue;
  if (!ended && !result) await profile.discardSave(GAME_ID); // AI 開局後零操作重開，丟棄上一盤。
  state = newGameState(state, difficulty, order);
  savePreferences();
  ended = null;
  cursor = 0;
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  restarting = false;
  afterChange(false); // 開局尚無有效操作；AI 開局落子後由回呼存檔。
  cells[0].focus();
}

$('board').addEventListener('click', (event) => {
  const cell = event.target.closest('[data-index]');
  if (!cell) return;
  cursor = Number(cell.dataset.index);
  play(cursor);
  render();
});
$('board').addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || ended || restarting) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    profile.input();
    cursor = cursorMove(cursor, event.key);
    render();
    cells[cursor].focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    play(cursor);
  }
});
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => newGame());
$('undo').addEventListener('click', undo);
$('difficulty').addEventListener('change', () => newGame($('difficulty').value));
$('order').addEventListener('change', () => newGame(state.difficulty, $('order').value));
bindThemeToggle($('theme'));
profile.startTimer(GAME_ID);
afterChange(false); // 載入只還原畫面與待 AI 排程，不更新存檔時間。

setupHelp({
  gameId: GAME_ID,
  title: '井字棋玩法',
  mountAfter: document.querySelector('.navigation .btn'),
  rules: `<ol>
    <li>3×3 棋盤，你是 ✕、AI 是 ◯，輪流下空格。先手可選我先、AI 先、輪流或隨機。</li>
    <li>點格子，或方向鍵選格後按 Enter／空白鍵。</li>
    <li>一般：AI 一半隨機、一半最佳；無敵：AI 永遠最佳，不會輸。</li>
    <li>復原退回自己上一步（含 AI）；結束後不能復原。</li>
    <li>新遊戲、切難度或先手重開；操作過的未完成局記退出。</li>
    <li>橫、直、斜三子連線勝；滿盤無連線平手。勝 3 分、平手 1 分、敗 0 分；最佳為單局最高分。</li>
  </ol>`,
  demo: {
    steps: demoSteps().map((s, i) => ({ ...s, kind: ['fail', undefined, 'ok'][i] })), // RS5:已占格=失敗、連線=成功
    render: (board) => `<div class="board demo-board">${board.map((mark) => `<div class="cell${mark === PLAYER ? ' player' : ''}">${symbols[mark] ?? ''}</div>`).join('')}</div>`,
  },
});
