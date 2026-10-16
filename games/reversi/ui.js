import {
  BLACK, DIFFICULTIES, ORDERS, AI_DELAY, PASS_DELAY, initState, newGameState, stepState, aiStepState,
  undoState, canUndo, isPlayerTurn, playerColor, legalMoves, counts, detailFor, resultFor, scoreFor,
  cursorMove, HELP_RULES, demoSteps,
} from './logic.js?v=19c6738';
import { createProfile } from '../../shared/profile.js?v=19c6738';
import { LocalStore } from '../../shared/stores/local.js?v=19c6738';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js?v=19c6738';
import { bindThemeToggle } from '../../shared/theme.js?v=19c6738';
import { play as playSound } from '../../shared/sound.js?v=19c6738';
import { setupHelp } from '../../shared/help.js?v=19c6738';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=19c6738';
import { settlePlay } from '../../shared/settle.js?v=19c6738';
import { confirmQuitBest } from '../../shared/quit.js?v=19c6738';
import { load, save } from '../../shared/storage.js?v=19c6738';

const GAME_ID = 'reversi';
const PREF_KEY = `preferences:${GAME_ID}`;
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const preferences = load(PREF_KEY, {});
const saved = await profile.loadSave(GAME_ID);
let state = saved ?? initState(
  DIFFICULTIES.includes(preferences?.difficulty) ? preferences.difficulty : 'normal',
  ORDERS.includes(preferences?.order) ? preferences.order : 'player', preferences?.lastFirst,
);
let hints = preferences?.hints !== false;
const savePreferences = () => save(PREF_KEY, { difficulty: state.difficulty, order: state.order, lastFirst: state.first, hints });
savePreferences();
let best = await profile.best(GAME_ID);
let cursor = 19, ended = null, restarting = false, confirming = false;
let aiTimer = null, passTimer = null, passing = false, generation = 0;
let animated = new Set();
let queue = Promise.resolve();
const run = (fn) => (queue = queue.then(fn).catch((error) => console.error(error)));
const locked = () => !!ended || restarting || confirming || passing;
const colorName = (color) => color === BLACK ? '黑棋' : '白棋';
const cells = Array.from({ length: 64 }, (_, i) => {
  const cell = document.createElement('button');
  cell.type = 'button'; cell.className = 'cell'; cell.dataset.index = i;
  $('board').append(cell);
  return cell;
});
function cancelTimers() {
  clearTimeout(aiTimer); clearTimeout(passTimer);
  aiTimer = passTimer = null; passing = false; generation++;
}
function render() {
  const legal = new Set(isPlayerTurn(state) && !locked() ? legalMoves(state) : []);
  cells.forEach((cell, i) => {
    const mark = state.board[i];
    cell.className = `cell${hints && legal.has(i) ? ' legal' : ''}${state.last === i ? ' last' : ''}${animated.has(i) ? ' flip' : ''}`;
    if (cell.dataset.mark !== String(mark)) {
      cell.replaceChildren();
      if (mark) {
        const disc = document.createElement('span');
        disc.className = `disc ${mark === BLACK ? 'black' : 'white'}`;
        cell.append(disc);
      }
      cell.dataset.mark = mark;
    }
    const distance = state.last === null ? 0 : Math.max(Math.abs((i >> 3) - (state.last >> 3)), Math.abs(i % 8 - state.last % 8));
    cell.style.setProperty('--flip-delay', `${distance * 20}ms`);
    cell.setAttribute('aria-label', `第 ${(i >> 3) + 1} 列第 ${i % 8 + 1} 格，${mark ? colorName(mark) : '空格'}${legal.has(i) ? '，可下' : ''}${state.last === i ? '，最後一手' : ''}`);
    cell.setAttribute('aria-disabled', String(!legal.has(i)));
    cell.tabIndex = !ended && !restarting && i === cursor ? 0 : -1;
  });
  const { black, white } = counts(state);
  $('discs').textContent = `黑 ${black} · 白 ${white}`;
  $('color').textContent = `你執${colorName(playerColor(state))}`;
  $('score').textContent = scoreFor(state);
  $('best').textContent = Math.max(best, scoreFor(state));
  $('status').textContent = state.over ? '本局已結束' : restarting ? '正在開新局…' : passing ? `${colorName(state.passed)} 無處可下，跳過` : isPlayerTurn(state) ? '輪到你' : 'AI 思考中…';
  $('difficulty').value = state.difficulty;
  $('order').value = state.order;
  for (const id of ['new', 'difficulty', 'order']) $(id).disabled = restarting || confirming || !!ended?.pending;
  $('undo').disabled = !canUndo(state) || !!ended || restarting || confirming;
  $('hints').textContent = `提示：${hints ? '開' : '關'}`;
  $('hints').setAttribute('aria-pressed', String(hints));
  $('overlay').hidden = !state.over;
  $('again').disabled = !ended || !!ended.pending || restarting;
  if (!state.over) return;
  $('overlay-title').textContent = { win: '你贏了！', lose: 'AI 勝利', draw: '平手！' }[resultFor(state)];
  const info = $('overlay-info'); info.replaceChildren();
  const add = (text, className = '') => { const p = document.createElement('p'); p.className = className; p.textContent = text; info.append(p); };
  const detail = detailFor(state);
  add(`你的棋子 ${detail.discs} · AI ${detail.opp_discs} · 得分 ${scoreFor(state)}`);
  if (!ended?.play) { add('結算中…'); return; }
  add(`本局 +${ended.xpGained} XP`, 'overlay-xp');
  appendXpBreakdown(info, ended.xpBreakdown, document);
  if (ended.newAchievements.length) add(`新成就：${ended.newAchievements.map((id) => {
    const a = ACHIEVEMENTS.find((item) => item.id === id); return a ? `${a.icon} ${a.name}` : '';
  }).filter(Boolean).join('、')}`);
  const bestText = bestLine({ isBest: ended.play.is_best, bestBefore: ended.bestBefore, score: scoreFor(state) });
  if (bestText) add(bestText);
}
function finish(result) {
  if (ended) return queue;
  cancelTimers();
  const snap = structuredClone(state);
  ended = { pending: true }; render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, { result, score: scoreFor(snap), difficulty: snap.difficulty, detail: detailFor(snap) });
    if (!out) { ended = { abandoned: true }; if (!restarting) newGame(); return; }
    best = Math.max(best, out.play.is_best ? scoreFor(snap) : best);
    ended = { ...out, bestBefore }; render();
    if (snap.over && !document.querySelector('dialog[open]')) $('again').focus();
  });
}
function scheduleAi() {
  if (isPlayerTurn(state) || state.over || locked() || aiTimer !== null) return;
  const token = generation;
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (token !== generation || locked()) return;
    state = aiStepState(state); playSound('tap'); afterChange();
  }, AI_DELAY);
}
function afterChange(persist = true) {
  animated = new Set(persist ? state.flipped : []);
  if (state.over) {
    playSound(resultFor(state) === 'win' ? 'win' : resultFor(state) === 'lose' ? 'lose' : 'score');
    finish(resultFor(state)); return;
  }
  if (persist) { const snap = structuredClone(state); run(() => profile.saveState(GAME_ID, snap)); }
  if (state.passed) {
    passing = true;
    const token = generation;
    clearTimeout(passTimer);
    passTimer = setTimeout(() => {
      passTimer = null;
      if (token !== generation) return;
      passing = false; render(); scheduleAi();
    }, PASS_DELAY);
  }
  render(); scheduleAi();
}
function play(index) {
  profile.input();
  if (locked() || !isPlayerTurn(state)) return;
  const next = stepState(state, index);
  if (next === state) {
    $('board').classList.remove('shake'); void $('board').offsetWidth;
    $('board').classList.add('shake'); playSound('tap'); return;
  }
  state = next; playSound('tap'); afterChange();
}
function undo() {
  profile.input();
  if (ended || restarting || confirming) return;
  const next = undoState(state);
  if (next === state) return;
  cancelTimers(); state = next; afterChange();
}
async function newGame(difficulty = state.difficulty, order = state.order) {
  if (confirming || restarting || ended?.pending) { render(); return; }
  const result = resultOnNewGame(state);
  if (!ended && result === 'quit') {
    confirming = true; render();
    const quit = await confirmQuitBest({ score: scoreFor(state), best });
    confirming = false;
    if (!quit) { render(); scheduleAi(); return; }
  }
  profile.input(); restarting = true; cancelTimers(); render();
  if (!ended && result) await finish(result);
  await queue;
  if (!ended && !result) await profile.discardSave(GAME_ID);
  state = newGameState(state, difficulty, order); savePreferences();
  ended = null; cursor = 19; animated.clear();
  best = await profile.best(GAME_ID); profile.startTimer(GAME_ID); restarting = false;
  // 保存先手與 AI 待回應狀態，重整仍是同一局。
  afterChange(); cells[cursor].focus();
}
$('board').addEventListener('click', (event) => {
  const cell = event.target.closest('[data-index]');
  if (!cell) return;
  cursor = Number(cell.dataset.index); play(cursor); render();
});
$('board').addEventListener('focusin', (event) => {
  const cell = event.target.closest('[data-index]');
  if (cell) cursor = Number(cell.dataset.index);
});
$('board').addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || ended || restarting) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault(); profile.input(); cursor = cursorMove(cursor, event.key); render(); cells[cursor].focus();
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); play(cursor); }
});
$('board').addEventListener('animationend', (event) => {
  if (event.animationName === 'shake') $('board').classList.remove('shake');
});
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => newGame());
$('undo').addEventListener('click', undo);
$('difficulty').addEventListener('change', () => newGame($('difficulty').value));
$('order').addEventListener('change', () => newGame(state.difficulty, $('order').value));
$('hints').addEventListener('click', () => { profile.input(); hints = !hints; savePreferences(); render(); });
bindThemeToggle($('theme'));
setupHelp({
  gameId: GAME_ID, title: '黑白棋玩法', mountAfter: document.querySelector('.navigation .btn'),
  rules: `<ol>${HELP_RULES.map((text) => `<li>${text}</li>`).join('')}</ol>`,
  demo: { steps: demoSteps(), render: (board) => `<div class="board demo-board">${board.map((mark) => `<div class="cell">${mark ? `<span class="disc ${mark === BLACK ? 'black' : 'white'}"></span>` : ''}</div>`).join('')}</div>` },
});
profile.startTimer(GAME_ID);
afterChange(!saved);
