// G18 古詩動畫畫面(DV27)。規則與資料在 logic.js,畫面圖在 art.js;本檔只接 DOM。
import {
  POEM, SECTIONS, SECTION_LABELS, SCENES, PICTURES, CARDS, initQuiz, currentQuestion, quizDone, answerQuiz, nextQuestion,
  blankedLine, missedQuestions, scoreOf, settlementOf, cardForChar, sectionFrom, clampScene, clampCard,
} from './logic.js?v=5ccf94d7';
import { sceneSvg } from './art.js?v=5ccf94d7';
import { HELP_RULES, demoSteps, renderDemo } from './help.js?v=5ccf94d7';
import { createProfile } from '../../shared/profile.js?v=5ccf94d7';
import { LocalStore } from '../../shared/stores/local.js?v=5ccf94d7';
import { ACHIEVEMENTS } from '../../shared/progress.js?v=5ccf94d7';
import { bindThemeToggle } from '../../shared/theme.js?v=5ccf94d7';
import { play, music } from '../../shared/sound.js?v=5ccf94d7';
import { setupHelp } from '../../shared/help.js?v=5ccf94d7';
import { xpBreakdownHtml, bestLineHtml } from '../../shared/xp-explain.js?v=5ccf94d7';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=5ccf94d7';

const GAME_ID = 'poem';
const VIEW_KEY = 'poem:view'; // R2:本機記住上次的段落、幕與詞卡(只是閱讀位置,⛔ 進存檔與雲端)
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const profile = await createProfile({ store: new LocalStore() });
let best = await profile.best(GAME_ID);

function loadView() {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(VIEW_KEY) ?? 'null');
    return { section: sectionFrom(v?.section), scene: clampScene(v?.scene), card: clampCard(v?.card) };
  } catch { return { section: 'story', scene: 0, card: 0 }; }
}
function saveView() {
  try { globalThis.localStorage?.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* 私密模式:不記也能看 */ }
}
const view = loadView();
let quiz = initQuiz();
let ended = null;
let started = false;

// R4 朗讀:瀏覽器內建語音、zh-TW;不支援就藏鈕;只在按下時念(預設關)。
const speech = typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance === 'function'
  ? globalThis.speechSynthesis : null;
function speak(text) {
  if (!speech) return;
  speech.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW'; u.rate = 0.85;
  const voice = speech.getVoices?.().find((v) => /zh[-_]TW/i.test(v.lang));
  if (voice) u.voice = voice;
  speech.speak(u);
}
const speakText = () => {
  if (view.section === 'story') {
    const scene = SCENES[view.scene];
    return view.scene === 0 ? `${POEM.title}。${POEM.dynasty}，${POEM.author}。${POEM.lines.join('，')}。`
      : `${scene.caption}${scene.lines.map((i) => POEM.lines[i]).join('，')}。`;
  }
  const card = CARDS[view.card];
  return `${card.word}。${card.meaning}`;
};

function cardHtml(index) {
  const card = CARDS[index];
  return `<div class="card-icon" aria-hidden="true">${esc(card.icon)}</div><p class="card-word">${esc(card.word)}</p>`
    + `<p class="card-zhuyin">${esc(card.zhuyin)}</p><p class="card-meaning">${esc(card.meaning)}</p>`
    + (card.note ? `<p class="card-note">${esc(card.note)}</p>` : '')
    + `<p class="card-line">出自「${esc(POEM.lines[card.line])}」</p>`;
}
const linesHtml = (on) => POEM.lines.map((line, i) => `<span class="${on.includes(i) ? 'on' : ''}">${esc(line)}</span>`).join('');

function renderTabs() {
  if (!$('tabs').children.length) {
    for (const id of SECTIONS) {
      const tab = document.createElement('button');
      tab.type = 'button'; tab.className = 'btn'; tab.dataset.section = id; tab.setAttribute('role', 'tab');
      tab.textContent = SECTION_LABELS[id];
      $('tabs').append(tab);
    }
  }
  for (const tab of $('tabs').children) tab.setAttribute('aria-selected', String(tab.dataset.section === view.section));
  for (const id of SECTIONS) $(`panel-${id}`).hidden = id !== view.section;
  $('speak').hidden = !speech || !['story', 'cards'].includes(view.section);
}

function renderStory() {
  const scene = SCENES[view.scene];
  $('stage').innerHTML = sceneSvg(scene.art, scene.caption);
  $('stage').setAttribute('aria-label', view.scene < SCENES.length - 1 ? '下一幕' : '故事最後一幕');
  $('caption').textContent = scene.caption;
  $('story-lines').innerHTML = linesHtml(scene.lines);
  $('scene-count').textContent = view.scene === 0 ? '封面' : `第 ${view.scene} / ${SCENES.length - 1} 幕`;
  $('prev-scene').disabled = view.scene === 0;
  $('next-scene').textContent = view.scene < SCENES.length - 1 ? '下一幕 ▶' : '看詞卡 ▶';
}

function renderCards() {
  $('card').innerHTML = cardHtml(view.card);
  $('card-count').textContent = `${view.card + 1} / ${CARDS.length}`;
}

function renderPictures() {
  if ($('pictures').children.length) return;
  $('pictures').innerHTML = PICTURES.map((pic, p) => `<figure class="picture"><div class="picture-art">${pic.scenes
    .map((s) => sceneSvg(SCENES[s].art, `圖${p + 1}:${SCENES[s].caption}`)).join('')}</div>`
    + `<figcaption class="picture-lines">${pic.lines.map((line) => `<div class="picture-line">${[...POEM.lines[line]].map((ch) => {
      const card = cardForChar(line, ch);
      return card === null ? `<button class="char" type="button" disabled>${esc(ch)}</button>`
        : `<button class="char has-card" type="button" data-card="${card}" aria-label="${esc(ch)},看「${esc(CARDS[card].word)}」詞卡">${esc(ch)}</button>`;
    }).join('')}</div>`).join('')}</figcaption></figure>`).join('');
}

function renderQuiz() {
  const done = quizDone(quiz);
  $('quiz-play').hidden = done && !!ended;
  $('quiz-result').hidden = !ended;
  const q = currentQuestion(quiz);
  const solved = quiz.solved[quiz.index];
  $('quiz-progress').textContent = `第 ${quiz.index + 1} / ${quiz.questions.length} 題 · 首選答對 ${scoreOf(quiz)} 題`;
  $('quiz-art').innerHTML = sceneSvg(SCENES[q.scene].art, '這一句的圖');
  $('quiz-line').textContent = blankedLine(q, solved);
  $('quiz-line').setAttribute('aria-label', solved ? POEM.lines[q.line] : `${blankedLine(q)},〇 是要填的字`);
  const wrong = quiz.wrong[quiz.index];
  $('quiz-status').textContent = solved ? (wrong.length ? '✅ 答對了!(這題不算分)' : '✅ 答對了!') : wrong.length ? '❌ 不對,再選一次。' : '看圖,選出〇裡的字。';
  if (!$('choices').children.length) {
    for (let i = 0; i < q.choices.length; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.dataset.choice = String(i);
      $('choices').append(b);
    }
  }
  q.choices.forEach((ch, i) => {
    const b = $('choices').children[i];
    b.textContent = ch;
    b.className = `btn${wrong.includes(ch) ? ' wrong' : ''}${solved && ch === q.answer ? ' right' : ''}`;
    b.disabled = solved || wrong.includes(ch) || !!ended;
  });
  $('quiz-next').hidden = !solved || done;
  $('again').disabled = !!ended?.pending;
  if (ended) {
    $('result-title').textContent = `答對 ${scoreOf(quiz)}/${quiz.questions.length}`;
    let duplicateNote = '';
    if (ended.duplicate) duplicateNote = `<p>${DUPLICATE_FINISH_TEXT}</p>`;
    $('result-info').innerHTML = ended.pending ? '<p>結算中…</p>'
      : duplicateNote
        + `<p>本局 +${ended.xpGained} XP</p>${xpBreakdownHtml(ended.xpBreakdown)}`
        + (ended.newAchievements.length ? `<p>新成就:${ended.newAchievements.map((id) => {
          const a = ACHIEVEMENTS.find((item) => item.id === id);
          return esc(a ? `${a.icon} ${a.name}` : id);
        }).join('、')}</p>` : '') + bestLineHtml({ ...ended, unit: ' 分' });
    const missed = missedQuestions(quiz);
    $('review').innerHTML = missed.length
      ? `<p>錯題回看:</p>${missed.map((m) => `<p>「${esc(POEM.lines[m.line])}」的〇是「${esc(m.answer)}」</p>`).join('')}`
      : '<p>全部第一次就答對!</p>';
  }
}

function render() {
  renderTabs();
  $('best').textContent = String(best);
  if (view.section === 'story') renderStory();
  else if (view.section === 'cards') renderCards();
  else if (view.section === 'pictures') renderPictures();
  else renderQuiz();
  music(view.section === 'quiz' && started && !ended);
}

function go(section) {
  view.section = sectionFrom(section);
  speech?.cancel();
  saveView(); render();
}
function moveScene(step) {
  const next = view.scene + step;
  if (next >= SCENES.length) { go('cards'); return; }
  view.scene = clampScene(next);
  speech?.cancel();
  saveView(); render();
}
function moveCard(step) { view.card = clampCard(view.card + step); speech?.cancel(); saveView(); render(); }

async function finish() {
  const args = settlementOf(quiz);
  const bestBefore = best;
  ended = { pending: true }; render();
  const out = await settlePlay(profile, GAME_ID, args);
  if (!out) { restartQuiz(); return; }
  if (out.play.is_best) best = Math.max(best, args.score);
  ended = { ...out, isBest: out.play.is_best, bestBefore, score: args.score }; render();
  $('again').focus();
}
function restartQuiz() {
  quiz = initQuiz(); ended = null; started = false;
  $('choices').replaceChildren(); render();
}
function choose(ch) {
  if (ended) return;
  if (!started) { started = true; profile.startTimer(GAME_ID); }
  profile.input();
  const before = quiz;
  quiz = answerQuiz(quiz, ch);
  if (quiz === before) return;
  const right = quiz.solved[quiz.index];
  play(right ? (quizDone(quiz) ? 'win' : 'move') : 'tap');
  render();
  if (quizDone(quiz)) finish();
  else if (right) $('quiz-next').focus();
}

$('tabs').addEventListener('click', (event) => {
  const tab = event.target.closest?.('[data-section]');
  if (tab) go(tab.dataset.section);
});
$('stage').addEventListener('click', () => moveScene(1));
$('next-scene').addEventListener('click', () => moveScene(1));
$('prev-scene').addEventListener('click', () => moveScene(-1));
$('next-card').addEventListener('click', () => moveCard(1));
$('prev-card').addEventListener('click', () => moveCard(-1));
$('pictures').addEventListener('click', (event) => {
  const char = event.target.closest?.('[data-card]');
  if (!char) return;
  $('card-dlg-body').innerHTML = cardHtml(Number(char.dataset.card));
  $('card-dlg').showModal();
});
$('card-dlg-close').addEventListener('click', () => $('card-dlg').close());
$('choices').addEventListener('click', (event) => {
  const b = event.target.closest?.('[data-choice]');
  if (b && !b.disabled) choose(b.textContent);
});
$('quiz-next').addEventListener('click', () => {
  quiz = nextQuestion(quiz); render();
  $('choices').children[0]?.focus();
});
$('again').addEventListener('click', () => { if (!ended?.pending) restartQuiz(); });
$('speak').addEventListener('click', () => speak(speakText()));
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]') || view.section !== 'story') return;
  if (event.key === 'ArrowRight') { event.preventDefault(); moveScene(1); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); moveScene(-1); }
});
// r1 M1:離開頁面(回大廳、切到背景)就停止朗讀。
window.addEventListener('pagehide', () => speech?.cancel());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') speech?.cancel(); });
bindThemeToggle($('theme'));
render();

setupHelp({
  gameId: GAME_ID, title: '古詩動畫玩法', mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>${HELP_RULES.map((rule) => `<li>${rule}</li>`).join('')}</ol>`,
  demo: { steps: demoSteps(), render: renderDemo },
});
