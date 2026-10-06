import { initState, stepState, undoState, cursorMove, conflicts, clueCount, secondsFor, detailFor, clockState, resumeState, demoSteps } from './logic.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js';
import { settlePlay } from '../../shared/settle.js';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js';

const GAME_ID = 'sudoku';
const $ = (id) => document.getElementById(id);
const visible = () => document.visibilityState !== 'hidden';
const profile = await createProfile({ store: new LocalStore() });
const saved = await profile.loadSave(GAME_ID);
let state = saved ? resumeState(saved, Date.now(), visible()) : initState();
let best = await profile.best(GAME_ID);
let cursor = Math.max(0, state.puzzle.indexOf(0));
let noteMode = false;
let ended = null;
let restarting = false;
let profileStarted = false;
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((error) => console.error(error)); return queue; };
const cells = Array.from({ length: 81 }, (_, i) => {
  const cell = document.createElement('button');
  cell.type = 'button'; cell.dataset.index = i;
  $('board').append(cell);
  return cell;
});
const numbers = Array.from({ length: 9 }, (_, i) => {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn'; btn.textContent = i + 1; btn.dataset.value = i + 1;
  btn.setAttribute('aria-label', `填入 ${i + 1}`);
  $('number-pad').append(btn);
  return btn;
});

function startProfile() {
  if (!profileStarted) { profile.startTimer(GAME_ID); profileStarted = true; }
}
function input() {
  if (ended || restarting || state.result) return;
  startProfile(); profile.input();
  state = clockState(state, 'input', Date.now(), visible());
}
function persist() {
  if (ended || restarting || !state.moves) return queue;
  const snap = structuredClone(state);
  return run(() => profile.saveState(GAME_ID, snap));
}
function renderTime() {
  const seconds = secondsFor(state);
  $('time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function render() {
  const bad = new Set(conflicts(state.board));
  const locked = !!ended || restarting || !!state.result;
  cells.forEach((cell, i) => {
    cell.className = `cell${state.puzzle[i] ? ' given' : ''}${i === cursor ? ' selected' : ''}${bad.has(i) ? ' conflict' : ''}`;
    cell.innerHTML = state.board[i] ? String(state.board[i]) : `<span class="pencil">${numbers.map((_, n) => `<span>${state.notes[i].includes(n + 1) ? n + 1 : ''}</span>`).join('')}</span>`;
    cell.setAttribute('aria-label', `第 ${Math.floor(i / 9) + 1} 列第 ${i % 9 + 1} 格，${state.board[i] || '空格'}${state.puzzle[i] ? '，題目給定' : ''}${state.notes[i].length ? `，筆記 ${state.notes[i].join('、')}` : ''}${bad.has(i) ? '，衝突' : ''}`);
    cell.setAttribute('aria-disabled', String(locked || !!state.puzzle[i]));
    cell.tabIndex = !locked && i === cursor ? 0 : -1;
  });
  $('score').textContent = state.score;
  $('best').textContent = Math.max(best, state.score);
  $('clues').textContent = clueCount(state.puzzle);
  $('difficulty').value = state.difficulty;
  $('difficulty').disabled = restarting || !!ended;
  $('new').disabled = restarting || !!ended;
  $('undo').disabled = locked || !state.history.length;
  $('notes').disabled = locked;
  $('notes').setAttribute('aria-pressed', String(noteMode));
  $('notes').textContent = `✎ 筆記：${noteMode ? '開' : '關'}`;
  $('clear').disabled = locked || !!state.puzzle[cursor];
  numbers.forEach((btn) => { btn.disabled = locked || !!state.puzzle[cursor]; });
  $('status').textContent = restarting ? '正在產生唯一解題目…' : state.result ? '本局已完成' : bad.size ? `${bad.size} 格有衝突，紅色 ! 格可修改` : state.puzzle[cursor] ? '這是題目給定格，請選空格' : noteMode ? '筆記模式：再按同一數字可移除' : '選一格，再填入數字';
  renderTime();
  $('overlay').hidden = !state.result;
  $('again').disabled = !ended || ended.pending || restarting;
  if (!state.result) return;
  const info = $('overlay-info'); info.replaceChildren();
  const add = (text, className = '') => {
    const p = document.createElement('p'); p.textContent = text; p.className = className; info.append(p);
  };
  if (!ended?.play) { add('結算中…'); return; }
  add(`本局 +${ended.xpGained} XP`, 'overlay-xp');
  appendXpBreakdown(info, ended.xpBreakdown, document);
  add(`${secondsFor(state)} 秒 · ${state.score} 分`);
  if (ended.newAchievements.length) add(`新成就：${ended.newAchievements.map((id) => {
    const a = ACHIEVEMENTS.find((item) => item.id === id);
    return a ? `${a.icon} ${a.name}` : id;
  }).join('、')}`);
  const bestText = bestLine({ isBest: ended.play.is_best, bestBefore: ended.bestBefore, score: state.score });
  if (bestText) add(bestText);
}

function finish(result) {
  if (ended) return queue;
  const snap = structuredClone(state);
  ended = { pending: true }; render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, { result, score: snap.score,
      difficulty: snap.difficulty, detail: detailFor(snap) });
    if (!out) { // 結算失敗且選「不存了」:不記錄、開新局(IR6);開新局流程中則交給它
      ended = { abandoned: true };
      if (!restarting) newGame();
      return;
    }
    if (out.play.is_best) best = Math.max(best, snap.score);
    ended = { ...out, bestBefore }; render();
    if (snap.result && !document.querySelector('dialog[open]')) $('again').focus();
  });
}
function afterChange() {
  render();
  if (state.result) return finish('win');
  return persist();
}
function play(value) {
  if (ended || restarting) return;
  input();
  const next = stepState(state, cursor, value, noteMode);
  if (next === state) return;
  state = next; afterChange();
}
function undo() {
  if (ended || restarting) return;
  input();
  const next = undoState(state);
  if (next === state) return;
  state = next; afterChange();
}
function toggleNotes() {
  if (ended || restarting || state.result) return;
  input(); noteMode = !noteMode; render();
}
let confirmingQuit = false;
async function newGame(difficulty = state.difficulty) {
  if (confirmingQuit) return;
  if (restarting || ended?.pending) return;
  if (state.result && !ended) { finish('win'); return; }
  const result = resultOnNewGame({ everWon: state.result === 'win', moves: state.moves });
  const note = { score: state.score, best, assist: state.assist };
  if (!ended && result === 'quit' && needsQuitBestConfirm(note)) {
    confirmingQuit = true;
    const quit = await confirmQuitBest(note);
    confirmingQuit = false;
    if (!quit) { $('difficulty').value = state.difficulty; return; }
  }
  state = clockState(state, 'tick', Date.now());
  restarting = true; render();
  if (!ended && result) await finish(result);
  await queue;
  state = initState(difficulty);
  ended = null; noteMode = false; cursor = Math.max(0, state.puzzle.indexOf(0)); profileStarted = false;
  best = await profile.best(GAME_ID);
  restarting = false; render(); cells[cursor].focus();
}

$('board').addEventListener('click', (event) => {
  if (ended || restarting || state.result) return;
  const cell = event.target.closest('[data-index]');
  if (!cell) return;
  input(); cursor = Number(cell.dataset.index); render(); cells[cursor].focus();
});
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]') || ended || restarting || state.result || event.altKey) return;
  if (['SELECT', 'INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
  if (event.ctrlKey || event.metaKey) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault(); input(); cursor = cursorMove(cursor, event.key); render(); cells[cursor].focus();
  } else if (/^[1-9]$/.test(event.key)) { event.preventDefault(); play(Number(event.key)); }
  else if (['0', 'Backspace', 'Delete'].includes(event.key)) { event.preventDefault(); play(0); }
  else if (event.key.toLowerCase() === 'n') { event.preventDefault(); toggleNotes(); }
});
$('number-pad').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-value]');
  if (btn) play(Number(btn.dataset.value));
});
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => newGame());
$('undo').addEventListener('click', undo);
$('notes').addEventListener('click', toggleNotes);
$('clear').addEventListener('click', () => play(0));
$('difficulty').addEventListener('change', () => newGame($('difficulty').value));
document.addEventListener('visibilitychange', () => {
  state = clockState(state, visible() ? 'visible' : 'hidden', Date.now());
  if (!visible()) persist();
  renderTime();
});
window.addEventListener('pagehide', () => {
  state = clockState(state, 'hidden', Date.now()); persist();
});
setInterval(() => {
  if (ended || restarting || !state.clock) return;
  const before = secondsFor(state);
  state = clockState(state, 'tick', Date.now()); renderTime();
  if (secondsFor(state) !== before && secondsFor(state) % 5 === 0) persist();
}, 1000);
bindThemeToggle($('theme'));
if (state.clock) startProfile();
render();
if (state.result) finish('win');
setupHelp({
  gameId: GAME_ID, title: '數獨玩法', mountAfter: document.querySelector('.navigation .btn'),
  rules: `<ol>
    <li>每列、欄、3×3 宮的 1–9 各一次；題目格不可改。</li>
    <li>點格或方向鍵選格，按 1–9／數字盤填入；0、退格、Delete 或清除可清空。</li>
    <li>筆記可多選，再按移除；正式填入會清除同行、欄、宮的同數字筆記。</li>
    <li>重複數字標紅但可填；復原不限步數，完成後鎖定。</li>
    <li>重開／切難度：已操作未完成記退出；第一次輸入開始計時。</li>
    <li>填滿且無衝突即勝；分數=max(1,10000−秒數)，最佳為單局最高分。</li>
  </ol>`,
  demo: { steps: demoSteps().map((s, i) => ({ ...s, kind: ['fail', 'fail', 'ok'][i] })), render: (board) => {
    const bad = new Set(conflicts(board));
    return `<div class="board demo-board">${board.map((v, i) => `<div class="cell${bad.has(i) ? ' conflict' : ''}">${v || ''}</div>`).join('')}</div>`;
  } },
});
