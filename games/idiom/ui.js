import {
  DIFFICULTIES, initState, currentQuestion, questionDone, answerState, nextState, tickState,
  cellsOf, totalErrors, scoreFor, resultOf, hasActed, settlementOf, lookupUrl, toSave, isValidState,
} from './logic.js?v=3baa66c';
import { HELP_RULES, demoSteps, renderDemo } from './help.js?v=3baa66c';
import { createProfile } from '../../shared/profile.js?v=3baa66c';
import { LocalStore } from '../../shared/stores/local.js?v=3baa66c';
import { ACHIEVEMENTS } from '../../shared/progress.js?v=3baa66c';
import { bindThemeToggle } from '../../shared/theme.js?v=3baa66c';
import { play, music } from '../../shared/sound.js?v=3baa66c';
import { setupHelp } from '../../shared/help.js?v=3baa66c';
import { formatDuration } from '../../shared/duration.js?v=3baa66c';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js?v=3baa66c';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=3baa66c';
import { confirmQuitBest } from '../../shared/quit.js?v=3baa66c';

const GAME_ID = 'idiom';
const $ = (id) => document.getElementById(id);
// Scoped validator injection keeps this game's save/load on the common profile API.
const profile = await createProfile({ store: new LocalStore() });
let state;
let best = 0;
let ended = null;
let busy = true;
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((error) => console.error(error)); return queue; };
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

async function startNew(difficulty = 'easy') {
  await profile.discardSave(GAME_ID);
  state = initState(difficulty);
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
  if (!out) { await startNew(state.difficulty); return; }
  ended = { ...out, ...args, xp: out.xpGained, isBest: out.play.is_best, bestBefore: best };
  if (out.play.is_best) best = Math.max(best, args.score);
  render();
}

async function newGame(difficulty = state?.difficulty) {
  if (!state || busy || ended?.pending) return;
  busy = true;
  try {
    if (!ended && hasActed(state)) {
      const quit = await confirmQuitBest({ score: scoreFor(state), best, assist: false });
      if (!quit) { $('difficulty').value = state.difficulty; return; }
      await run(() => finish('quit'));
    }
    await run(() => startNew(difficulty));
  } finally { busy = false; }
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
  const q = currentQuestion(state), done = questionDone(state);
  $('difficulty').value = state.difficulty;
  $('seconds').textContent = formatDuration(state.seconds);
  $('best').textContent = best.toLocaleString();
  $('progress-label').textContent = `第 ${state.index + 1} / 10 題 · ${DIFFICULTIES[state.difficulty].label} · ${scoreFor(state)} 分 · 錯誤 ${totalErrors(state)} 次`;
  $('progress').value = state.index + (done ? 1 : 0);
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
} else await run(() => startNew());

setupHelp({
  gameId: GAME_ID, title: '成語填空玩法', mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>${HELP_RULES.map((rule) => `<li>${rule}</li>`).join('')}</ol>`,
  demo: { steps: demoSteps(), render: renderDemo },
});
busy = false;
