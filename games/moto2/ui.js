// 畫面層:事件、固定步長迴圈與紀錄串接;規則只呼叫 logic.js。
import {
  W, H, DT, TRACK_LEN, DIFFICULTIES, MODES, initState, stepState, pauseState, resumeState,
  overlayFor, playerOf, ranking, resultFor, toSave, fromSave, isValidGhost, ghostFor, betterGhost, ghostAt,
  ghostLead, leadLabel,
} from './logic.js?v=e2da0a7';
import { drawScene, sceneView, readPalette, createFx, fxEvents, fxUpdate, fxBusy, endingDone } from './draw.js?v=e2da0a7';
import { createProfile } from '../../shared/profile.js?v=e2da0a7';
import { LocalStore } from '../../shared/stores/local.js?v=e2da0a7';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js?v=e2da0a7';
import { bindThemeToggle } from '../../shared/theme.js?v=e2da0a7';
import { play, music } from '../../shared/sound.js?v=e2da0a7';
import { setupHelp } from '../../shared/help.js?v=e2da0a7';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=e2da0a7';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=e2da0a7';
import { load, save } from '../../shared/storage.js?v=e2da0a7';

const GAME_ID = 'moto2';
const SAVE_EVERY = 30;
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let state, best = 0, ended = null, ghost = null, fx = createFx();
let gameNo = 0, changing = false;
let showGhost = true;
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };
const pref = (key, choices, fallback) => {
  const value = load(`${key}:${GAME_ID}`, fallback);
  return choices.includes(value) ? value : fallback;
};

// 影子跑法使用規格指定的原始鍵;不透過 profile 或通用 storage 的前綴。
function readGhost(difficulty) {
  try {
    const g = JSON.parse(localStorage.getItem(`moto2:ghost:${difficulty}`));
    return isValidGhost(g) ? g : null;
  } catch { return null; }
}
function writeGhost(s) {
  const old = readGhost(s.difficulty), candidate = ghostFor(s);
  const next = betterGhost(old, candidate);
  if (next !== candidate) return;
  try { localStorage.setItem(`moto2:ghost:${s.difficulty}`, JSON.stringify(next)); } catch { /* 無儲存空間仍能完賽 */ }
}

function persist() {
  if (!state.moves || state.over || ended) return;
  const saved = toSave(state);
  run(() => profile.saveState(GAME_ID, saved));
}
async function startNew(difficulty = pref('difficulty', DIFFICULTIES, 'normal'), mode = pref('mode', MODES, 'race')) {
  state = initState(Math.random, difficulty, mode);
  fx = createFx(); ended = null; gameNo++; clearInput();
  ghost = mode === 'time' ? readGhost(difficulty) : null;
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID); profile.setVisible(false);
  });
  render();
}

// 同一局結算只有一個 Promise;新局等存檔/結算佇列清空後再開始。
function finish(quit = false) {
  if (ended) return queue;
  const snap = structuredClone(state), args = resultFor(snap, quit), no = gameNo;
  ended = { pending: true }; clearInput();
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, args);
    if (no !== gameNo) return;
    if (!out) { ended = { abandoned: true }; render(); return; }
    if (!quit && snap.mode === 'time') writeGhost(snap);
    best = await profile.best(GAME_ID);
    ended = { ...args, duplicate: out.duplicate, xp: out.xpGained, xpBreakdown: out.xpBreakdown, newAchievements: out.newAchievements,
      isBest: out.play.is_best, bestBefore };
    render();
  }).then(async () => {
    if (no === gameNo && ended?.abandoned && !quit && !changing) await startNew(snap.difficulty, snap.mode);
  });
}
async function newGame(difficulty = state.difficulty, mode = state.mode) {
  if (changing || ended?.pending) { render(); return; }
  changing = true;
  pause();
  if (!ended) {
    const result = resultOnNewGame({ everWon: false, moves: state.moves });
    if (result) await finish(true);
    else await run(() => profile.discardSave(GAME_ID));
  }
  save('difficulty:moto2', difficulty); save('mode:moto2', mode);
  await startNew(difficulty, mode);
  changing = false;
  render();
}
function pause() {
  clearInput();
  if (state.paused || state.over || ended) return;
  state = pauseState(state); persist();
  run(() => profile.setVisible(false)); render();
}
function resume() {
  if (!state.paused || state.over || ended || document.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return;
  clearInput(); state = resumeState(state);
  if (state.ticks === 0 && state.countdown > 0) play('countdown');
  run(() => { profile.setVisible(true); profile.input(); }); render();
}
function togglePause() { if (state.paused) resume(); else pause(); }

const held = new Map(); // 來源(實體鍵 / pointerId) → 操作;每指獨立釋放。
let pendingDir = 0, lastInput = 0;
const noteInput = () => { profile.input(); lastInput = performance.now(); };
function clearInput() {
  held.clear(); pendingDir = 0;
  document.querySelectorAll('[data-control]').forEach((b) => b.classList.remove('held'));
}
const acceptsInput = () => !changing && !ended && !state.paused && !state.over && state.countdown === 0;
function press(src, action) {
  if (!acceptsInput()) return; // 倒數中按住的鍵也不帶入起跑。
  noteInput();
  held.set(src, action);
  if (action === 'up' || action === 'down') pendingDir = action === 'up' ? -1 : 1;
}
function release(src) { held.delete(src); }

let running = false, last = 0, acc = 0;
const playing = () => !changing && !state.paused && !state.over && !ended;
function frame(t) {
  if (!playing() && !fxBusy(fx)) { running = false; return; }
  const dt = Math.max(0, Math.min(0.25, (t - last) / 1000)); last = t;
  if (playing()) {
    acc += dt;
    if (held.size && t - lastInput >= 1000) noteInput();
    while (acc >= DT && playing()) {
      acc -= DT;
      const prev = state;
      state = stepState(state, {
        throttle: [...held.values()].includes('throttle'), sprint: [...held.values()].includes('sprint'),
        up: [...held.values()].includes('up'), down: [...held.values()].includes('down'),
        left: [...held.values()].includes('left'), right: [...held.values()].includes('right')
          || [...held.entries()].some(([src, action]) => action === 'throttle' && src.startsWith('key:')), dir: pendingDir,
      }, DT);
      pendingDir = 0;
      if (Math.ceil(state.countdown) < Math.ceil(prev.countdown)) play(state.countdown > 0 ? 'countdown' : 'go');
      if (playerOf(state).crash > playerOf(prev).crash) play('crash');
      if (playerOf(state).overheat > playerOf(prev).overheat) play('hurt');
      if (state.over && !prev.over) play('win');
      fxEvents(fx, prev, state, { reduced: reduced.matches });
      if (state.over) finish();
      else if (state.ticks % SAVE_EVERY === 0) persist();
    }
  }
  fxUpdate(fx, dt); render(); requestAnimationFrame(frame);
}
function syncLoop() {
  if (running || (!playing() && !fxBusy(fx))) return;
  running = true; last = performance.now(); acc = 0; requestAnimationFrame(frame);
}

const canvas = $('field'), ctx = canvas.getContext('2d');
let pal;
const readColors = () => { pal = readPalette(getComputedStyle(document.documentElement)); };
function draw() {
  if (!state || !pal || !canvas.width) return;
  const view = sceneView(canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
  // RS49:影子車與秒差同一開關;沒有最佳紀錄時兩者都不出現。
  const shown = showGhost && state.mode === 'time' && ghost && state.countdown === 0;
  const lead = shown ? leadLabel(ghostLead(ghost, playerOf(state).x, state.time)) : null;
  drawScene(ctx, state, pal, fx, { reduced: reduced.matches, ghost: showGhost ? ghostAt(ghost, state.time) : null, lead, view });
}
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr)); draw();
}
function paragraph(container, text, className = '') {
  if (!text) return;
  const p = document.createElement('p'); p.className = className; p.textContent = text; container.append(p);
}
let overlaySignature = '';
function renderOverlay() {
  let kind = overlayFor(state);
  if (kind === 'over' && !endingDone(fx)) kind = null;
  const signature = `${gameNo}|${kind}|${ended?.pending ? 'pending' : ended ? 'done' : ''}`;
  if (signature === overlaySignature) return;
  overlaySignature = signature;
  $('overlay').hidden = kind === null;
  if (!kind) return;
  const info = $('overlay-info'), actions = $('overlay-actions'); info.replaceChildren(); actions.replaceChildren();
  const button = document.createElement('button'); button.className = 'btn'; button.type = 'button';
  if (kind === 'ready' || kind === 'paused') {
    $('overlay-title').textContent = kind === 'ready' ? '準備出發' : '已暫停';
    paragraph(info, kind === 'ready' ? '倒數後按住油門,用上下鍵閃障礙' : '繼續後按住油門接著跑');
    if (state.mode === 'time') paragraph(info, ghost ? `影子最佳 ${(ghost.ms / 1000).toFixed(2)} 秒` : '完賽後留下你的第一台影子車');
    button.textContent = kind === 'ready' ? '▶ 開始' : '▶ 繼續'; button.dataset.act = 'resume';
  } else {
    $('overlay-title').textContent = ended?.result === 'win' ? (state.mode === 'time' ? '完賽!' : '第一名!') : '比賽結束';
    if (ended?.pending) paragraph(info, '結算中…');
    else if (ended?.abandoned) paragraph(info, '本局紀錄未儲存');
    else if (ended) {
      paragraph(info, `${state.mode === 'race' ? `第 ${ended.detail.place} 名 · ` : ''}${(ended.detail.ms / 1000).toFixed(2)} 秒`);
      if (ended.duplicate) paragraph(info, DUPLICATE_FINISH_TEXT);
      paragraph(info, `${ended.score.toLocaleString()} 分 · 本局 +${ended.xp} XP`, 'overlay-xp');
      if (!ended.duplicate) appendXpBreakdown(info, ended.xpBreakdown);
      if (ended.newAchievements.length) paragraph(info, `新成就:${ended.newAchievements.map((id) => {
        const a = ACHIEVEMENTS.find((x) => x.id === id); return a ? `${a.icon} ${a.name}` : id;
      }).join('、')}`);
      paragraph(info, bestLine(ended));
    }
    button.textContent = '再玩一次'; button.dataset.act = 'new'; button.disabled = !!ended?.pending;
  }
  actions.append(button);
}
let statusSignature = '';
function render() {
  if (!state) return;
  music(playing()); // RS68:遊玩中播背景音樂(選曲見 ? 玩法);暫停/結束/換關即淡出
  $('score').textContent = state.over ? resultFor(state).score.toLocaleString() : '0';
  $('best').textContent = best.toLocaleString();
  $('mode').value = state.mode; $('difficulty').value = state.difficulty;
  $('pause').textContent = state.paused ? '▶' : '⏸';
  $('pause').setAttribute('aria-label', state.paused ? '開始或繼續' : '暫停');
  $('pause').disabled = !!ended || state.over;
  for (const id of ['new', 'mode', 'difficulty']) $(id).disabled = changing || !!ended?.pending;
  document.querySelectorAll('[data-control]').forEach((b) => {
    b.disabled = !acceptsInput();
    b.classList.toggle('held', [...held.values()].includes(b.dataset.control));
  });
  const player = playerOf(state);
  const status = `${state.paused ? '已暫停' : state.countdown ? `倒數 ${Math.ceil(state.countdown)}` : player.overheat ? '引擎過熱' : player.crash ? '摔車' : player.air ? '騰空' : player.mud ? '泥坑減速' : '騎乘中'} · 進度 ${Math.floor(player.x / 100) * 100}`;
  if (status !== statusSignature) { $('status').textContent = status; statusSignature = status; }
  $('place').textContent = state.mode === 'race' ? `第 ${ranking(state).indexOf(0) + 1} / 4 名` : '計時賽';
  $('time').textContent = `${state.time.toFixed(1)} 秒`;
  $('speed').textContent = `速度 ${Math.round(player.speed)}`;
  $('heat').value = player.heat; $('heat-value').textContent = String(Math.round(player.heat));
  $('engine').textContent = player.overheat ? `冷卻 ${player.overheat.toFixed(1)}s` : player.sprinting ? '衝刺中' : '正常';
  $('progress-fill').style.width = `${player.x / TRACK_LEN * 100}%`;
  $('progress-track').setAttribute('aria-valuenow', String(Math.floor(player.x / TRACK_LEN * 100)));
  $('position-dots').replaceChildren(...state.vehicles.map((v) => {
    const dot = document.createElement('span'); dot.className = `position-dot ${v.id ? `cpu${v.id}` : 'player'}`;
    dot.style.left = `${Math.max(1, Math.min(99, v.x / TRACK_LEN * 100))}%`;
    dot.title = v.id ? `CPU ${v.id}` : '你'; return dot;
  }));
  draw(); renderOverlay(); syncLoop();
}

const KEYS = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'throttle', d: 'throttle', ' ': 'sprint', j: 'sprint' };
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || e.target instanceof HTMLSelectElement || ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('[data-control]'))) return;
  if (e.key.toLowerCase() === 'p') {
    e.preventDefault(); if (!e.repeat) { noteInput(); togglePause(); } return;
  }
  const action = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault(); if (!e.repeat) press(`key:${e.code}`, action);
});
document.addEventListener('keyup', (e) => release(`key:${e.code}`));
window.addEventListener('blur', pause);
document.querySelectorAll('[data-control]').forEach((b) => {
  const action = b.dataset.control;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !acceptsInput()) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真指標 */ }
    press(`pointer:${e.pointerId}`, action); render();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(event, (e) => { release(`pointer:${e.pointerId}`); render(); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); if (!e.repeat) { press(`button:${action}`, action); render(); }
  });
  b.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); release(`button:${action}`); render();
  });
  b.addEventListener('blur', () => { release(`button:${action}`); render(); });
  b.addEventListener('click', (e) => {
    if (e.detail !== 0 || !acceptsInput() || held.has(`button:${action}`)) return;
    press('assistive', action); setTimeout(() => { release('assistive'); render(); }, 200); render();
  });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pause(); });
window.addEventListener('pagehide', () => { pause(); persist(); });
$('pause').addEventListener('click', togglePause);
$('new').addEventListener('click', () => newGame());
$('mode').addEventListener('change', (e) => newGame(state.difficulty, e.target.value));
$('show-ghost').addEventListener('change', (e) => {
  showGhost = e.target.value !== 'off';
  save('ghost:moto2', showGhost ? 'on' : 'off'); draw();
});
$('difficulty').addEventListener('change', (e) => newGame(e.target.value, state.mode));
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'resume') resume(); if (act === 'new') newGame();
});
showGhost = pref('ghost', ['on', 'off'], 'on') === 'on'; $('show-ghost').value = showGhost ? 'on' : 'off';
bindThemeToggle($('theme'));
$('theme').addEventListener('click', () => { readColors(); draw(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
readColors(); new ResizeObserver(resize).observe(canvas);

const saved = await profile.loadSave(GAME_ID);
if (saved) {
  state = fromSave(saved); gameNo++;
  ghost = state.mode === 'time' ? readGhost(state.difficulty) : null;
  best = await profile.best(GAME_ID); profile.startTimer(GAME_ID); profile.setVisible(false); render();
} else await startNew();
resize();

// 教學狀態與結果皆透過純邏輯實算,共用正式繪圖。
const demoState = (angle) => {
  const s = initState(() => 0.4, 'normal', 'time');
  const track = [{ id: 0, lane: 0, x: 30, kind: 'ramp', length: 24, height: 4 }];
  return { ...s, paused: false, countdown: 0, time: 10, ticks: 780, track,
    vehicles: [{ ...playerOf(s), x: 95, speed: 48, h: 0.05, vy: -8, air: 1.1, angle, lastObject: 0 }] };
};
function demoImage(s) {
  const c = document.createElement('canvas'); c.width = W * 30; c.height = H * 30;
  const g = c.getContext('2d'); g.setTransform(30, 0, 0, 30, 0, 0);
  drawScene(g, s, pal, null, { reduced: true });
  return `<img class="demo-field" src="${c.toDataURL()}" alt="橫向機車示範場面">`;
}
const crashDemo = demoState(40), perfectDemo = demoState(0);
const heatDemo = { ...demoState(0), vehicles: [{ ...playerOf(demoState(0)), air: 0, h: 0, vy: 0, heat: 99.5 }] };
document.addEventListener('helpopen', pause);
setupHelp({
  gameId: GAME_ID, title: '越野機車 橫向版玩法', mountAfter: document.querySelector('.topbar .btn'),
  rules: `<ol>
    <li>→ D／油門按住加速;空白 J／衝刺加速更快、最高速多25%。手機油門與衝刺可同時按。</li>
    <li>↑↓ W S／▲▼按一下換道;空中不能換道,改為後仰／前傾。← A／◀地面煞車、空中後仰;▶空中前傾。</li>
    <li>土坡車身隨坡面傾斜;跳台飛得多高多遠取決於速度。落地角差≤8°完美加速,≤25°安全,超過25°摔車停1.5秒。</li>
    <li>衝刺每秒升溫30;只按油門降10;放開降25。溫度100過熱停3秒,路邊藍色雪花冷卻點歸零。</li>
    <li>泥坑限速一半;地面撞路障摔車;騰空可飛越障礙。同車道追撞降至前車速度。</li>
    <li>計時賽有最佳紀錄時畫面出現半透明影子車(標「最佳紀錄」)與上方「領先／落後 x.x 秒」;設定「影子車」可隱藏。</li>
    <li>⏸／P暫停;開說明、離開分頁也暫停。競速與3台電腦車比;計時賽挑戰同難度最佳影子。</li>
    <li>競速第一名／計時賽完賽獲勝。名次分3000/2000/1000/500或計時賽1000,加max(0,150−秒數)×10取整。放棄0分。</li>
  </ol>`,
  demo: { render: demoImage, steps: [
    { before: crashDemo, after: stepState(crashDemo, { throttle: true }), kind: 'fail', caption: '跳台後以40°角落地…', result: '…角差過大,摔車停1.5秒' },
    { before: perfectDemo, after: stepState(perfectDemo, { throttle: true }), kind: 'ok', caption: '空中調整至與坡面一致…', result: '…完美落地,立刻加速!' },
    { before: heatDemo, after: stepState(heatDemo, { sprint: true }), kind: 'fail', caption: '引擎接近100仍繼續衝刺…', result: '…過熱強制停車3秒,冷卻後再起步' },
  ] },
});

