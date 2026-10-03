// Wordle 畫面層:狀態、渲染、輸入。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  WORD_LEN, MAX_GUESSES, DIFFICULTIES, evaluate, isWord, initState, typeState, eraseState, guessError, submitState,
  keyStates, scoreFor, overlayFor, toSave, fromSave, isValidState, routeKey,
  assistState, letterHint, canReveal, revealState, candidatesState, fillState, visibleCandidates,
} from './logic.js';
import { HINTS } from './hints.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnGameOver, resultOnNewGame, needsQuitConfirm } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { xpBreakdownHtml } from '../../shared/xp-explain.js';
import { load, save } from '../../shared/storage.js';

const GAME_ID = 'wordle';
const DIFF_KEY = 'difficulty:wordle'; // 上次選的難度(開新局用)
const HC_KEY = 'wordle:contrast'; // 高對比配色
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, newAchievements, isBest, bestBefore, score };結算中為 { pending: true }
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面
let pendingDifficulty = null; // 確認放棄後要切換的難度
let activeHint = null; // 目前顯示的提示(letters / sentence / candidates);畫面狀態,提示進度本身在 state

// 紀錄寫入依序執行,避免存檔與結算交錯。
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

// 遊戲 state 的進度欄位 → progress.js 的 §4.2 判斷用。
const progressOf = (s) => ({ everWon: s.won, moves: s.guesses.length, settled: !!ended });

// 難度選單值:normal / hard / assist(輔助模式 = normal + 輔助局,RS9)。
function difficultyPref() {
  const d = load(DIFF_KEY, 'normal');
  return DIFFICULTIES.includes(d) || d === 'assist' ? d : 'normal';
}

// 最近 10 局答案(stats.detail.recent)⇒ 出題時避開。
async function recentAnswers() {
  const s = await profile.summary();
  const recent = s.games.find((g) => g.id === GAME_ID)?.stats?.detail?.recent;
  return Array.isArray(recent) ? recent.filter((w) => typeof w === 'string') : [];
}

async function startNew(difficulty = difficultyPref()) {
  const no = ++gameNo;
  ended = { pending: true }; // 出題前先鎖輸入
  await run(async () => {
    const recent = await recentAnswers();
    if (no !== gameNo) return;
    state = difficulty === 'assist'
      ? initState(Math.random, 'normal', recent, { assist: true })
      : initState(Math.random, difficulty, recent);
    ended = null;
    activeHint = null;
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID);
  });
  if (no !== gameNo) return;
  render();
  if (!document.querySelector('dialog[open]')) focusGame();
}

// 一局結束:依 §4.2 結算(每局只執行一次),結果顯示在遮罩。
function finish(result) {
  const snap = {
    score: scoreFor(state), difficulty: state.difficulty, guesses: state.guesses.length, answer: state.answer, assist: !!state.assist,
  };
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await profile.finishPlay(GAME_ID, {
      result, score: snap.score, difficulty: snap.difficulty, detail: { guesses: snap.guesses, answer: snap.answer }, assist: snap.assist,
    });
    if (!snap.assist) best = Math.max(best, snap.score); // 輔助局不刷新最佳
    if (no !== gameNo) return;
    ended = {
      xp: out.xpGained,
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

// ---- 提示(RS9):提示邏輯在 logic.js,這裡只顯示 ----

const persist = () => { const saved = toSave(state); run(() => profile.saveState(GAME_ID, saved)); };

function useHint(kind) {
  if (ended || !state.assist) return;
  profile.input();
  // 同一種再按一次:字母 = 再揭露一個;其他 = 維持顯示
  if (kind === 'letters' && (activeHint === 'letters' || !state.revealed?.length)) state = revealState(state);
  activeHint = kind;
  if (kind === 'candidates') state = candidatesState(state);
  persist();
  render();
}

function renderHints() {
  const on = !!state.assist && !ended;
  $('hint').hidden = !!state.assist || !!ended;
  $('hints').hidden = !on;
  document.querySelector('.page').classList.toggle('hinting', on);
  if (!on) return;
  for (const btn of $('hints').querySelectorAll('[data-hint]')) btn.setAttribute('aria-pressed', String(btn.dataset.hint === activeHint));
  $('hints').querySelector('[data-hint="letters"]').disabled = activeHint === 'letters' && !canReveal(state);
  $('hint-body').hidden = !activeHint;
  $('hint-letters').hidden = activeHint !== 'letters';
  $('hint-letters').textContent = letterHint(state).map((ch) => ch ?? '_').join(' ');
  $('hint-sentence').hidden = activeHint !== 'sentence';
  const h = HINTS[state.answer];
  $('hint-sentence').innerHTML = h ? `${esc(h.en)}<span class="zh">${esc(h.zh)}</span>` : '';
  const cands = visibleCandidates(state); // 隨新線索過濾,不重抽(H1)
  $('hint-candidates').hidden = activeHint !== 'candidates';
  $('hint-candidates').innerHTML = cands.map((w) => `<button class="btn" type="button" data-word="${esc(w)}">${esc(w)}</button>`).join('')
    + (cands.length < 4 ? `<p class="hint-note">符合目前線索的只剩 ${cands.length} 個</p>` : '');
  $('hint-candidates').title = '點一下填入,按 Enter 送出(仍算一次)';
}

// 新遊戲(含切換難度):未送出過不記錄、送出過未結束 ⇒ 先確認再記 quit(RS4)。
function newGame(difficulty) {
  if (ended?.pending) return; // 結算中:忽略連點
  if (!ended && needsQuitConfirm(progressOf(state))) {
    pendingDifficulty = difficulty ?? null;
    $('quit-dlg').showModal();
    return;
  }
  if (!ended) {
    const result = resultOnNewGame(progressOf(state));
    if (result) finish(result);
    // 沒有可記錄的結果(例:只用了提示、沒猜過):不記錄,但存檔與快取要清掉再開新局計時(H3)
    else run(() => profile.discardSave(GAME_ID));
  }
  startNew(difficulty);
}

// ---- 輸入 ----

let toastTimer = null;
function toast(msg) {
  $('toast').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 2000);
}

function shakeRow() {
  const row = $('board').children[state.guesses.length];
  if (!row) return;
  row.classList.remove('shake');
  void row.offsetWidth; // 重新觸發動畫
  row.classList.add('shake');
}

function errorText(e) {
  if (e.code === 'short') return '還不到 5 個字母';
  if (e.code === 'notword') return '不在字庫';
  if (e.kind === 'green') return `困難模式:第 ${e.pos} 格必須是 ${e.letter.toUpperCase()}`;
  return `困難模式:必須用上 ${e.letter.toUpperCase()}`;
}

function press(key) {
  if (ended) return;
  profile.input();
  if (key === 'enter') {
    const err = guessError(state);
    if (err) {
      if (err.code !== 'over') {
        toast(errorText(err));
        shakeRow();
      }
      return;
    }
    state = submitState(state);
    if (state.over) {
      finish(resultOnGameOver({ everWon: state.won }));
    } else {
      const saved = toSave(state);
      run(() => profile.saveState(GAME_ID, saved));
      render();
    }
    return;
  }
  const next = key === 'back' ? eraseState(state) : typeState(state, key);
  if (next === state) return;
  state = next;
  render();
}

// ---- 渲染 ----

const LABEL = { correct: '綠', present: '黃', absent: '灰' };

function rowHtml(word, marks) {
  return `<div class="row" role="row">${Array.from({ length: WORD_LEN }, (_, i) => {
    const ch = word[i] ?? '';
    const cls = marks ? ` ${marks[i]}` : (ch ? ' filled' : '');
    const aria = marks ? ` aria-label="${ch.toUpperCase()} ${LABEL[marks[i]]}"` : '';
    return `<div class="cell${cls}" role="gridcell"${aria}>${ch}</div>`;
  }).join('')}</div>`;
}

function render() {
  if (!state) return;
  const rows = [];
  for (let r = 0; r < MAX_GUESSES; r++) {
    const g = state.guesses[r];
    if (g) rows.push(rowHtml(g, evaluate(g, state.answer)));
    else if (r === state.guesses.length && !state.over) rows.push(rowHtml(state.current, null));
    else rows.push(rowHtml('', null));
  }
  $('board').innerHTML = rows.join('');
  const keys = keyStates(state);
  for (const btn of $('keyboard').querySelectorAll('[data-key]')) {
    const k = btn.dataset.key;
    btn.className = `key${k.length > 1 ? ' wide' : ''}${keys[k] ? ` ${keys[k]}` : ''}`;
  }
  const score = scoreFor(state);
  $('score').textContent = score.toLocaleString();
  $('best').textContent = (state.assist ? best : Math.max(best, score)).toLocaleString(); // 輔助局不刷新最佳
  $('difficulty').value = state.assist && state.difficulty === 'normal' && difficultyPref() === 'assist' ? 'assist' : state.difficulty;
  renderHints();
  renderOverlay();
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
  if (ended.assist) lines.push('<p class="overlay-assist">🧩 輔助局:不刷新最佳</p>');
  else {
    lines.push(ended.isBest
      ? '<p>🎉 新的最佳分數!</p>'
      : `<p>距最佳 ${ended.bestBefore.toLocaleString()} 還差 ${(ended.bestBefore - ended.score).toLocaleString()}</p>`);
  }
  return lines.join('');
}

function renderOverlay() {
  const overlay = $('overlay');
  const kind = overlayFor(state);
  if (kind === 'won') {
    $('overlay-title').textContent = `猜中了!第 ${state.guesses.length} 次`;
  } else if (kind === 'lost') {
    $('overlay-title').textContent = `答案是 ${state.answer.toUpperCase()}`;
  } else {
    overlay.hidden = true;
    return;
  }
  $('overlay-info').innerHTML = infoHtml();
  $('overlay-actions').innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
  overlay.hidden = false;
}

function buildKeyboard() {
  const rows = ['qwertyuiop', 'asdfghjkl', ['enter', ...'zxcvbnm', 'back']];
  $('keyboard').innerHTML = rows.map((row) => `<div class="kb-row">${[...row].map((k) => {
    const label = k === 'enter' ? 'Enter' : k === 'back' ? '⌫' : k;
    const aria = k === 'back' ? ' aria-label="刪除"' : '';
    return `<button class="key" type="button" tabindex="-1" data-key="${k}"${aria}>${label}</button>`;
  }).join('')}</div>`).join('');
}

function setContrast(on) {
  document.documentElement.classList.toggle('hc', on);
  $('contrast').setAttribute('aria-pressed', String(on));
}

// ---- 事件 ----

// 焦點移回遊戲區(開局、關閉確認框、在按鈕上打字時),讓之後的 Enter 送出猜測而不是再按一次按鈕(W2)。
const focusGame = () => $('board-wrap').focus({ preventScroll: true });

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.target instanceof HTMLSelectElement) return;
  const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement;
  const { action, refocus } = routeKey(e.key, { onControl });
  if (!action || action === 'control') return; // 焦點在按鈕/連結上按 Enter:讓它照常觸發
  if (refocus) focusGame();
  if (action === 'enter' || action === 'back') e.preventDefault();
  press(action);
});

// 畫面鍵盤不搶焦點(避免之後按實體 Enter 觸發到上一個點的字母鍵)。
$('keyboard').addEventListener('mousedown', (e) => e.preventDefault());
$('keyboard').addEventListener('click', (e) => {
  const k = e.target.closest('[data-key]')?.dataset.key;
  if (k) press(k);
});

$('new').addEventListener('click', () => newGame());
$('difficulty').addEventListener('change', (e) => {
  const d = e.target.value;
  if (ended?.pending) {
    e.target.value = state.difficulty;
    return;
  }
  save(DIFF_KEY, d);
  newGame(d);
});
$('quit-dlg').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  $('quit-dlg').close();
  const d = pendingDifficulty;
  pendingDifficulty = null;
  if (act === 'quit' && !ended) {
    finish('quit');
    startNew(d ?? undefined);
  } else {
    $('difficulty').value = state.difficulty; // 不放棄:難度選單還原
  }
});
$('quit-dlg').addEventListener('cancel', () => {
  pendingDifficulty = null;
  $('difficulty').value = state.difficulty;
});
// 關閉後瀏覽器會把焦點還給開啟前的按鈕;在 close 事件(Escape 與按鈕關閉都會觸發)再移回遊戲區(W2b)。
$('quit-dlg').addEventListener('close', focusGame);
$('board').addEventListener('animationend', (e) => e.target.classList.remove('shake'));
$('overlay-actions').addEventListener('click', (e) => {
  if (e.target.dataset.act === 'new') newGame();
});
$('hint').addEventListener('click', () => {
  if (ended || state.assist) return;
  $('assist-dlg').showModal();
});
$('assist-dlg').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  $('assist-dlg').close();
  if (act === 'assist' && !ended) {
    state = assistState(state); // 本局轉輔助,不可逆
    persist();
    render();
  }
});
$('assist-dlg').addEventListener('close', focusGame);
$('hints').addEventListener('mousedown', (e) => e.preventDefault()); // 不搶焦點,之後的 Enter 仍送出猜測
$('hints').addEventListener('click', (e) => {
  const kind = e.target.closest('[data-hint]')?.dataset.hint;
  if (kind) useHint(kind);
  const word = e.target.closest('[data-word]')?.dataset.word;
  if (word && !ended) {
    state = fillState(state, word);
    render();
    focusGame();
  }
});
$('contrast').addEventListener('click', () => {
  const on = !document.documentElement.classList.contains('hc');
  save(HC_KEY, on);
  setContrast(on);
});

bindThemeToggle($('theme'));
setContrast(load(HC_KEY, false) === true);
buildKeyboard();

// 載入:有存檔就自動還原(§4.1),否則開新局。
const saved = await profile.loadSave(GAME_ID);
if (saved && isValidState(saved)) {
  state = fromSave(saved);
  if (state.assist) activeHint = state.candidates ? 'candidates' : state.revealed?.length ? 'letters' : null;
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  render();
} else {
  await startNew();
}

// ---- 說明與示範:著色一律由 logic 實算 ----

const DEMO_ANSWER = 'apple';
const demoRows = (words, typed = '') => ({ words, typed });
const demoRender = ({ words, typed }) => {
  const rows = words.map((w) => rowHtml(w, evaluate(w, DEMO_ANSWER)));
  if (typed !== null) rows.push(rowHtml(typed, null));
  return `<div class="demo-board">${rows.join('')}</div>`;
};
const zz = 'zzzzz';
setupHelp({
  gameId: GAME_ID,
  title: 'Wordle 玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>猜一個 5 字母英文單字,最多 6 次;打字後按 Enter 送出。</li>
      <li><b>綠</b>=字母和位置都對;<b>黃</b>=有這個字母但位置不對;<b>灰</b>=沒有這個字母。</li>
      <li>必須是字庫裡的單字,否則不算一次。</li>
      <li>困難模式:綠字要留在原位、黃字一定要用上。</li>
      <li>卡住了?選「輔助」模式,或按「💡 提示」:字母挖空、例句挖空(附中文)、4 個候選字。用了提示就是<b>輔助局</b>:不刷新最佳、XP 打對折。</li>
      <li>綠格有粗框、黃格有點點;「◐ 高對比」改成橘/藍。</li>
      <li>勝利條件:6 次內猜中。分數 =(7 − 次數)× 100,最佳 = 單局最高分。</li>
    </ol>`,
  demo: {
    render: demoRender,
    steps: [
      { before: demoRows([], 'angle'), after: demoRows(['angle'], null), caption: '答案是 APPLE,先猜 ANGLE…', result: '…A、L、E 綠:字母和位置都對' },
      { before: demoRows(['angle'], 'paper'), after: demoRows(['angle', 'paper'], null), caption: '再猜 PAPER…', result: '…P、A、E 黃:有但位置不對;R 灰:沒有' },
      {
        before: demoRows(['angle', 'paper'], zz),
        after: demoRows(['angle', 'paper'], isWord(zz) ? zz : ''),
        kind: 'fail',
        caption: '亂打 ZZZZZ 送出…',
        result: '…不在字庫,這次不算,可以重打',
      },
      { before: demoRows(['angle', 'paper'], 'apple'), after: demoRows(['angle', 'paper', 'apple'], null), kind: 'ok', caption: '猜 APPLE…', result: `…全綠猜中!第 3 次,得 ${scoreFor({ won: true, guesses: ['angle', 'paper', 'apple'] })} 分` },
    ],
  },
});
