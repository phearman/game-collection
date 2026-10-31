import { initState, initDailyState, isValidState, stepState, undoState, cursorMove, conflicts, clueCount, secondsFor, detailFor, finishDifficultyFor, clockState, resumeState, demoSteps, candidates, nextHint, assistState, autoCandState, fromSave, clearBoardState } from './logic.js?v=4a61272';
import { createProfile } from '../../shared/profile.js?v=4a61272';
import { formatDuration } from '../../shared/duration.js?v=4a61272';
import { LocalStore } from '../../shared/stores/local.js?v=4a61272';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js?v=4a61272';
import { bindThemeToggle } from '../../shared/theme.js?v=4a61272';
import { play as playSound, music } from '../../shared/sound.js?v=4a61272';
import { setupHelp } from '../../shared/help.js?v=4a61272';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=4a61272';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=4a61272';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js?v=4a61272';
import { dailyRequested, dailySlot, browserDailyClient, prepareDaily, matchesDailySave, finishDailyOrExpire, dailyPlayDetail, dailyPracticeRequested, practiceSlot, preparePractice, PRACTICE_ASSIST_TEXT, dailyResumeRequested, prepareResume } from '../../shared/daily.js?v=4a61272';
import { showDailyBanner, showDailyClosed, appendDailySummary } from './daily-ui.js?v=4a61272';

const GAME_ID = 'sudoku';
const ASSIST_TEXT = '使用提示後本局變成輔助局:不刷新最佳、XP 打對折。要繼續嗎?';
const ASSIST_DAILY_TEXT = '使用提示或自動候選後,這局今日挑戰變成輔助局:不列今日排行、不刷新最佳、XP 打對折(連續天數照算)。要繼續嗎?';
const $ = (id) => document.getElementById(id);
const visible = () => document.visibilityState !== 'hidden';
// RS91:?practice=YYYY-MM-DD 重玩往日題目(練習);沿用每日盤面與介面,但⛔ 送每日成績、⛔ 進排行。
const practiceDay = dailyPracticeRequested(location.search);
// IR74:?resume=YYYY-MM-DD 接回自己那天未完成、仍在收件期限內的每日局(照常計入那天排行)。
const resumeDay = practiceDay ? null : dailyResumeRequested(location.search);
const isDaily = dailyRequested(location.search) || !!practiceDay || !!resumeDay;
let daily = null;
let dailyClient = null;
let dailyError = '';
let dailyExpired = ''; // IR68:伺服器過了收件時間,這局照一般局記錄、不列排行
if (isDaily) {
  try { dailyClient = await browserDailyClient(); daily = practiceDay ? await preparePractice(dailyClient, GAME_ID, practiceDay)
    : resumeDay ? await prepareResume(dailyClient, GAME_ID, resumeDay) : await prepareDaily(dailyClient, GAME_ID); }
  catch (error) { dailyError = error.message; }
}
// Select the slot only after the server has confirmed the challenge day.
const profile = await createProfile({ store: new LocalStore(), saveSlots: daily ? { [GAME_ID]: practiceDay ? practiceSlot(GAME_ID) : dailySlot(GAME_ID, daily.day) } : {} });

const saved = isDaily && !daily ? null : await profile.loadSave(GAME_ID);
let state = isDaily
  ? !daily || daily.row?.cleared ? null : matchesDailySave(saved, daily, isValidState) ? resumeState(fromSave(saved), Date.now(), visible())
    : daily.completed ? null : initDailyState(daily)
  : saved && !saved.daily ? resumeState(fromSave(saved), Date.now(), visible()) : initState();
if (daily?.completed && state && !state.result) state = null;
async function difficultyBest(difficulty) {
  if (difficulty === 'easy') return 0;
  const summary = await profile.summary();
  return summary.games.find((game) => game.id === GAME_ID)?.stats?.detail?.best_by_difficulty?.[difficulty] ?? 0;
}
let best = await difficultyBest(state?.difficulty ?? 'normal');
let cursor = Math.max(0, state?.puzzle.indexOf(0) ?? 0);
let noteMode = false;
let ended = state ? null : { closed: true };
let restarting = false;
let profileStarted = false;
let activeHint = null;
let pendingAssist = null;
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
  if (ended || restarting) return queue;
  const snap = structuredClone(state);
  return run(() => profile.saveState(GAME_ID, snap));
}
function renderTime() {
  if (!state) return;
  const seconds = secondsFor(state);
  $('time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function render() {
  if (!state) return;
  const bad = new Set(conflicts(state.board));
  const locked = !!ended || restarting || !!state.result;
  cells.forEach((cell, i) => {
    cell.className = `cell${state.puzzle[i] ? ' given' : ''}${i === cursor ? ' selected' : ''}${bad.has(i) ? ' conflict' : ''}${activeHint?.related.includes(i) ? ' hint-related' : ''}${activeHint?.index === i ? ' hint-target' : ''}`;
    const shown = state.autoCand ? candidates(state.board, i) : state.notes[i];
    cell.replaceChildren();
    if (state.board[i]) cell.textContent = state.board[i];
    else {
      cell.textContent = '';
      const pencil = document.createElement('span'); pencil.className = 'pencil';
      for (let n = 1; n <= 9; n++) {
        const digit = document.createElement('span'); digit.textContent = shown.includes(n) ? n : ''; pencil.append(digit);
      }
      cell.append(pencil);
    }
    cell.setAttribute('aria-label', `第 ${Math.floor(i / 9) + 1} 列第 ${i % 9 + 1} 格，${state.board[i] || '空格'}${state.puzzle[i] ? '，題目給定' : ''}${shown.length ? `，${state.autoCand ? '候選' : '筆記'} ${shown.join('、')}` : ''}${bad.has(i) ? '，衝突' : ''}${activeHint?.index === i ? '，提示格' : ''}`);
    cell.setAttribute('aria-disabled', String(locked || !!state.puzzle[i]));
    cell.tabIndex = !locked && i === cursor ? 0 : -1;
  });
  $('score').textContent = state.score;
  $('best').textContent = state.difficulty === 'easy' ? '—' : best;
  $('clues').textContent = clueCount(state.puzzle);
  $('difficulty').value = state.difficulty;
  $('difficulty').disabled = isDaily || restarting || !!ended;
  $('new').disabled = restarting || !!ended;
  $('undo').disabled = locked || !state.history.length;
  $('reset').hidden = !isDaily; // RS75:清空重來只在每日挑戰
  $('reset').disabled = locked;
  $('notes').disabled = locked;
  $('notes').setAttribute('aria-pressed', String(noteMode));
  $('notes').textContent = `✎ 筆記：${noteMode ? '開' : '關'}`;
  $('clear').disabled = locked || !!state.puzzle[cursor];
  // RS108:今日挑戰也開放提示與自動候選;用過即輔助局、不列今日排行。
  $('hint-button').disabled = locked;
  $('auto-cand').disabled = locked;
  $('assist-rank-note').hidden = !rankedDaily();
  $('auto-cand').checked = state.autoCand;
  $('assist-label').hidden = !state.assist;
  $('hint-message').hidden = !activeHint;
  $('hint-text').textContent = activeHint?.text ?? '';
  $('hint-apply').textContent = activeHint?.type === 'wrong' ? '清除這格' : '填入答案';
  $('hint-apply').disabled = locked;
  numbers.forEach((btn) => { btn.disabled = locked || !!state.puzzle[cursor]; });
  $('status').textContent = restarting ? '正在產生唯一解題目…' : state.result ? '本局已完成' : bad.size ? `${bad.size} 格有衝突，紅色 ! 格可修改` : state.puzzle[cursor] ? '這是題目給定格，請選空格' : noteMode ? '筆記模式：再按同一數字可移除' : '選一格，再填入數字';
  renderTime();
  if (isDaily) showDailyBanner(document, daily, dailyError || dailyExpired);
  $('overlay').hidden = !state.result;
  music(!state.result && !ended); // RS68:遊玩中播背景音樂(選曲見 ? 玩法);完成即淡出
  $('again').disabled = !ended || ended.pending || restarting;
  $('again').textContent = isDaily ? ended?.dailyRetry ? '重試送出成績' : '玩一般模式' : '確定 · 再玩一次';
  if (!state.result) return;
  const info = $('overlay-info'); info.replaceChildren();
  const add = (text, className = '') => {
    const p = document.createElement('p'); p.textContent = text; p.className = className; info.append(p);
  };
  if (ended?.dailyRetry) { add('成績尚未送出，請重試'); return; }
  if (!ended?.play) { add('結算中…'); return; }
  if (dailyExpired) add(dailyExpired);
  if (ended.duplicate) add(DUPLICATE_FINISH_TEXT);
  add(`本局 +${ended.xpGained} XP`, 'overlay-xp');
  if (!ended.duplicate) appendXpBreakdown(info, ended.xpBreakdown, document);
  add(`${formatDuration(secondsFor(state))} · ${state.score} 分`);
  if (ended.assist) add(daily?.practice ? PRACTICE_ASSIST_TEXT : '🧩 輔助局:不刷新最佳');
  if (ended.newAchievements.length) add(`新成就：${ended.newAchievements.map((id) => {
    const a = ACHIEVEMENTS.find((item) => item.id === id);
    return a ? `${a.icon} ${a.name}` : id;
  }).join('、')}`);
  const bestText = bestLine({ isBest: ended.play.is_best, bestBefore: ended.bestBefore, score: state.score, assist: ended.assist });
  if (bestText) add(bestText);
  if (isDaily) appendDailySummary(document, info, daily);
}

// RS108:今日挑戰(含接回往日那局;⛔ 練習、⛔ 已過收件時間)才有排行可失去。
function rankedDaily() { return isDaily && !!daily && !daily.practice && !dailyExpired; }
function finish(result) {
  if (ended) return queue;
  const snap = structuredClone(state);
  ended = { pending: true }; render();
  return run(async () => {
    const bestBefore = best;
    if (isDaily && !daily.practice) {
      await profile.saveState(GAME_ID, snap);
      try {
        const outcome = await finishDailyOrExpire(dailyClient, daily, GAME_ID, result, null, snap.assist ? { assisted: true } : {});
        if (outcome.expired) dailyExpired = outcome.expired;
        else {
          daily.row = outcome.row; daily.completed = true;
          if (outcome.row.detail?.assisted === true) { snap.assist = true; state.assist = true; }
        }
        dailyError = '';
      } catch (error) {
        if (error.code === 'DAILY_ABANDONED') { // IR74:那局已在別的分頁放棄 ⇒ 丟掉存檔、關閉,⛔ 重試迴圈
          await profile.discardSave(GAME_ID); dailyError = error.message; ended = { closed: true };
          showDailyClosed(document, null, dailyError, { game: GAME_ID }); return;
        }
        // RS73:錯誤狀態保留到重試成功,每次 render 都帶入,說明列才不會在錯誤橫幅下重新出現。
        dailyError = error.message;
        ended = { dailyRetry: true }; render(); return;
      }
    }
    const out = await settlePlay(profile, GAME_ID, { result, score: snap.score,
      difficulty: finishDifficultyFor(snap), detail: { ...detailFor(snap),
        ...(isDaily ? dailyPlayDetail(daily, dailyExpired) : {}) }, assist: snap.assist || !!daily?.practice }); // D56:往日練習一律輔助局
    if (!out) { // 結算失敗且選「不存了」:不記錄、開新局(IR6);開新局流程中則交給它
      ended = { abandoned: true };
      if (isDaily) { location.href = './'; return; }
      if (!restarting) newGame();
      return;
    }
    // is_best 已是「打破該難度最佳」,不必再讀網路(讀取失敗會卡在結算中,RS86 審查 #1)。
    if (out.play.is_best) best = Math.max(best, snap.score);
    ended ={ ...out, bestBefore, assist: snap.assist || !!daily?.practice }; render();
    if (snap.result && !document.querySelector('dialog[open]')) $('again').focus();
  });
}
function afterChange() {
  render();
  if (state.result) return finish('win');
  return persist();
}
function play(value, index = cursor, asNote = noteMode) {
  if (ended || restarting) return;
  input();
  const next = stepState(state, index, value, asNote);
  if (next === state) return;
  playSound('tap');
  if (next.result === 'win' && !state.result) playSound('win');
  state = next; activeHint = null; afterChange();
}
function undo() {
  if (ended || restarting) return;
  input();
  const next = undoState(state);
  if (next === state) return;
  state = next; activeHint = null; afterChange();
}
function toggleNotes() {
  if (ended || restarting || state.result) return;
  input(); noteMode = !noteMode; render();
}

function useAssist(kind) {
  if (ended || restarting || state.result) return;
  input();
  const firstAssist = !state.assist;
  state = assistState(state);
  if (firstAssist && rankedDaily()) {
    // Background only: even a synchronous client failure must never block a hint.
    try { Promise.resolve(dailyClient.markAssisted(GAME_ID, daily.day)).catch(() => {}); } catch {}
  }
  if (kind === 'hint') activeHint = nextHint(state);
  else state = autoCandState(state, true);
  persist(); render();
}
function requestAssist(kind) {
  if (ended || restarting || state.result) return;
  if (kind === 'hint' && activeHint) { activeHint = null; render(); return; }
  if (state.assist) { useAssist(kind); return; }
  pendingAssist = kind;
  $('assist-text').textContent = rankedDaily() ? ASSIST_DAILY_TEXT : ASSIST_TEXT;
  $('assist-dlg').showModal();
}
let confirmingQuit = false;
async function newGame(difficulty = state?.difficulty ?? 'normal') {
  if (isDaily) { if (!ended?.pending) { await queue; location.href = './'; } return; }
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
  else if (!ended) await run(() => profile.discardSave(GAME_ID));
  await queue;
  state = initState(difficulty);
  ended = null; noteMode = false; activeHint = null; cursor = Math.max(0, state.puzzle.indexOf(0)); profileStarted = false;
  best = await difficultyBest(difficulty);
  restarting = false; render(); persist(); cells[cursor].focus();
}

$('board').addEventListener('click', (event) => {
  if (ended || restarting || state.result) return;
  const cell = event.target.closest('[data-index]');
  if (!cell) return;
  input();
  const index = Number(cell.dataset.index);
  if (index !== activeHint?.index) activeHint = null;
  cursor = index; render(); cells[cursor].focus();
});
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]') || ended || restarting || state.result || event.altKey) return;
  if (['SELECT', 'INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
  if (event.ctrlKey || event.metaKey) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault(); input();
    const index = cursorMove(cursor, event.key);
    if (index !== activeHint?.index) activeHint = null;
    cursor = index; render(); cells[cursor].focus();
  } else if (/^[1-9]$/.test(event.key)) { event.preventDefault(); play(Number(event.key)); }
  else if (['0', 'Backspace', 'Delete'].includes(event.key)) { event.preventDefault(); play(0); }
  else if (event.key.toLowerCase() === 'n') { event.preventDefault(); toggleNotes(); }
});
$('number-pad').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-value]');
  if (btn) play(Number(btn.dataset.value));
});
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => {
  if (ended?.dailyRetry) { ended = null; finish('win'); } else newGame();
});
$('undo').addEventListener('click', undo);
// RS75:每日挑戰清空重來,先確認;計時照算、不送成績。
$('reset').addEventListener('click', () => {
  if (!isDaily || ended || restarting || state.result) return;
  $('reset-dlg').showModal();
});
$('reset-dlg').addEventListener('click', (event) => {
  const act = event.target.closest('[data-act]')?.dataset.act;
  if (act !== 'reset' && act !== 'cancel') return;
  $('reset-dlg').close();
  if (act !== 'reset' || !isDaily || ended || restarting || state.result) return;
  input();
  state = clearBoardState(state); activeHint = null; noteMode = false;
  persist(); render();
});
$('reset-dlg').addEventListener('close', () => { cells[cursor].focus(); });
$('notes').addEventListener('click', toggleNotes);
$('clear').addEventListener('click', () => play(0));
$('difficulty').addEventListener('change', () => newGame($('difficulty').value));
$('hint-button').addEventListener('click', () => requestAssist('hint'));
$('auto-cand').addEventListener('change', () => {
  const on = $('auto-cand').checked;
  $('auto-cand').checked = state.autoCand;
  if (ended || restarting || state.result) return;
  if (on) requestAssist('candidates');
  else { input(); state = autoCandState(state, false); persist(); render(); }
});
$('assist-dlg').addEventListener('click', (event) => {
  const act = event.target.closest('[data-act]')?.dataset.act;
  if (act !== 'assist' && act !== 'cancel') return;
  const kind = pendingAssist;
  pendingAssist = null;
  $('assist-dlg').close();
  if (act === 'assist' && kind) useAssist(kind);
});
$('assist-dlg').addEventListener('cancel', () => { pendingAssist = null; });
$('assist-dlg').addEventListener('close', () => { pendingAssist = null; cells[cursor].focus(); });
$('hint-dismiss').addEventListener('click', () => { activeHint = null; render(); cells[cursor].focus(); });
$('hint-apply').addEventListener('click', () => {
  if (!activeHint || ended || restarting || state.result) return;
  const hint = activeHint;
  cursor = hint.index;
  play(hint.type === 'wrong' ? 0 : hint.value, hint.index, false);
  if (!state.result) cells[cursor].focus();
});
document.addEventListener('visibilitychange', () => {
  if (!state) return;
  state = clockState(state, visible() ? 'visible' : 'hidden', Date.now());
  if (!visible()) persist();
  renderTime();
});
window.addEventListener('pagehide', () => {
  if (!state) return;
  state = clockState(state, 'hidden', Date.now()); persist();
});
setInterval(() => {
  if (ended || restarting || !state.clock) return;
  const before = secondsFor(state);
  state = clockState(state, 'tick', Date.now()); renderTime();
  if (secondsFor(state) !== before && secondsFor(state) % 5 === 0) persist();
}, 1000);
bindThemeToggle($('theme'));
if (state?.clock) startProfile();
if (isDaily && state) { startProfile(); await persist(); }
if (isDaily && !state) {
  $('difficulty').disabled = true; $('hint-button').disabled = true; $('auto-cand').disabled = true;
  $('number-pad').hidden = true; $('tools')?.setAttribute('hidden', '');
  showDailyClosed(document, daily, dailyError, { game: GAME_ID, client: dailyClient });
}
render();
if (state?.result) finish('win');
setupHelp({
  gameId: GAME_ID, title: '數獨玩法', mountAfter: document.querySelector('.navigation .btn'),
  rules: `<ol>
    <li>列欄宮各含1–9，給定格不可改。</li>
    <li>引導學習給定 46、有自動候選；入門給定 56。</li>
    <li>點格／方向鍵選格，1–9填入，0清空；N筆記。</li>
    <li>衝突標紅，填入清相關筆記；💡 提示附理由。</li>
    <li>引導學習或用提示、候選為輔助局：不刷新最佳、XP對折、不列今日榜。最佳分難度，入門不列總最佳。</li>
    <li>首次輸入計時，重開記退出；填滿無衝突勝，分數=max(1,10000−秒)。每日挑戰成績從開題起算，含離開時間；本局只計遊玩時間，可清空重來。</li>
  </ol>`,
  demo: { steps: demoSteps().map((s, i) => ({ ...s, kind: ['fail', 'fail', undefined, 'ok'][i] })), render: (frame) => {
    const board = frame.board ?? frame;
    const hint = frame.hint;
    const bad = new Set(conflicts(board));
    const demo = document.createElement('div'); demo.className = 'board demo-board';
    board.forEach((v, i) => {
      const cell = document.createElement('div');
      cell.className = `cell${bad.has(i) ? ' conflict' : ''}${hint?.related.includes(i) ? ' hint-related' : ''}${hint?.index === i ? ' hint-target' : ''}`;
      cell.textContent = v || ''; demo.append(cell);
    });
    return demo.outerHTML;
  } },
});
