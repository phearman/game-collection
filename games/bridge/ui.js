import { FIELD_W, FIELD_H, DT, DIFFICULTIES, initState, stepState, pauseState, resumeState,
  canPress, isAnimating, checkpointFor, toSave, fromSave, finishInfo, statusText, HELP_RULES, demoSteps } from './logic.js?v=6abe362';
import { drawScene, readPalette, createFx, fxEvents, fxUpdate, fxBusy } from './draw.js?v=6abe362';
import { createProfile } from '../../shared/profile.js?v=6abe362';
import { LocalStore } from '../../shared/stores/local.js?v=6abe362';
import { ACHIEVEMENTS } from '../../shared/progress.js?v=6abe362';
import { bindThemeToggle } from '../../shared/theme.js?v=6abe362';
import { currentSkin, isDark, SKIN_EVENT } from '../../shared/skin.js?v=6abe362';
import { setupHelp } from '../../shared/help.js?v=6abe362';
import { play, music } from '../../shared/sound.js?v=6abe362';
import { settlePlay } from '../../shared/settle.js?v=6abe362';
import { confirmQuitBest } from '../../shared/quit.js?v=6abe362';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=6abe362';
import { load, save } from '../../shared/storage.js?v=6abe362';

const GAME_ID = 'bridge';
const PREF_KEY = 'difficulty:bridge';
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const saved = await profile.loadSave(GAME_ID);
const preference = load(PREF_KEY, 'normal');
const fresh = (difficulty) => initState({ difficulty, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
let state = fromSave(saved) ?? fresh(DIFFICULTIES.includes(preference) ? preference : 'normal');
let best = await profile.best(GAME_ID);
let ended = null, restarting = false, confirming = false;
let pointer = null, keyHeld = false;
let fx = createFx(), frameId = null, last = 0, acc = 0, looping = false;
let queue = Promise.resolve();
const run = (fn) => (queue = queue.then(fn).catch((error) => console.error(error)));
const canvas = $('field'), ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let palette;
const readColors = () => { palette = readPalette(getComputedStyle(document.documentElement), currentSkin(), isDark()); };
const draw = () => drawScene(ctx, state, palette, fx, { reduced: reduced.matches });
const dialogOpen = () => !!document.querySelector('dialog[open]');
const locked = () => !!ended || restarting || confirming || dialogOpen();
function clearInput() {
  const id = pointer;
  pointer = null; keyHeld = false;
  if (id !== null && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
}
function persist(snap) { if (snap) run(() => profile.saveState(GAME_ID, snap)); }
function stopLoop() {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null; acc = 0; looping = false;
}
function syncLoop() {
  const want = !locked() && !state.paused && (isAnimating(state) || fxBusy(fx));
  if (want && frameId === null) {
    if (!looping) { last = performance.now(); acc = 0; looping = true; }
    frameId = requestAnimationFrame(frame);
  }
  if (!want) stopLoop();
}
function frame(now) {
  frameId = null;
  if (locked() || state.paused) { stopLoop(); return; }
  const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
  last = now; acc += dt;
  while (acc + 1e-9 >= DT && !ended && !state.paused) {
    acc = Math.max(0, acc - DT);
    const before = state;
    state = stepState(state, {}, DT);
    fxEvents(fx, before, state); fxUpdate(fx, DT);
    if (before.phase === 'growing' && state.phase === 'falling') persist(checkpointFor(before, state));
    if (state.pillars > before.pillars) { play('score'); persist(checkpointFor(before, state)); }
    if (before.phase === 'falling' && state.phase === 'walking' && state.landing === 'perfect') play('score');
    if (state.phase === 'over') { play('lose'); finish(finishInfo(state)); }
  }
  render();
}
function render() {
  music(!state.paused && state.phase !== 'over' && !locked()); // 遊玩中播背景音樂;暫停、結束、確認框即淡出
  $('score').textContent = state.score.toLocaleString();
  $('best').textContent = Math.max(best, state.score).toLocaleString();
  $('difficulty').value = state.difficulty;
  $('pause').textContent = state.paused ? '▶ 繼續' : '⏸ 暫停';
  $('pause').disabled = state.phase === 'over' || !!ended || restarting || confirming;
  for (const id of ['new', 'difficulty']) $(id).disabled = restarting || confirming || !!ended?.pending;
  const text = statusText(state);
  // 橋長只畫在 Canvas；讀屏不必每幀收到報讀。
  if (state.phase !== 'growing' && $('status').textContent !== text) $('status').textContent = text;
  if (state.phase === 'growing' && $('status').textContent !== '按住伸長中 · 放開讓橋倒下') $('status').textContent = '按住伸長中 · 放開讓橋倒下';
  $('tally').textContent = `已過 ${state.pillars} 根 · 完美 ${state.perfects} 次 · 最長連擊 ${state.best_combo}`;
  $('overlay').hidden = !state.paused && state.phase !== 'over';
  $('again').disabled = restarting || confirming || !!ended?.pending;
  if (!$('overlay').hidden) {
    const over = state.phase === 'over';
    $('overlay-title').textContent = over ? '再接再厲' : '已暫停';
    $('again').textContent = over ? '再玩一次' : '▶ 繼續';
    const info = $('overlay-info'); info.replaceChildren();
    const add = (text, cls = '') => { const p = document.createElement('p'); p.textContent = text; p.className = cls; info.append(p); };
    if (!over) add('按繼續或 P 接著玩');
    else {
      add(`${state.score} 分 · 過 ${state.pillars} 根 · 完美 ${state.perfects} 次`);
      if (!ended || ended.pending) add('結算中…');
      else if (ended.play) {
        add(`本局 +${ended.xpGained} XP`, 'overlay-xp');
        appendXpBreakdown(info, ended.xpBreakdown, document);
        const note = bestLine({ isBest: ended.play.is_best, bestBefore: ended.bestBefore, score: state.score });
        if (note) add(note);
        if (ended.newAchievements.length) add(`新成就：${ended.newAchievements.map((id) => {
          const a = ACHIEVEMENTS.find((item) => item.id === id); return a ? `${a.icon} ${a.name}` : '';
        }).filter(Boolean).join('、')}`);
      }
    }
  }
  draw(); syncLoop();
}
function press() {
  if (locked() || !canPress(state)) return false;
  const before = state;
  state = stepState(state, { press: true }, 0);
  profile.setVisible(true); profile.input();
  persist(checkpointFor(before, state));
  play('tap'); render(); return true;
}
function release() {
  if (locked()) return;
  const before = state;
  profile.input(); state = stepState(state, { release: true }, 0);
  persist(checkpointFor(before, state)); render();
}
function pause(cancelGrowing = false) {
  if (state.phase !== 'growing' || cancelGrowing) clearInput();
  state = pauseState(state, cancelGrowing);
  profile.setVisible(false);
  if (state.moves > 0) persist(toSave(state));
  render();
}
function resume() {
  if (locked() || document.visibilityState === 'hidden') return;
  if (state.phase !== 'growing') clearInput();
  state = resumeState(state);
  profile.setVisible(true); profile.input(); render();
}
function togglePause() {
  if (state.phase === 'growing') return;
  if (state.paused) resume(); else if (!locked()) pause();
}
function finish(info) {
  if (ended) return queue;
  clearInput(); ended = { pending: true }; stopLoop(); render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, info);
    ended = out ? { ...out, bestBefore } : { abandoned: true };
    if (out?.play.is_best) best = Math.max(best, info.score);
    render();
    if (!restarting && !out) queueMicrotask(() => newGame());
    else if (!restarting && state.phase === 'over' && !dialogOpen()) $('again').focus();
  });
}
async function newGame(difficulty = state.difficulty) {
  if (restarting || confirming || ended?.pending) { render(); return; }
  const info = finishInfo(state, true);
  if (!ended && info.result) {
    const wasPaused = state.paused;
    pause(); confirming = true; render();
    const quit = await confirmQuitBest({ score: info.score, best });
    confirming = false;
    if (!quit) {
      if (!wasPaused) {
        resume();
        if (state.phase === 'growing' && pointer === null && !keyHeld) release();
      } else render();
      return;
    }
  }
  restarting = true; stopLoop(); clearInput(); render();
  if (!ended && info.result) await finish(info);
  await queue;
  await profile.discardSave(GAME_ID);
  state = fresh(difficulty); fx = createFx(); ended = null;
  save(PREF_KEY, state.difficulty);
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID); profile.setVisible(false);
  restarting = false; render(); canvas.focus();
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.isPrimary === false || e.button !== 0 || pointer !== null || keyHeld) return;
  e.preventDefault();
  if (!press()) return;
  pointer = e.pointerId; canvas.setPointerCapture?.(pointer); canvas.focus();
});
canvas.addEventListener('pointerup', (e) => {
  if (pointer !== e.pointerId) return;
  clearInput(); release();
});
canvas.addEventListener('pointercancel', (e) => {
  if (pointer === e.pointerId) pause(true);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || dialogOpen() || e.target instanceof HTMLSelectElement) return;
  if (e.key.toLowerCase() === 'p') { e.preventDefault(); if (!e.repeat) togglePause(); return; }
  if (e.key !== ' ' || e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
  e.preventDefault();
  if (!e.repeat && !keyHeld && pointer === null && press()) keyHeld = true;
});
document.addEventListener('keyup', (e) => {
  if (e.key !== ' ' || !keyHeld) return;
  e.preventDefault(); keyHeld = false; release();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pause(true); });
window.addEventListener('blur', () => pause(true));
window.addEventListener('pagehide', () => pause());
document.addEventListener('helpopen', () => pause(true));
$('new').addEventListener('click', () => newGame());
$('again').addEventListener('click', () => { if (state.paused && state.phase !== 'over') resume(); else newGame(); });
$('pause').addEventListener('click', togglePause);
$('difficulty').addEventListener('change', () => newGame($('difficulty').value));
bindThemeToggle($('theme'));
const recolor = () => { readColors(); draw(); };
$('theme').addEventListener('click', recolor);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
document.addEventListener(SKIN_EVENT, recolor);
reduced.addEventListener('change', draw);
function resize() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(FIELD_W * dpr); canvas.height = Math.round(FIELD_H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
}
readColors(); new ResizeObserver(resize).observe(canvas);
profile.startTimer(GAME_ID); profile.setVisible(false); resize(); render();
if (state.phase === 'over') await finish(finishInfo(state));
setupHelp({ gameId: GAME_ID, title: '小人過橋玩法', mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>${HELP_RULES.map((text) => `<li>${text}</li>`).join('')}</ol>`,
  demo: { steps: demoSteps(), render: (s) => {
    const c = document.createElement('canvas'); c.width = FIELD_W; c.height = FIELD_H;
    drawScene(c.getContext('2d'), s, palette, null, { reduced: true });
    return `<img class="demo-field" src="${c.toDataURL()}" alt="過橋示範，橋長 ${Math.round(s.bridgeLength)}，分數 ${s.score}">`;
  } },
});
