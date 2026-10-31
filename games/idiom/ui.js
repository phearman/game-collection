import {
  DIFFICULTIES, initState, currentQuestion, questionDone, answerState, nextState, tickState,
  cellsOf, totalErrors, scoreFor, resultOf, hasActed, settlementOf, lookupUrl, toSave, isValidState,
  isComicList, comicFor, comicUrl, roundSize, comicPool, setFromSearch, COMICS_SET, COMICS_UNAVAILABLE, SET_PARAM,
} from './logic.js?v=b19b96f';
import { HELP_RULES, demoSteps, renderDemo } from './help.js?v=b19b96f';
import { createProfile } from '../../shared/profile.js?v=b19b96f';
import { LocalStore } from '../../shared/stores/local.js?v=b19b96f';
import { ACHIEVEMENTS } from '../../shared/progress.js?v=b19b96f';
import { bindThemeToggle } from '../../shared/theme.js?v=b19b96f';
import { play, music } from '../../shared/sound.js?v=b19b96f';
import { setupHelp } from '../../shared/help.js?v=b19b96f';
import { formatDuration } from '../../shared/duration.js?v=b19b96f';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js?v=b19b96f';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=b19b96f';
import { confirmQuitBest } from '../../shared/quit.js?v=b19b96f';

// One promise per page, including failures and timeouts. Importing never blocks render().
export function createComicsLoader() {
  let cached;
  return function loadComics({
    importer = () => import('https://phearman.github.io/classical-chinese-kids-site/idioms/comics.js'),
    timeoutMs = 3000,
  } = {}) {
    if (!cached) cached = (async () => {
      let timer;
      try {
        const module = await Promise.race([
          Promise.resolve().then(importer),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
        ]);
        // Keep array entries; comicFor ignores placeholders and invalid entries individually.
        return isComicList(module?.COMICS) ? module.COMICS : [];
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    })();
    return cached;
  };
}

export const loadComics = createComicsLoader();

// Each render invalidates older requests, even if a new round repeats the same word.
export function createComicLink({ link, load = loadComics }) {
  let revision = 0;
  return async (question, done) => {
    const request = ++revision;
    link.hidden = true;
    link.removeAttribute('href');
    if (!done) return;
    const comics = await load();
    if (request !== revision) return;
    const href = comicUrl(comicFor(comics, question.word));
    if (href) {
      link.href = href;
      link.hidden = false;
    }
  };
}

const GAME_ID = 'idiom';
const $ = (id) => document.getElementById(id);
const renderComicLink = createComicLink({ link: $('comic') });
// Scoped validator injection keeps this game's save/load on the common profile API.
const profile = await createProfile({ store: new LocalStore() });
let state;
let best = 0;
let ended = null;
let busy = true;
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((error) => console.error(error)); return queue; };
// RS106:大廳捷徑 games/idiom/?set=comics 直接選定典故漫畫題組。
const requestedSet = setFromSearch(typeof location === 'undefined' ? '' : location.search);
const showNotice = (text) => { $('set-notice').textContent = text; $('set-notice').hidden = !text; };
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// 典故漫畫題組先讀清單;讀不到或沒有可出的題就提示,⛔ 退回出一般題。
// current():這次選擇是否仍是最後一次;被後來的選擇取代就不動提示區。
async function comicsFor(difficulty, current = () => true) {
  if (difficulty !== COMICS_SET) { showNotice(''); return { ok: true }; }
  showNotice('載入漫畫清單中…');
  const comics = await loadComics();
  if (!current()) return { ok: false, stale: true };
  if (!comicPool(comics).length) { showNotice(COMICS_UNAVAILABLE); return { ok: false }; }
  showNotice('');
  return { ok: true, comics };
}

// 沒有進行中的局(例:從大廳捷徑進來但清單讀不到):只留提示與題組選單。
function showUnavailable(difficulty) {
  $('difficulty').value = difficulty;
  $('question').hidden = true;
  $('progress-label').textContent = '';
  $('progress').hidden = true;
  $('new').disabled = true;
}

async function startNew(difficulty = 'easy', comics) {
  await profile.discardSave(GAME_ID);
  showNotice('');
  state = initState(difficulty, { comics });
  ended = null;
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  // Save the initial questions too, so reloading cannot silently change the round.
  await profile.saveState(GAME_ID, toSave(state));
  render();
}

async function finish(result) {
  const args = settlementOf(state, result);
  ended = { pending: true };
  render();
  const out = await settlePlay(profile, GAME_ID, args);
  if (!out) { await restart(state.difficulty); return; }
  ended = { ...out, ...args, xp: out.xpGained, isBest: out.play.is_best, bestBefore: best };
  if (out.play.is_best) best = Math.max(best, args.score);
  render();
}

// 結算失敗(放棄存檔)後重開:同題組也要經 comicsFor 取清單;讀不到就只留提示與題組選單。
async function restart(difficulty) {
  const set = await comicsFor(difficulty);
  if (set.ok) { await startNew(difficulty, set.comics); return; }
  await profile.discardSave(GAME_ID);
  state = undefined;
  ended = null;
  $('result').hidden = true;
  showUnavailable(difficulty);
  $('difficulty').disabled = false;
  music(false);
}

// 選題組請求序號:清單載入中又改選時,以最後一次選擇為準(不鎖選單)。
let pick = 0;
let picking = false;

async function newGame(difficulty = state?.difficulty) {
  if (!difficulty || ended?.pending || (busy && !picking)) return;
  const mine = ++pick;
  busy = true;
  picking = true;
  try {
    const set = await comicsFor(difficulty, () => mine === pick);
    if (mine !== pick) return;
    picking = false;
    if (!set.ok) {
      if (state) $('difficulty').value = state.difficulty;
      else showUnavailable(difficulty);
      return;
    }
    if (state && !ended && hasActed(state)) {
      const quit = await confirmQuitBest({ score: scoreFor(state), best, assist: false });
      if (!quit) { $('difficulty').value = state.difficulty; return; }
      await run(() => finish('quit'));
    }
    await run(() => startNew(difficulty, set.comics));
  } finally {
    if (mine === pick) { busy = false; picking = false; }
  }
}

function choose(letter) {
  if (!state || ended || busy) return;
  profile.input();
  const previous = state;
  state = answerState(state, letter);
  if (state === previous) return;
  play(state.wrong ? 'tap' : resultOf(state) ? 'win' : 'move');
  render();
  const saved = toSave(state);
  // Persist terminal state before settling; a reload can retry the same round id.
  if (resultOf(state)) {
    ended = { pending: true };
    render();
    run(async () => { await profile.saveState(GAME_ID, saved); await finish('win'); });
  } else run(() => profile.saveState(GAME_ID, saved));
}

function render() {
  if (!state) return;
  const q = currentQuestion(state), done = questionDone(state), size = roundSize(state);
  $('question').hidden = false;
  $('progress').hidden = false;
  $('difficulty').value = state.difficulty;
  $('seconds').textContent = formatDuration(state.seconds);
  $('best').textContent = best.toLocaleString();
  $('progress-label').textContent = `第 ${state.index + 1} / ${size} 題 · ${DIFFICULTIES[state.difficulty].label} · ${scoreFor(state)} 分 · 錯誤 ${totalErrors(state)} 次`;
  $('progress').max = size;
  $('progress').value = state.index + (done ? 1 : 0);
  $('result-title').textContent = `🎉 完成 ${size} 題!`;
  $('cells').innerHTML = cellsOf(state).map((cell, i) => `<span class="idiom-cell${cell.active ? ' active' : ''}${cell.wrong ? ' wrong' : ''}" aria-label="第 ${i + 1} 字${cell.active ? ',待填' : ''}${cell.wrong ? ',答錯' : ''}">${esc(cell.text)}</span>`).join('');
  $('status').textContent = done ? '✅ 答對了!可查看《成語典》。' : state.wrong ? '❌ 這個字不對,再選一次。' : `請選字填入亮框(第 ${q.blanks[state.filled] + 1} 字)`;
  // Keep six buttons in place while choosing, preserving native keyboard focus.
  const letters = q.choices[Math.min(state.filled, q.choices.length - 1)];
  if (!$('choices').children.length) {
    for (let i = 0; i < 6; i++) {
      const button = document.createElement('button');
      button.className = 'btn'; button.type = 'button'; button.dataset.choice = String(i);
      $('choices').append(button);
    }
  }
  for (let i = 0; i < 6; i++) {
    const button = $('choices').children[i];
    button.textContent = letters[i];
    button.disabled = done || !!ended;
  }
  $('lookup').hidden = !done;
  if (done) $('lookup').href = lookupUrl(q.word);
  else $('lookup').removeAttribute('href');
  void renderComicLink(q, done);
  $('next').hidden = !done || state.status === 'win';
  $('next').disabled = !!ended;
  $('result').hidden = !ended || ended.result === 'quit';
  $('again').disabled = !!ended?.pending;
  $('new').disabled = !!ended?.pending;
  $('difficulty').disabled = !!ended?.pending;
  if (ended) {
    let duplicateNote = '';
    if (ended.duplicate) duplicateNote = `<p>${DUPLICATE_FINISH_TEXT}</p>`;
    $('result-info').innerHTML = ended.pending ? '<p>結算中…</p>' :
      `<p>${ended.score} 分 · 錯誤 ${ended.detail.errors} 次 · ${formatDuration(ended.detail.seconds)}</p>`
      + duplicateNote
      + `<p>本局 +${ended.xp} XP</p>${xpBreakdownHtml(ended.xpBreakdown)}`
      + (ended.newAchievements.length ? `<p>新成就:${ended.newAchievements.map((id) => {
        const a = ACHIEVEMENTS.find((item) => item.id === id);
        return esc(a ? `${a.icon} ${a.name}` : id);
      }).join('、')}</p>` : '') + bestLineHtml(ended);
  }
  music(!ended && state.status !== 'win');
}

$('choices').addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-choice]');
  if (button && !button.disabled) choose(button.textContent);
});
$('next').addEventListener('click', () => {
  if (!state || ended || busy) return;
  const previous = state;
  state = nextState(state);
  if (state === previous) return;
  profile.input();
  const saved = toSave(state);
  run(() => profile.saveState(GAME_ID, saved));
  render();
  $('choices').children[0].focus();
});
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => newGame());
$('difficulty').addEventListener('change', (event) => newGame(event.target.value));

setInterval(() => {
  if (!state || ended || busy || document.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return;
  state = tickState(state);
  $('seconds').textContent = formatDuration(state.seconds);
}, 1000);
const persist = () => {
  if (!state || ended || busy) return;
  const saved = toSave(state);
  run(() => profile.saveState(GAME_ID, saved));
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
window.addEventListener('pagehide', persist);
bindThemeToggle($('theme'));

const saved = await profile.loadSave(GAME_ID);
if (saved && isValidState(saved)) {
  state = toSave(saved);
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  render();
  if (resultOf(state)) await run(() => finish('win'));
} else if (!requestedSet) await run(() => startNew());

setupHelp({
  gameId: GAME_ID, title: '成語填空玩法', mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>${HELP_RULES.map((rule) => `<li>${rule}</li>`).join('')}</ol>`,
  demo: { steps: demoSteps(), render: renderDemo },
});
busy = false;
if (requestedSet) {
  // 用過就從網址拿掉,之後改選其他題組再重整不會又被切回來。
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    const url = new URL(location.href);
    url.searchParams.delete(SET_PARAM);
    history.replaceState?.(history.state, '', url.pathname + url.search + url.hash);
  }
  if (state?.difficulty !== requestedSet) await newGame(requestedSet);
}
