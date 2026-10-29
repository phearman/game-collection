import {
  SIZE, PEG, CENTER, isHole, initState, tapState, undoState, canUndo, hintState, jumpsFrom, pegCount,
  resultFor, gradeFor, scoreFor, detailFor, newGameResult, findHint, cursorMove,
  HELP_RULES, demoSteps,
} from './logic.js?v=678a533';
import { createProfile } from '../../shared/profile.js?v=678a533';
import { LocalStore } from '../../shared/stores/local.js?v=678a533';
import { ACHIEVEMENTS } from '../../shared/progress.js?v=678a533';
import { bindThemeToggle } from '../../shared/theme.js?v=678a533';
import { play as playSound, music } from '../../shared/sound.js?v=678a533';
import { setupHelp } from '../../shared/help.js?v=678a533';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=678a533';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=678a533';
import { confirmQuitBest } from '../../shared/quit.js?v=678a533';

const GAME_ID = 'peg';
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const saved = await profile.loadSave(GAME_ID);
let state = saved ?? initState();
let best = await profile.best(GAME_ID);
// ended:null = 未結算;{ pending } = 結算中;{ play, ... } = 已結算。終局即自動結算,之後只能開新局。
let cursor = CENTER, ended = null, restarting = false, confirming = false;
// hintConfirmed:本局已同意用提示;算出結果前再按提示不重複確認(算不出時會接著上次進度算)。
let hint = null, hintToken = 0, anim = null, hintConfirmed = false;
let queue = Promise.resolve();
const run = (fn) => (queue = queue.then(fn).catch((error) => console.error(error)));
const locked = () => !!ended || restarting || confirming;
const place = (i) => `第 ${Math.floor(i / SIZE) + 1} 列第 ${i % SIZE + 1} 格`;
const cells = Array.from({ length: SIZE * SIZE }, (_, i) => {
  const cell = document.createElement(isHole(i) ? 'button' : 'div');
  cell.className = isHole(i) ? 'cell' : 'cell off';
  if (isHole(i)) { cell.type = 'button'; cell.dataset.index = i; }
  $('board').append(cell);
  return cell;
});

function pegNode(extra = '') {
  const peg = document.createElement('span');
  peg.className = `peg${extra}`;
  return peg;
}
function render() {
  const targets = new Set(state.selected === null || locked() ? [] : jumpsFrom(state.board, state.selected).map((j) => j[2]));
  cells.forEach((cell, i) => {
    if (!isHole(i)) return;
    const has = state.board[i] === PEG;
    const classes = ['cell'];
    if (state.selected === i) classes.push('selected');
    if (targets.has(i)) classes.push('target');
    if (hint?.move?.[0] === i) classes.push('hint-from');
    if (hint?.move?.[2] === i) classes.push('hint-to');
    if (anim?.to === i) classes.push('landed');
    cell.className = classes.join(' ');
    if (anim?.to === i) {
      cell.style.setProperty('--dx', String((anim.from % SIZE) - (anim.to % SIZE)));
      cell.style.setProperty('--dy', String(Math.floor(anim.from / SIZE) - Math.floor(anim.to / SIZE)));
    }
    const key = `${has ? 1 : 0}${anim?.to === i || anim?.over === i ? 'a' : ''}`;
    if (cell.dataset.mark !== key) {
      cell.replaceChildren(...(has ? [pegNode()] : anim?.over === i ? [pegNode(' ghost')] : []));
      cell.dataset.mark = key;
    }
    cell.setAttribute('aria-label', `${place(i)}，${has ? '棋子' : '空孔'}${state.selected === i ? '，已選取' : ''}${targets.has(i) ? '，可落子' : ''}${hint?.move?.[0] === i ? '，提示起點' : ''}${hint?.move?.[2] === i ? '，提示落點' : ''}`);
    cell.setAttribute('aria-pressed', String(state.selected === i));
    cell.tabIndex = !restarting && i === cursor ? 0 : -1;
  });
  anim = null;
  const pegs = pegCount(state.board);
  $('pegs').textContent = pegs;
  $('moves').textContent = state.history.length;
  $('best').textContent = best;
  $('assist-label').hidden = !state.hintUsed;
  $('status').textContent = restarting ? '正在開新局…' : state.over ? '本局已結束'
    : hint?.text ?? (state.selected === null ? '點一顆棋子' : targets.size ? '點淡點落子，或再點一次取消' : '這顆棋子目前跳不了，換一顆試試');
  for (const id of ['new']) $(id).disabled = restarting || confirming || !!ended?.pending;
  $('undo').disabled = !canUndo(state) || locked();
  $('hint-button').disabled = state.over || locked() || !!hint?.pending;
  $('overlay').hidden = !state.over;
  music(!state.over && !ended); // 遊玩中播背景音樂(選曲見 ? 玩法);終局即淡出
  if (!state.over) return;
  const result = resultFor(state);
  $('overlay-title').textContent = result === 'win' ? '只剩 1 顆！' : `剩 ${pegs} 顆`;
  $('again').disabled = !(ended?.play || ended?.restored) || restarting;
  const info = $('overlay-info'); info.replaceChildren();
  const add = (text, className = '') => { const p = document.createElement('p'); p.className = className; p.textContent = text; info.append(p); };
  add(`評等：${gradeFor(state.board)}`, 'overlay-grade');
  add(`得分 ${scoreFor(state)}${state.board[CENTER] === PEG && pegs === 1 ? '（中央 +5）' : ''}`);
  if (!ended?.play && !ended?.restored) { add('結算中…'); return; }
  if (ended.restored) { add('這局已經結束，按「↻ 新遊戲」再來一局'); return; }
  if (ended.duplicate) add(DUPLICATE_FINISH_TEXT);
  add(`本局 +${ended.xpGained} XP`, 'overlay-xp');
  if (!ended.duplicate) appendXpBreakdown(info, ended.xpBreakdown, document);
  if (ended.assist) add('🧩 輔助局：不刷新最佳');
  if (ended.newAchievements.length) add(`新成就：${ended.newAchievements.map((id) => {
    const a = ACHIEVEMENTS.find((item) => item.id === id); return a ? `${a.icon} ${a.name}` : '';
  }).filter(Boolean).join('、')}`);
  const bestText = bestLine({ isBest: ended.play.is_best, bestBefore: ended.bestBefore, score: scoreFor(state), assist: ended.assist });
  if (bestText) add(bestText);
}

function finish(result) {
  if (ended) return queue;
  const snap = structuredClone(state);
  ended = { pending: true }; render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, { result, score: scoreFor(snap), difficulty: 'normal', detail: detailFor(snap), assist: snap.hintUsed });
    if (!out) { ended = { abandoned: true }; if (!restarting) newGame(); return; }
    if (out.play.is_best) best = Math.max(best, scoreFor(snap));
    ended = { ...out, bestBefore, assist: snap.hintUsed }; render();
    if (snap.over && !document.querySelector('dialog[open]')) $('again').focus();
  });
}
function persist() {
  const snap = structuredClone(state);
  run(() => profile.saveState(GAME_ID, snap));
}
function clearHint() { hintToken++; hint = null; }
function afterChange() {
  clearHint();
  if (state.over) playSound(resultFor(state) === 'win' ? 'win' : 'lose');
  persist(); render();
}
function tap(index) {
  profile.input();
  if (locked() || state.over) return;
  const next = tapState(state, index);
  if (next === state) {
    $('board').classList.remove('shake'); void $('board').offsetWidth;
    $('board').classList.add('shake'); return;
  }
  const jumped = next.history.length > state.history.length;
  if (jumped) {
    const [from, over, to] = next.history.at(-1);
    anim = { from, over, to };
  }
  state = next; playSound('tap');
  if (jumped) afterChange();
  else { persist(); render(); }
  if (state.over) finish(resultFor(state)); // 終局即結算
}
function undo() {
  profile.input();
  if (locked()) return;
  const next = undoState(state);
  if (next === state) return;
  state = next; afterChange();
  if (cells[cursor]) cells[cursor].focus();
}
// 提示:讓出一次畫面後算一次,最多約 300ms;局面改變(token 不同)就作廢。同一盤再按會接著上次的進度算。
// 算出可解步或確認無解才成輔助局;算不出不下結論、不算輔助。
function startHint() {
  if (locked() || state.over) return;
  const token = ++hintToken;
  hint = { pending: true, text: '💡 計算中…' }; render();
  const board = state.board.slice();
  setTimeout(() => {
    if (token !== hintToken) return;
    const out = findHint(board);
    if (out.status === 'unknown') hint = { text: '💡 這盤很難判斷，換個走法試試' };
    else {
      if (!state.hintUsed) { state = hintState(state); persist(); }
      if (out.status === 'move') {
        const [from, , to] = out.move;
        hint = { move: out.move, text: `💡 提示：把${place(from)}的棋子跳到${place(to)}` };
        cursor = from;
      } else hint = { text: '💡 這盤已無法剩一顆，可以復原再試' };
    }
    render();
  }, 0);
}
function requestHint() {
  profile.input();
  if (locked() || state.over || hint?.pending) return;
  if (state.hintUsed || hintConfirmed) { startHint(); return; }
  $('assist-dlg').showModal();
}
async function newGame() {
  if (confirming || restarting || ended?.pending) { render(); return; }
  const result = newGameResult(state);
  if (!ended && result === 'quit') {
    confirming = true; render();
    const quit = await confirmQuitBest({ score: scoreFor(state), best, assist: state.hintUsed });
    confirming = false;
    if (!quit) { render(); return; }
  }
  profile.input(); restarting = true; clearHint(); render();
  if (!ended && result) await finish(result);
  await queue;
  if (!ended && !result) await profile.discardSave(GAME_ID);
  state = initState(); ended = null; cursor = CENTER; hintConfirmed = false;
  best = await profile.best(GAME_ID); profile.startTimer(GAME_ID); restarting = false;
  render(); cells[cursor].focus();
}

$('board').addEventListener('click', (event) => {
  const cell = event.target.closest('[data-index]');
  if (!cell) return;
  cursor = Number(cell.dataset.index); tap(cursor);
});
$('board').addEventListener('focusin', (event) => {
  const cell = event.target.closest('[data-index]');
  if (cell) cursor = Number(cell.dataset.index);
});
$('board').addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || restarting) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault(); profile.input(); cursor = cursorMove(cursor, event.key); render(); cells[cursor].focus();
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tap(cursor); }
});
$('board').addEventListener('animationend', (event) => {
  if (event.animationName === 'shake') $('board').classList.remove('shake');
});
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => newGame());
$('undo').addEventListener('click', undo);
$('hint-button').addEventListener('click', requestHint);
$('assist-dlg').addEventListener('click', (event) => {
  const act = event.target.closest('[data-act]')?.dataset.act;
  if (act !== 'assist' && act !== 'cancel') return;
  $('assist-dlg').close();
  if (act === 'assist') { hintConfirmed = true; startHint(); }
});
bindThemeToggle($('theme'));
const demoBoard = (board) => `<div class="board demo-board">${board.map((v, i) => (isHole(i)
  ? `<div class="cell">${v === PEG ? '<span class="peg"></span>' : ''}</div>` : '<div class="cell off"></div>')).join('')}</div>`;
setupHelp({
  gameId: GAME_ID, title: '孔明棋玩法', mountAfter: document.querySelector('.navigation .btn'),
  rules: `<ol>${HELP_RULES.map((text) => `<li>${text}</li>`).join('')}</ol>`,
  demo: { steps: demoSteps(), render: demoBoard },
});
profile.startTimer(GAME_ID);
render();
// 只在終局當下結算一次;開頁載入已結束的存檔(例:另一分頁已結算)只顯示結果並清掉存檔,不再補結算。
if (state.over) { ended = { restored: true }; run(() => profile.discardSave(GAME_ID)); render(); }
