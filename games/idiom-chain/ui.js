import {
  STEPS, initState, currentWord, cardsOf, chooseState, nextState, tickState, totalErrors, scoreFor,
  resultOf, hasActed, settlementOf, lookupUrl, toSave, isValidState, stepsDone,
} from './logic.js?v=1eaeb7ae';
import { HELP_RULES, HELP_SOURCE, demoSteps, renderDemo } from './help.js?v=1eaeb7ae';
import { createProfile } from '../../shared/profile.js?v=1eaeb7ae';
import { LocalStore } from '../../shared/stores/local.js?v=1eaeb7ae';
import { ACHIEVEMENTS } from '../../shared/progress.js?v=1eaeb7ae';
import { bindThemeToggle } from '../../shared/theme.js?v=1eaeb7ae';
import { play, music } from '../../shared/sound.js?v=1eaeb7ae';
import { setupHelp } from '../../shared/help.js?v=1eaeb7ae';
import { formatDuration } from '../../shared/duration.js?v=1eaeb7ae';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js?v=1eaeb7ae';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=1eaeb7ae';
import { confirmQuitBest } from '../../shared/quit.js?v=1eaeb7ae';

const GAME_ID = 'idiom-chain';
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
let state;
let best = 0;
let ended = null;
let busy = true;
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((error) => console.error(error)); return queue; };
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

async function startNew() {
  await profile.discardSave(GAME_ID);
  state = initState();
  ended = null;
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  // 開局就存,重整不會換掉這條接龍。
  await profile.saveState(GAME_ID, toSave(state));
  render();
}

async function finish(result) {
  const args = settlementOf(state, result);
  ended = { pending: true };
  render();
  const out = await settlePlay(profile, GAME_ID, args);
  if (!out) { await startNew(); return; }
  ended = { ...out, ...args, xp: out.xpGained, isBest: out.play.is_best, bestBefore: best };
  if (out.play.is_best) best = Math.max(best, args.score);
  render();
}

async function newGame() {
  if (ended?.pending || busy) return;
  busy = true;
  try {
    if (state && !ended && hasActed(state)) {
      const quit = await confirmQuitBest({ score: scoreFor(state), best, assist: false });
      if (!quit) return;
      await run(() => finish('quit'));
    }
    await run(() => startNew());
  } finally {
    busy = false;
  }
}

function choose(word) {
  if (!state || ended || busy) return;
  profile.input();
  const previous = state;
  state = chooseState(state, word);
  if (state === previous) return;
  play(state.solved ? (resultOf(state) ? 'win' : 'move') : 'tap');
  render();
  const saved = toSave(state);
  // 先存終局再結算;重整時可用同一局 id 重試。
  if (resultOf(state)) {
    ended = { pending: true };
    render();
    run(async () => { await profile.saveState(GAME_ID, saved); await finish('win'); });
  } else run(() => profile.saveState(GAME_ID, saved));
}

function render() {
  if (!state) return;
  const word = [...currentWord(state)], end = word.at(-1), done = state.solved;
  $('seconds').textContent = formatDuration(state.seconds);
  $('best').textContent = best.toLocaleString();
  $('progress-label').textContent = `第 ${state.index + 1} / ${STEPS} 步 · ${scoreFor(state)} 分 · 錯誤 ${totalErrors(state)} 次`;
  $('progress').value = stepsDone(state);
  $('tail').textContent = end;
  $('current').innerHTML = word.map((ch, i) => `<span class="chain-char${i === word.length - 1 ? ' tail' : ''}"${i === word.length - 1 ? ' aria-label="尾字 ' + esc(ch) + '"' : ''}>${esc(ch)}</span>`).join('');
  $('status').textContent = done ? `✅ 接上了!「${end}」→「${state.chain[state.index + 1]}」` : state.wrong.length
    ? `❌ 第一個字不是「${end}」,再選一次。` : `找第一個字是「${end}」的成語`;
  // 固定 4 顆按鈕,保留鍵盤焦點。
  if (!$('cards').children.length) {
    for (let i = 0; i < 4; i++) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.card = String(i);
      $('cards').append(button);
    }
  }
  cardsOf(state).forEach((card, i) => {
    const button = $('cards').children[i];
    button.textContent = card.word;
    button.className = `btn${card.right ? ' right' : ''}${card.wrong ? ' wrong' : ''}`;
    button.disabled = card.disabled || !!ended;
    button.setAttribute?.('aria-label', `${card.word}${card.right ? ',答對' : card.wrong ? ',答錯' : ''}`);
  });
  $('lookup').hidden = !done;
  if (done) $('lookup').href = lookupUrl(state.chain[state.index + 1]);
  else $('lookup').removeAttribute('href');
  $('next').hidden = !done || state.status === 'win';
  $('next').disabled = !!ended;
  $('result').hidden = !ended || ended.result === 'quit';
  $('again').disabled = !!ended?.pending;
  $('new').disabled = !!ended?.pending;
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
    // R7:結算列出整條接龍 11 條,每條可點《成語典》。
    $('chain-list').innerHTML = ended.pending ? '' : state.chain.map((item) =>
      `<li><a href="${esc(lookupUrl(item))}" target="_blank" rel="noopener noreferrer">${esc(item)}</a></li>`).join('');
  }
  music(!ended && state.status !== 'win');
}

$('cards').addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-card]');
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
  $('cards').children[0].focus();
});
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => newGame());

// R7:分頁隱藏或開對話框(玩法、確認)時暫停計時。
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
} else await run(() => startNew());

setupHelp({
  gameId: GAME_ID, title: '成語接龍玩法', mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>${HELP_RULES.map((rule) => `<li>${rule}</li>`).join('')}</ol><p>${HELP_SOURCE}</p>`,
  demo: { steps: demoSteps(), render: renderDemo },
});
busy = false;
