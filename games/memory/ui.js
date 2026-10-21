// 翻翻樂畫面層:狀態、渲染、輸入。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  DIFFICULTIES, HIDE_MS, initState, initDailyState, flip, hideState, tickState, scoreFor, resultOf, isOver, isWaiting,
  hasActed, seededRng, demoPlan, remainingPairs, cardView, symbolOf, detailOf, pairsOf, toSave, fromSave, isValidState,
} from './logic.js?v=b9ada7e';
import { createProfile } from '../../shared/profile.js?v=b9ada7e';
import { LocalStore } from '../../shared/stores/local.js?v=b9ada7e';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js?v=b9ada7e';
import { bindThemeToggle } from '../../shared/theme.js?v=b9ada7e';
import { play, music } from '../../shared/sound.js?v=b9ada7e';
import { setupHelp } from '../../shared/help.js?v=b9ada7e';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js?v=b9ada7e';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=b9ada7e';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js?v=b9ada7e';

import { dailyRequested, dailySlot, browserDailyClient, prepareDaily, matchesDailySave } from '../../shared/daily.js?v=b9ada7e';
import { showDailyBanner, showDailyClosed, appendDailySummary } from '../../shared/daily-ui.js?v=b9ada7e';
import { formatDuration } from '../../shared/duration.js?v=b9ada7e';

const GAME_ID = 'memory';
const LABELS = { normal: '一般', hard: '困難', expert: '專家' };
const $ = (id) => document.getElementById(id);
const isDaily = dailyRequested(location.search);
const profile = await createProfile({ store: new LocalStore(), saveSlots: isDaily ? { [GAME_ID]: dailySlot(GAME_ID) } : {} });
let daily = null, dailyClient = null, dailyError = '';
if (isDaily) {
  $('new').textContent = '玩一般模式';
  try { dailyClient = await browserDailyClient(); daily = await prepareDaily(dailyClient, GAME_ID); }
  catch (error) { dailyError = error.message; }
}

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, ... };結算中為 { pending: true }
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面
let focusIdx = 0; // 鍵盤焦點(roving tabindex)
let peek = false; // 結束後按「看盤面」:暫時收起遮罩
let hideTimer = null;
let hideToken = 0;
let nopeIdx = null;

// 紀錄寫入依序執行,避免連按時存檔與結算交錯。
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

function cancelHide() {
  clearTimeout(hideTimer);
  hideTimer = null;
  hideToken++;
}

// 失誤後停留 HIDE_MS 再蓋回;期間若翻了第 3 張,flip 已先蓋回前兩張,計時器作廢。
function scheduleHide() {
  cancelHide();
  const token = hideToken;
  hideTimer = setTimeout(() => {
    if (token !== hideToken || !isWaiting(state)) return;
    state = hideState(state);
    const saved = toSave(state);
    run(() => profile.saveState(GAME_ID, saved));
    render();
  }, HIDE_MS);
}

async function startNew(difficulty = state?.difficulty ?? 'normal') {
  cancelHide();
  state = initState(difficulty);
  gameNo++;
  ended = null;
  peek = false;
  focusIdx = 0;
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
  if (ended) return queue;
  const saved = toSave(state);
  const snap = {
    score: scoreFor(result, pairsOf(state.difficulty), state.misses),
    detail: detailOf(state), difficulty: state.difficulty,
  };
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    if (isDaily) {
      await profile.saveState(GAME_ID, saved);
      try {
        daily.row = await dailyClient.finish(GAME_ID, daily.day, result, null, { misses: saved.misses });
        daily.completed = true;
        dailyError = '';
        result = daily.row.result;
        snap.detail = { ...snap.detail, seconds: daily.row.seconds, misses: daily.row.detail.misses,
          daily: daily.day, daily_play_id: daily.row.detail.play_id };
        snap.score = scoreFor(result, pairsOf(snap.difficulty), snap.detail.misses);
      } catch (error) {
        dailyError = error.message;
        ended = { dailyRetry: true }; render(); return;
      }
    }
    const out = await settlePlay(profile, GAME_ID, {
      result, score: snap.score, difficulty: snap.difficulty, detail: snap.detail,
    });
    if (!out) { if (no === gameNo) { if (isDaily) location.href = './'; else startNew(snap.difficulty); } return; } // 結算失敗且選「不存了」:不記錄、開新局(IR6)
    if (out.play.is_best) best = Math.max(best, snap.score);
    if (no !== gameNo) return;
    ended = {
      result,
      duplicate: out.duplicate, xp: out.xpGained,
      xpBreakdown: out.xpBreakdown,
      newAchievements: out.newAchievements,
      isBest: out.play.is_best,
      bestBefore,
      score: snap.score,
      detail: snap.detail,
    };
    render();
  });
}

// 新遊戲 / 切換難度:有操作未結束 ⇒ quit;0 次操作不記錄;已結算直接開新局。
let confirmingQuit = false;
async function newGame(difficulty = state?.difficulty) {
  if (!state || confirmingQuit) return; // 存檔尚未載入完成:忽略
  if (isDaily) { if (!ended?.pending) { await queue; location.href = './'; } return; }
  if (ended) {
    if (!ended.pending) startNew(difficulty); // 結算中:忽略連點
    else render();
    return;
  }
  const result = resultOnNewGame({ everWon: false, moves: hasActed(state) ? 1 : 0 });
  const note = { score: 0, best, assist: false };
  if (result === 'quit' && needsQuitBestConfirm(note)) {
    confirmingQuit = true;
    const quit = await confirmQuitBest(note);
    confirmingQuit = false;
    if (!quit) { $('difficulty').value = state.difficulty; return; }
  }
  if (result) finish(result);
  startNew(difficulty);
}

function tap(i) {
  profile.input();
  if (!state || ended || isOver(state)) return;
  const next = flip(state, i);
  if (next === state) { // 已翻開/已配對:無效,給輕微抖動
    nopeIdx = i;
    render();
    setTimeout(() => { if (nopeIdx === i) { nopeIdx = null; render(); } }, 300);
    return;
  }
  nopeIdx = null;
  const matchedNow = next.matched.some((m, k) => m && !state.matched[k]);
  state = next;
  const result = resultOf(state);
  play(result ? 'win' : matchedNow ? 'move' : 'tap');
  if (isWaiting(state)) scheduleHide();
  else cancelHide();
  render();
  if (result) finish(result);
  else {
    const saved = toSave(state);
    run(() => profile.saveState(GAME_ID, saved));
  }
}

// ---- 渲染 ----

function buildBoard() {
  const board = $('board');
  board.style.setProperty('--cols', state.cols);
  board.dataset.size = state.difficulty;
  board.innerHTML = state.deck.map((_, i) => `<button class="card" type="button" role="gridcell" tabindex="-1" data-i="${i}">`
    + '<span class="card-inner"><span class="card-back"></span><span class="card-face"></span></span></button>').join('');
}

function renderCards() {
  const cards = $('board').children;
  const waiting = isWaiting(state);
  for (let i = 0; i < cards.length; i++) {
    const v = cardView(state, i);
    const el = cards[i];
    el.className = `card${v === 'hidden' ? '' : ` is-${v}`}${waiting && v === 'open' ? ' is-miss' : ''}${i === nopeIdx ? ' is-nope' : ''}`;
    const face = el.querySelector('.card-face');
    const sym = v === 'hidden' ? '' : symbolOf(state, i);
    if (face.textContent !== sym) face.textContent = sym;
    const pos = `${Math.floor(i / state.cols) + 1} 列 ${(i % state.cols) + 1} 欄`;
    el.setAttribute('aria-label', `${pos}:${v === 'hidden' ? '蓋著' : v === 'matched' ? `已配對 ${sym}` : `翻開 ${sym}`}`);
    el.tabIndex = i === focusIdx ? 0 : -1;
  }
}

function render() {
  if (!state) return;
  renderCards();
  $('seconds').textContent = state.seconds.toLocaleString();
  $('best').textContent = best.toLocaleString();
  $('difficulty').value = state.difficulty;
  $('difficulty').disabled = isDaily;
  if (isDaily) showDailyBanner(document, daily, dailyError);
  const d = DIFFICULTIES[state.difficulty];
  $('status').textContent = `🃏 剩餘 ${remainingPairs(state)} 對 · 步數 ${state.moves} · 失誤 ${state.misses} · ${LABELS[state.difficulty]} ${d.cols}×${d.rows}`;
  renderOverlay();
  music(!ended && (state.status === 'ready' || state.status === 'playing') && $('overlay').hidden); // RS68:遊玩中播背景音樂(選曲見 ? 玩法);終局後看盤面也不重播
}

// 成就 id 可能來自匯入檔:只顯示白名單名稱,其餘一律 escape。
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const achName = (id) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return esc(a ? `${a.icon} ${a.name}` : id);
};

function infoHtml() {
  if (ended.dailyRetry) return '<p>成績尚未送出，請重試</p>';
  if (ended.pending) return '<p>結算中…</p>';
  const { moves, misses, seconds } = ended.detail;
  if (ended.duplicate) return `<p>${DUPLICATE_FINISH_TEXT}</p><p class="overlay-xp">本局 +0 XP</p>`;
  const lines = [
    `<p>${isDaily ? `失誤 ${misses} 次 · ${formatDuration(seconds)}` : `${moves} 步 · 失誤 ${misses} · ${seconds.toLocaleString()} 秒`}</p>`,
    `<p>分數 ${ended.score.toLocaleString()}</p>`,
    `<p class="overlay-xp">本局 +${ended.xp} XP</p>`,
    xpBreakdownHtml(ended.xpBreakdown),
  ];
  if (ended.newAchievements.length) lines.push(`<p>新成就:${ended.newAchievements.map(achName).join('、')}</p>`);
  lines.push(bestLineHtml(ended));
  return lines.join('');
}

function renderOverlay() {
  const overlay = $('overlay');
  if (!ended || peek) {
    overlay.hidden = true;
    return;
  }
  $('overlay-title').textContent = '🎉 全部配對成功!';
  $('overlay-info').innerHTML = infoHtml();
  if (isDaily) appendDailySummary(document, $('overlay-info'), daily);
  $('overlay-actions').innerHTML = `<button class="btn" type="button" data-act="${ended.dailyRetry ? 'retry' : 'new'}">${isDaily ? ended.dailyRetry ? '重試送出成績' : '玩一般模式' : '再玩一次'}</button>`
    + '<button class="btn" type="button" data-act="peek">看盤面</button>';
  overlay.hidden = false;
}

// ---- 輸入:點擊、鍵盤 ----

const cardOf = (e) => e.target.closest?.('.card');
$('board').addEventListener('click', (e) => {
  const el = cardOf(e);
  if (!el) return;
  focusIdx = Number(el.dataset.i);
  tap(focusIdx);
});

const MOVES = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
$('board').addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const el = cardOf(e);
  if (!state || !el) return;
  const i = Number(el.dataset.i);
  if (MOVES[e.key]) {
    e.preventDefault();
    const [dr, dc] = MOVES[e.key];
    const r = Math.min(state.rows - 1, Math.max(0, Math.floor(i / state.cols) + dr));
    const c = Math.min(state.cols - 1, Math.max(0, (i % state.cols) + dc)); // 到邊界停住,不跨列跳
    focusIdx = r * state.cols + c;
    renderCards();
    $('board').children[focusIdx].focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); // click 事件會再觸發一次,這裡自己處理並擋掉
    focusIdx = i;
    tap(i);
  }
});
$('board').addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });

$('new').addEventListener('click', () => newGame());
$('difficulty').addEventListener('change', (e) => newGame(e.target.value));
$('overlay-actions').addEventListener('click', (e) => {
  if (!state) return;
  const cmd = e.target.dataset.act;
  if (cmd === 'retry' && ended?.dailyRetry) { ended = null; finish(resultOf(state)); }
  if (cmd === 'new') newGame();
  if (cmd === 'peek') {
    peek = true;
    renderOverlay();
  }
});

// 計時:第一次翻牌開始,每秒 +1(分頁隱藏時暫停);離頁或隱藏時把秒數寫進存檔。
setInterval(() => {
  if (!state || ended || state.status !== 'playing' || document.visibilityState === 'hidden') return;
  state = tickState(state);
  $('seconds').textContent = state.seconds.toLocaleString();
}, 1000);
const flushSeconds = () => {
  if (state && !ended && state.status === 'playing') {
    const saved = toSave(state);
    run(() => profile.saveState(GAME_ID, saved));
  }
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSeconds(); });
window.addEventListener('pagehide', flushSeconds);

bindThemeToggle($('theme'));

// 載入:有存檔就自動還原(§4.1);等待蓋回中的兩張在 fromSave 已蓋回。否則開新局。
const saved = await profile.loadSave(GAME_ID);
// PM 裁定:開過題卻找不到同日存檔時一律不重新發牌。
if (isDaily && daily?.resumeRequired && !daily.completed && !matchesDailySave(saved, daily, isValidState)) {
  dailyError = '找不到今天的續玩存檔，請回原本的裝置或分頁繼續，今天不能重來';
  daily = null;
}
if (isDaily && (!daily || daily.row?.cleared || (daily.completed && !matchesDailySave(saved, daily, isValidState)))) {
  ended = { closed: true }; $('difficulty').disabled = true;
  showDailyClosed(document, daily, dailyError);
} else if (isDaily || (saved && !saved.daily && isValidState(saved))) {
  const nextState = isDaily ? matchesDailySave(saved, daily, isValidState) ? fromSave(saved) : initDailyState(daily) : fromSave(saved);
  if (isDaily && daily.completed && !isOver(nextState)) {
    ended = { closed: true }; showDailyClosed(document, daily);
  } else {
    // 續玩存檔成功落盤後才公開牌面、接受輸入。失敗留在同一副未公開的牌重試。
    const openBoard = async () => {
      best = await profile.best(GAME_ID);
      profile.startTimer(GAME_ID);
      const result = resultOf(nextState);
      if (isDaily && !result) {
        document.querySelector('.board-wrap').hidden = true;
        $('difficulty').disabled = true;
        try {
          if (await profile.saveState(GAME_ID, toSave(nextState)) === false) throw new Error('Save failed');
        } catch {
          showDailyBanner(document, daily, '今日挑戰續玩存檔尚未儲存，請重試儲存後開始');
          const retry = document.createElement('button');
          retry.className = 'btn'; retry.textContent = '重試儲存';
          retry.addEventListener('click', async () => { retry.disabled = true; await openBoard(); });
          $('daily-banner').append(retry);
          return;
        }
      }
      state = nextState;
      gameNo++;
      document.querySelector('.board-wrap').hidden = false;
      buildBoard(); render();
      if (result) finish(result);
    };
    await openBoard();
  }
} else {
  await startNew('normal');
}

// 示範盤面:固定種子發牌(4×4),配對成功/失敗的牌號由 logic.js 從盤面實算,每步都呼叫 logic.js。
const s0 = initState('normal', seededRng(2026));
const plan = demoPlan(s0);
const s1 = flip(s0, plan.first); // 先翻一張
const s2 = flip(s1, plan.match); // 翻到相同圖案 ⇒ 配對成功
const s3 = flip(flip(s2, plan.missA), plan.missB); // 兩張不同 ⇒ 失誤
const s3h = hideState(s3);
const s4 = flip(s3h, plan.match); // 點已配對的牌 ⇒ 無效(同一物件)
const demoBoard = (s) => `<div class="board demo" style="--cols:${s.cols}">${s.deck.map((_, i) => {
  const v = cardView(s, i);
  return `<div class="card${v === 'hidden' ? '' : ` is-${v}`}"><span class="card-inner"><span class="card-back"></span>`
    + `<span class="card-face">${v === 'hidden' ? '' : symbolOf(s, i)}</span></span></div>`;
}).join('')}</div>`;

setupHelp({
  gameId: GAME_ID,
  title: '翻翻樂玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>每次翻開兩張牌;圖案相同就配對成功,永久朝上。</li>
      <li>圖案不同算一次失誤,稍後蓋回;記住位置再翻。</li>
      <li>等待蓋回時直接點第三張,前兩張會立刻蓋回。</li>
      <li>鍵盤:方向鍵移動、Enter / 空白鍵翻牌。</li>
      <li>今日挑戰:困難4×6，每天同牌、一天一次、無提示、不能重來；離開可續玩且照計時。先比失誤再比秒數，少於20秒不列榜。</li>
      <li><b>勝利</b>:全部配對。<b>分數</b> = 對數 × 100 − 失誤 × 20(最低 10),只看失誤、不看秒數。</li>
    </ol>`,
  demo: {
    render: demoBoard,
    steps: [
      { before: s0, after: s1, caption: '先翻一張,記住它的位置…', result: `…翻開了 ${symbolOf(s1, plan.first)}` },
      { before: s1, after: s2, kind: 'ok', caption: '再翻另一張…', result: `…也是 ${symbolOf(s2, plan.match)},配對成功!` },
      { before: s2, after: s3, kind: 'fail', caption: '翻兩張不同的牌…', result: '…失誤 +1,稍後蓋回' },
      { before: s3h, after: s4, kind: 'fail', caption: '點已配對的牌…', result: '…無效,什麼都不會發生' },
    ],
  },
});
