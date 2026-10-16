// 弓箭射擊畫面層:拖曳拉弓、鍵盤瞄準、requestAnimationFrame 固定步長迴圈、Canvas 繪圖與紀錄接入。
// 規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  W, H, DT, ARROWS, RESULT_MS, DIFFICULTIES, THRESHOLDS, initState, canGrab, aimFromDrag, adjustAim, previewPath,
  shoot, stepState, nextArrow, simulate, scoreFor, resultFor, detailFor, toSave, fromSave, isValidState,
  completedResult, resultOnRestart, initialPause, isPaused, changePause,
  HELP_RULES, demoAims,
} from './logic.js?v=3f1141d';
import { drawScene, readPalette, flashOpacity } from './draw.js?v=3f1141d';
import { createProfile } from '../../shared/profile.js?v=3f1141d';
import { LocalStore } from '../../shared/stores/local.js?v=3f1141d';
import { ACHIEVEMENTS } from '../../shared/progress.js?v=3f1141d';
import { bindThemeToggle } from '../../shared/theme.js?v=3f1141d';
import { currentSkin, isDark, SKIN_EVENT } from '../../shared/skin.js?v=3f1141d';
import { skinPalette } from './skins.js?v=3f1141d';
import { play } from '../../shared/sound.js?v=3f1141d';
import { setupHelp } from '../../shared/help.js?v=3f1141d';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=3f1141d';
import { settlePlay } from '../../shared/settle.js?v=3f1141d';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js?v=3f1141d';
import { load, save } from '../../shared/storage.js?v=3f1141d';

const GAME_ID = 'archery';
const DIFF_KEY = 'difficulty:archery';
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let state;
let best = 0;
let ended = null; // 已結算:{ xp, xpBreakdown, newAchievements, isBest, bestBefore, score, detail };結算中 { pending: true }
let gameNo = 0;
let pauseReasons = initialPause();
let paused = false;
let drag = null; // 拉弓中:{ id, start, aim }
let trail = [];
let grabHint = 0;
let flashStartedAt = null;
let resultTimer = null;
let confirmingQuit = false;

let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

const difficultyPref = () => { const d = load(DIFF_KEY, 'normal'); return DIFFICULTIES.includes(d) ? d : 'normal'; };

function persist() {
  if (!state || state.shots === 0 || state.phase === 'over' || ended) return; // 未射不存;結束由結算刪檔
  const saved = toSave(state);
  run(() => profile.saveState(GAME_ID, saved));
}

function clearResultTimer() { clearTimeout(resultTimer); resultTimer = null; }

// 結果停留 RESULT_MS 後換下一箭或顯示結算;最後一箭已在得分時結算。
function scheduleNext() {
  clearResultTimer();
  if (state.phase !== 'result' || paused) return;
  const no = gameNo;
  resultTimer = setTimeout(() => {
    resultTimer = null;
    if (no !== gameNo || paused || state.phase !== 'result') return;
    state = nextArrow(state);
    trail = [];
    if (state.phase === 'over') {
      finish(completedResult(state));
    } else persist();
    render();
  }, RESULT_MS);
}

async function startNew(difficulty = difficultyPref()) {
  clearResultTimer();
  state = initState(difficulty);
  drag = null; trail = []; flashStartedAt = null;
  pauseReasons = { ...initialPause(), hidden: document.visibilityState === 'hidden', help: pauseReasons.help };
  paused = isPaused(pauseReasons);
  gameNo++;
  ended = null;
  render();
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID);
    profile.setVisible(!paused);
  });
  render();
}

function finish(result) {
  if (ended) return; // 同一局結算的鎖在排入非同步佇列前設立。
  const snap = { score: scoreFor(state), difficulty: state.difficulty, detail: detailFor(state) };
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, { result, score: snap.score, difficulty: snap.difficulty, detail: snap.detail });
    if (!out) { if (no === gameNo) startNew(); return; } // 結算失敗且選「不存了」:不記錄、開新局(IR6)
    if (out.play.is_best) best = Math.max(best, snap.score);
    if (no !== gameNo) return;
    ended = { xp: out.xpGained, xpBreakdown: out.xpBreakdown, newAchievements: out.newAchievements,
      isBest: out.play.is_best, bestBefore, score: snap.score, detail: snap.detail };
    render();
  });
}

// 新遊戲(含切換難度):未射不記錄、已射未結束 ⇒ quit(破紀錄中先確認)。
async function newGame(difficulty) {
  if (confirmingQuit || ended?.pending) { render(); return; }
  if (!ended) {
    const result = resultOnRestart(state);
    const note = { score: scoreFor(state), best };
    if (result === 'quit' && needsQuitBestConfirm(note)) {
      confirmingQuit = true;
      updatePause('confirm', true);
      const quit = await confirmQuitBest(note);
      confirmingQuit = false;
      updatePause('confirm', false);
      if (!quit) { $('difficulty').value = state.difficulty; render(); return; }
    }
    if (result) finish(result);
    else run(() => profile.discardSave(GAME_ID));
  }
  if (difficulty !== undefined) save(DIFF_KEY, difficulty);
  startNew(difficulty);
}

function updatePause(reason, active) {
  const wasPaused = paused;
  const next = changePause(pauseReasons, reason, active);
  pauseReasons = next.reasons;
  paused = next.paused;
  if (next.cancelDrag) drag = null;
  if (paused) {
    clearResultTimer();
    if (!wasPaused) persist();
  }
  if (next.resetClock) {
    last = performance.now(); acc = 0;
    scheduleNext();
  }
  const visible = !paused;
  run(() => profile.setVisible(visible));
  render();
}
function pause() { if (!ended) updatePause('manual', true); }
function resume() { if (!ended) updatePause('manual', false); }

// ---- 射出與飛行迴圈 ----

function fire(aim) {
  if (paused || ended || state.phase !== 'aim') return;
  const next = shoot(state, aim);
  if (next === state) return;
  profile.input();
  state = next;
  trail = [{ x: state.shot.x, y: state.shot.y }];
  play('tap');
  render();
  syncLoop();
}

let running = false, last = 0, acc = 0;
const animating = () => grabHint > 0 || flashOpacity(flashStartedAt, performance.now()) > 0;
const flying = () => state.phase === 'flying' && !paused && !ended && !confirmingQuit;

function frame(t) {
  if (!flying() && !animating()) { running = false; draw(); return; }
  const dt = Math.max(0, Math.min(0.25, (t - last) / 1000));
  last = t;
  if (flying()) {
    acc += dt;
    while (acc >= DT && flying()) {
      acc -= DT;
      state = stepState(state);
      trail.push({ x: state.shot.x, y: state.shot.y });
      if (state.phase === 'result') {
        const points = state.hit.points;
        play(points === 10 ? 'goal' : points > 0 ? 'score' : 'land');
        if (points === 10) flashStartedAt = performance.now();
        const result = completedResult(state);
        if (result) {
          play(result === 'win' ? 'win' : 'lose');
          finish(result);
        } else persist();
        scheduleNext();
      }
    }
  }
  grabHint = Math.max(0, grabHint - dt * 2);
  render();
  requestAnimationFrame(frame);
}
function syncLoop() {
  if (running || (!flying() && !animating())) return;
  running = true; last = performance.now(); acc = 0;
  requestAnimationFrame(frame);
}

// ---- 繪圖 ----

const canvas = $('field');
const ctx = canvas.getContext('2d');
let pal = {};
const readColors = () => { pal = skinPalette(readPalette(getComputedStyle(document.documentElement)), currentSkin(), isDark()); };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  draw();
}
function currentAim() { return drag?.aim?.valid ? drag.aim : state.aim; }
function draw() {
  if (!state) return;
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  const aim = currentAim();
  const showPreview = state.phase === 'aim' && !paused && (drag ? drag.aim?.valid : true);
  drawScene(ctx, state, pal, { aim, pulling: Boolean(drag?.aim?.valid), preview: showPreview ? previewPath(state, aim) : null,
    trail, grabHint, flash: flashOpacity(flashStartedAt, performance.now()), reduced: reducedMotion.matches });
}

// ---- 畫面 ----

const achName = (id) => { const a = ACHIEVEMENTS.find((x) => x.id === id); return a ? `${a.icon} ${a.name}` : id; };
function infoLine(text, className = '') {
  const p = document.createElement('p');
  p.textContent = text; p.className = className;
  $('overlay-info').append(p);
}
function overlayButton(act, text) {
  const b = document.createElement('button');
  b.className = 'btn'; b.type = 'button'; b.dataset.act = act; b.textContent = text;
  $('overlay-actions').replaceChildren(b);
}

let shownOverlay = null;
function renderOverlay() {
  const kind = state.phase === 'over' ? 'over' : paused ? 'paused' : null;
  const sig = `${gameNo}|${kind}|${ended ? (ended.pending ? 'p' : 'd') : ''}`;
  if (sig === shownOverlay) return;
  shownOverlay = sig;
  $('overlay-info').replaceChildren();
  if (kind === 'paused') {
    $('overlay-title').textContent = '已暫停';
    infoLine('按 P、▶,或點場地接著玩');
    overlayButton('resume', '▶ 繼續');
  } else if (kind === 'over') {
    const score = scoreFor(state);
    $('overlay-title').textContent = resultFor(state) === 'win' ? '過關!' : '再接再厲';
    const d = detailFor(state);
    infoLine(`10 箭共 ${score} 分(門檻 ${THRESHOLDS[state.difficulty]})· 命中 ${d.hits} · 靶心 ${d.bullseyes}`);
    if (!ended || ended.pending) infoLine('結算中…');
    else {
      infoLine(`本局 +${ended.xp} XP`, 'overlay-xp');
      appendXpBreakdown($('overlay-info'), ended.xpBreakdown, document);
      if (ended.newAchievements.length) infoLine(`新成就:${ended.newAchievements.map(achName).join('、')}`);
      const line = bestLine({ ...ended, noun: '紀錄', unit: ' 分' });
      if (line) infoLine(line);
    }
    overlayButton('new', '再玩一次');
  } else { $('overlay').hidden = true; return; }
  $('overlay').classList.toggle('is-result', kind === 'over');
  $('overlay').hidden = false;
}

let shown = '';
function render() {
  const score = scoreFor(state);
  const b = Math.max(best, score);
  const aim = currentAim();
  const arrowNo = Math.min(ARROWS, state.scores.length + (state.phase === 'aim' || state.phase === 'flying' ? 1 : 0));
  const last = state.scores.length ? state.scores.at(-1) : null;
  const sig = `${score}|${b}|${arrowNo}|${Math.round(aim.angle)}|${Math.round(aim.power * 100)}|${last}|${state.phase}|${paused}`;
  if (sig !== shown) {
    shown = sig;
    $('score').textContent = score;
    $('best').textContent = b;
    $('arrows').textContent = `第 ${Math.max(1, arrowNo)} / ${ARROWS} 箭`;
    $('aim-readout').textContent = `角度 ${Math.round(aim.angle)}° · 力度 ${Math.round(aim.power * 100)}%`;
    $('last-shot').textContent = last === null ? '' : `上一箭 ${last ? `${last} 分` : '脫靶'}`;
    $('status').textContent = state.phase === 'result' ? (last ? `命中 ${last} 分` : '脫靶') : '';
  }
  $('difficulty').value = state.difficulty;
  $('difficulty').disabled = !!ended?.pending;
  const pauseBtn = $('pause');
  const label = paused ? '繼續' : '暫停';
  pauseBtn.textContent = paused ? '▶' : '⏸';
  pauseBtn.setAttribute('aria-label', label);
  pauseBtn.title = `${label}(P)`;
  pauseBtn.disabled = !!ended || state.phase === 'over';
  draw();
  renderOverlay();
  syncLoop();
}

// ---- 輸入 ----

const stage = $('stage');
function toLogic(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: H - (e.clientY - r.top) / r.height * H };
}
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || ended || state.phase === 'over') return;
  if (drag && drag.id !== e.pointerId && e.isPrimary === false) return; // 第二根手指不搶拉弓
  e.preventDefault();
  stage.focus({ preventScroll: true });
  if (paused) { profile.input(); resume(); return; }
  if (state.phase !== 'aim') return;
  const p = toLogic(e);
  if (!canGrab(p)) { grabHint = 1; render(); return; } // 起點太遠:閃一下拉弓範圍
  try { stage.setPointerCapture?.(e.pointerId); } catch { /* 指標已不存在:照常拉弓,放開時仍會收到 */ }
  drag ={ id: e.pointerId, start: p, aim: aimFromDrag(p, p) };
  profile.input();
  render();
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  drag.aim = aimFromDrag(drag.start, toLogic(e));
  render();
});
function release(e) {
  if (!drag || drag.id !== e.pointerId) return;
  const aim = aimFromDrag(drag.start, toLogic(e));
  drag = null;
  if (aim.valid) fire(aim); else render(); // 拖曳太短:取消,不射
}
stage.addEventListener('pointerup', release);
// 指標被取消或失去捕捉(放開事件沒送到):取消這次拉弓,⛔ 卡在拉弓狀態。
const cancelDrag = (e) => { if (drag?.id === e.pointerId) { drag = null; render(); } };
stage.addEventListener('pointercancel', cancelDrag);
stage.addEventListener('lostpointercapture', cancelDrag);
stage.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.target instanceof HTMLSelectElement || (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter'))) return;
  if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (ended || e.repeat) return;
    profile.input();
    if (paused) resume(); else pause();
    return;
  }
  const step = { ArrowUp: [2, 0], ArrowDown: [-2, 0], ArrowRight: [0, 0.05], ArrowLeft: [0, -0.05] }[e.key];
  if (step) {
    e.preventDefault();
    if (ended || paused || state.phase !== 'aim' || drag) return;
    profile.input();
    state = { ...state, aim: adjustAim(state.aim, ...step) };
    render();
  } else if (e.key === ' ') {
    e.preventDefault();
    if (paused) { resume(); return; }
    if (!drag) fire({ ...state.aim, valid: true });
  }
});
window.addEventListener('blur', () => { if (drag) { drag = null; render(); } });
document.addEventListener('visibilitychange', () => updatePause('hidden', document.visibilityState === 'hidden'));

$('new').addEventListener('click', () => newGame());
$('pause').addEventListener('click', () => { profile.input(); if (paused) resume(); else pause(); });
$('difficulty').addEventListener('change', (e) => {
  if (ended?.pending) { e.target.value = state.difficulty; return; }
  newGame(e.target.value);
});
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (act === 'new') newGame();
  if (act === 'resume') { profile.input(); resume(); }
});

bindThemeToggle($('theme'));
$('theme').addEventListener('click', () => { readColors(); draw(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
document.addEventListener(SKIN_EVENT, () => { readColors(); draw(); });
readColors();
new ResizeObserver(resize).observe(canvas);

// 載入:有存檔就還原(暫停狀態),否則開新局。
const saved = await profile.loadSave(GAME_ID);
if (saved && isValidState(saved)) {
  state = fromSave(saved);
  gameNo++;
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  pauseReasons = { ...initialPause(), manual: true, hidden: document.visibilityState === 'hidden' };
  paused = true;
  profile.setVisible(false);
  const result = completedResult(state);
  if (result) {
    pauseReasons.manual = false;
    paused = isPaused(pauseReasons);
    finish(result);
    scheduleNext();
  }
  render();
} else {
  await startNew();
}
resize();

// ---- 說明與示範:場面一律由 logic 實算 ----

const DEMO_PX = 2;
function demoImage(s) {
  const c = document.createElement('canvas');
  c.width = W * DEMO_PX; c.height = H * DEMO_PX;
  const g = c.getContext('2d');
  g.setTransform(DEMO_PX, 0, 0, DEMO_PX, 0, 0);
  drawScene(g, s, pal, { aim: s.demoAim ?? s.aim, pulling: Boolean(s.demoPulling), preview: s.demoPreview ?? null, trail: s.demoTrail ?? [], reduced: false });
  return `<img class="demo-field" src="${c.toDataURL()}" alt="示範場面">`;
}
const demoBase = initState('normal', 14);
const aims = demoAims(demoBase);
const shotDemo = (aim) => {
  const { state: after, trail: t } = simulate(demoBase, aim);
  return { ...after, demoTrail: t };
};
const pulling = (aim) => ({ ...demoBase, aim, demoAim: aim, demoPulling: true, demoPreview: previewPath(demoBase, aim) });
const shortAim = aimFromDrag(aims.short, { x: aims.short.x + 5, y: aims.short.y + 3 });
document.addEventListener('helpopen', () => updatePause('help', true));
setupHelp({
  gameId: GAME_ID,
  title: '弓箭射擊玩法',
  onClose: () => updatePause('help', false),
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>${HELP_RULES.map((text) => `<li>${text}</li>`).join('')}</ol>`,
  demo: {
    render: demoImage,
    steps: [
      { before: demoBase, after: pulling(aims.hit8), caption: '在弓手附近按住往後拉…',
        result: `…角度 ${aims.hit8.angle}°、力度 ${Math.round(aims.hit8.power * 100)}%,虛線預告開頭一小段` },
      { before: pulling(aims.hit8), after: shotDemo(aims.hit8), caption: '放開射出…', result: '…箭畫出拋物線,命中 8 分', kind: 'ok' },
      { before: pulling(aims.weak), after: shotDemo(aims.weak), caption: '力度太小就放開…', result: '…箭飛不到靶就落地,脫靶 0 分', kind: 'fail' },
      { before: demoBase, after: shoot(demoBase, shortAim), caption: '只拖一點點就放開…',
        result: '…拖曳太短不會射出,可以重新拉弓', kind: 'fail' },
    ],
  },
});
const helpButton = document.querySelector('.topbar .navigation button');
if (helpButton) {
  helpButton.setAttribute('aria-label', '玩法說明與示範');
  helpButton.innerHTML = '<span aria-hidden="true">?</span><span class="topbar-label">玩法</span>';
}
