// 下樓梯畫面層:requestAnimationFrame 迴圈、輸入收集、Canvas 繪圖。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  W, H, PLAYER, DT, MAX_LIVES, DIFFICULTIES, initState, stepState, pauseState, resumeState, overlayFor,
  toSave, fromSave, isValidState,
  initAdventure, nextStage, scoreFor, detailFor, resultFor, stageFor, goalText, goalProgress, flipNotice, ridingCloud,
} from './logic.js?v=4577fc1';
import { drawScene, readPalette, createFx, fxEvents, fxUpdate, fxBusy, endingDone } from './draw.js?v=4577fc1';
import { createProfile } from '../../shared/profile.js?v=4577fc1';
import { LocalStore } from '../../shared/stores/local.js?v=4577fc1';
import { ACHIEVEMENTS, resultOnNewGame } from '../../shared/progress.js?v=4577fc1';
import { bindThemeToggle } from '../../shared/theme.js?v=4577fc1';
import { currentSkin, isDark, SKIN_EVENT } from '../../shared/skin.js?v=4577fc1';
import { skinPalette } from './skins.js?v=4577fc1';
import { play, music } from '../../shared/sound.js?v=4577fc1';
import { setupHelp } from '../../shared/help.js?v=4577fc1';
import { appendXpBreakdown, bestLine } from '../../shared/xp-explain.js?v=4577fc1';
import { settlePlay, DUPLICATE_FINISH_TEXT } from '../../shared/settle.js?v=4577fc1';
import { needsQuitBestConfirm, confirmQuitBest } from '../../shared/quit.js?v=4577fc1';
import { load, save } from '../../shared/storage.js?v=4577fc1';

const GAME_ID = 'stairs';
const DIFF_KEY = 'difficulty:stairs'; // 上次選的難度(開新局用)
const SAVE_EVERY = 30; // 每推進幾步存一次檔(0.5 秒);暫停、分頁隱藏時也存
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, newAchievements, isBest, bestBefore, score };結算中為 { pending: true }
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面
let fx = createFx(); // 畫面特效(RS11;不進存檔)
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// 紀錄寫入依序執行,避免存檔與結算交錯。
let queue = Promise.resolve();
const run = (fn) => { queue = queue.then(fn).catch((e) => console.error(e)); return queue; };

// 暫停中不算遊戲時間:暫停時通知 profile「不可見」,繼續時恢復並記一次輸入。
const timerPause = () => run(() => profile.setVisible(false));
const timerResume = () => run(() => { profile.setVisible(true); profile.input(); });

function difficultyPref() {
  const d = load(DIFF_KEY, 'normal');
  return DIFFICULTIES.includes(d) ? d : 'normal';
}

function persist() {
  if (state.ticks === 0 || state.over) return; // 未動不存;結束由結算刪檔
  const saved = toSave(state);
  run(() => profile.saveState(GAME_ID, saved));
}

async function startNew(difficulty = difficultyPref(), mode = 'adventure') {
  state = mode === 'adventure' ? initAdventure() : initState(Math.random, difficulty);
  clearInput();
  fx = createFx();
  gameNo++;
  ended = null;
  render();
  await run(async () => {
    best = await profile.best(GAME_ID);
    profile.startTimer(GAME_ID);
    profile.setVisible(false); // 開局暫停
  });
  render();
}

// 一局結束:依 §4.2 結算(每局只執行一次),結果顯示在遮罩。
function finish(result) {
  const snap = { score: scoreFor(state), difficulty: state.difficulty, detail: detailFor(state) };
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await settlePlay(profile, GAME_ID, {
      result, score: snap.score, difficulty: snap.difficulty, detail: snap.detail,
    });
    if (!out) { if (no === gameNo) startNew(undefined, state.mode); return; } // 結算失敗且選「不存了」:不記錄、開新局(IR6)
    if (out.play.is_best) best = Math.max(best, snap.score);
    if (no !== gameNo) return;
    ended = {
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

// 新遊戲(含切換難度):未動不記錄、已動未結束 ⇒ quit。
let confirmingQuit = false;
async function newGame(difficulty, mode = state.mode) {
  if (confirmingQuit) return;
  if (ended?.pending) return; // 結算中:忽略連點
  if (!ended) {
    const result = resultOnNewGame({ everWon: false, moves: state.ticks });
    const note = { score: scoreFor(state), best, assist: state.assist };
    if (result === 'quit' && needsQuitBestConfirm(note)) {
      confirmingQuit = true;
      const running = !state.paused;
      if (running) timerPause();
      const quit = await confirmQuitBest(note);
      confirmingQuit = false;
      if (!quit) {
        $('difficulty').value = state.difficulty;
        $('mode').value = state.mode;
        if (running && document.visibilityState !== 'hidden' && !state.paused) timerResume();
        syncLoop();
        return;
      }
    }
    if (result) finish(result);
  }
  if (difficulty !== undefined) save(DIFF_KEY, difficulty);
  startNew(difficulty, mode);
}

function pause() {
  if (ended || state.paused) return;
  state = pauseState(state);
  persist();
  timerPause();
  render();
}

function resume() {
  if (ended || !state.paused || state.stageCleared) return;
  state = resumeState(state);
  timerResume();
  render();
}

function togglePause() {
  if (state.paused) resume();
  else pause();
}

// ---- 輸入:按住移動、放開停止 ----

const keys = { left: false, right: false, up: false, down: false };
const touches = new Map(); // pointerId → { side: -1 / 1, x, y 場地座標 }(後按的優先)
let dismountQueued = false; // 按了下雲,下一步生效
function clearInput() { keys.left = false; keys.right = false; keys.up = false; keys.down = false; touches.clear(); dismountQueued = false; }

function advanceStage() {
  const next = nextStage(state);
  if (next === state) return;
  state = next;
  clearInput();
  fx = createFx();
  persist();
  render();
}
const HOLD_INPUT_MS = 1000; // 按住不放時,每秒至少記一次輸入(避免被判閒置)
let lastInputAt = 0;
const noteInput = (t = performance.now()) => {
  lastInputAt = t;
  profile.input();
};

const RIDE_DEADZONE = 0.4; // 駕雲觸控:手指離角色中心這麼近就不動(場地單位)
// 本步輸入 { dir, dy }。駕雲時觸控 = 往手指的方向飛;平常觸控 = 按住左半邊/右半邊。
function inputNow() {
  if (touches.size) {
    const t = [...touches.values()].at(-1);
    if (!ridingCloud(state)) return { dir: t.side, dy: 0 };
    const toward = (d) => (Math.abs(d) < RIDE_DEADZONE ? 0 : Math.sign(d));
    return { dir: toward(t.x - (state.player.x + PLAYER / 2)), dy: toward(t.y - (state.player.y + PLAYER / 2)) };
  }
  return { dir: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy: (keys.down ? 1 : 0) - (keys.up ? 1 : 0) };
}
const inputDir = () => inputNow().dir;

// ---- 迴圈:固定步長累積;進行中,或特效/結束動畫還沒播完時跑 ----

let running = false;
let last = 0;
let acc = 0;
const playing = () => !confirmingQuit && !state.paused && !state.over && !ended;
const animating = () => fxBusy(fx);

function frame(t) {
  if (!playing() && !animating()) {
    running = false;
    return;
  }
  const dt = Math.max(0, Math.min(0.25, (t - last) / 1000)); // 切回分頁或卡頓時不一次追太多步;時間戳倒退時不倒轉特效
  last = t;
  if (playing()) {
    acc += dt;
    const held = inputNow();
    if ((held.dir !== 0 || held.dy !== 0) && t - lastInputAt >= HOLD_INPUT_MS) noteInput(t);
    while (acc >= DT && playing()) {
      acc -= DT;
      const prev = state;
      const { dir, dy } = inputNow();
      state = stepState(state, { dir, dy, dismount: dismountQueued });
      dismountQueued = false;
      if ((prev.player.on === null && state.player.on !== null)
        || (prev.player.vy >= 0 && state.player.vy < 0 && state.player.on === null
          && state.platforms.some((p) => p.kind === 'bounce' && Math.abs(p.y - state.player.y - PLAYER) < 0.3))) play('land');
      if (state.hurt > prev.hurt) play('hurt');
      if (state.picked) play('coin');
      if (state.stageCleared && !prev.stageCleared) play('win');
      if (state.over && !prev.over && !state.won) play('lose');
      fxEvents(fx, prev, state, { dir, reduced: reducedMotion.matches });
      if (state.over) {
        timerPause();
        finish(resultFor(state));
      } else if (state.stageCleared) {
        clearInput();
        timerPause();
        persist();
      } else if (state.ticks % SAVE_EVERY === 0) {
        persist();
      }
    }
  }
  const wasEnding = !endingDone(fx);
  fxUpdate(fx, dt, playing() ? state.speed : 0);
  if (wasEnding && endingDone(fx)) shownKind = null; // 結束動畫播完:顯示結算遮罩
  render();
  requestAnimationFrame(frame);
}

// 只在「進行中」或「特效未播完」時跑迴圈;都停了下一張 frame 自行停下。
function syncLoop() {
  if ((!playing() && !animating()) || running) return;
  running = true;
  last = performance.now();
  acc = 0;
  requestAnimationFrame(frame);
}

// ---- 繪圖(美術在 draw.js)----

const canvas = $('field');
const ctx = canvas.getContext('2d');
let pal = {};
const readColors = () => { pal = skinPalette(readPalette(getComputedStyle(document.documentElement)), currentSkin(), isDark()); };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  draw();
}

function draw() {
  if (!state) return;
  const s = canvas.width / W;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  drawScene(ctx, state, pal, fx, { reduced: reducedMotion.matches });
}

// ---- 畫面 ----

let shown = { score: -1, best: -1, lives: -1 };
function render() {
  music(playing() && overlayFor(state) === null); // 只在實際遊玩中播背景音樂;暫停、過關、結束即淡出
  const score = scoreFor(state);
  const b = Math.max(best, score);
  if (shown.score !== score) $('score').textContent = score.toLocaleString();
  if (shown.best !== b) $('best').textContent = b.toLocaleString();
  if (shown.lives !== state.lives) $('status').textContent = `生命 ${state.lives}/${MAX_LIVES}`;
  shown = { score, best: b, lives: state.lives };
  $('difficulty').value = state.difficulty;
  const adventure = state.mode === 'adventure';
  $('mode').value = state.mode;
  $('mode').disabled = !!ended?.pending;
  $('difficulty').disabled = adventure || !!ended?.pending;
  $('score-label').textContent = adventure ? '分數' : '層數';
  $('adventure-hud').hidden = !adventure;
  if (adventure) {
    $('stage-name').textContent = `${state.stage}. ${stageFor(state).name}`;
    $('goal-progress').textContent = goalProgress(state);
    const treasures = [`生命 ${state.lives}/${MAX_LIVES}`, `金幣 ${state.coins}`];
    if (state.star > 0) treasures.push(`星星 ${Math.ceil(state.star)}秒`);
    if (state.shield) treasures.push('護盾 ×1');
    if (state.cloudTime > 0) treasures.push(`駕雲 ${Math.ceil(state.cloudTime)}秒`);
    $('treasures').textContent = treasures.join(' · ');
  }
  const pauseBtn = $('pause');
  const label = state.paused ? (state.ticks === 0 ? '開始' : '繼續') : '暫停';
  pauseBtn.textContent = state.paused ? '▶' : '⏸';
  pauseBtn.setAttribute('aria-label', label);
  pauseBtn.title = `${label}(P)`;
  pauseBtn.disabled = !!ended || state.over || state.stageCleared;
  $('cloud-off').hidden = !ridingCloud(state) || state.paused || state.over;
  draw();
  renderOverlay();
  syncLoop();
}

const achName = (id) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return a ? `${a.icon} ${a.name}` : id;
};

function infoLine(text, className = '') {
  const p = document.createElement('p');
  p.textContent = text;
  p.className = className;
  $('overlay-info').append(p);
}
function resultInfo() {
  if (!ended) return;
  if (ended.pending) { infoLine('結算中…'); return; }
  const adventure = ended.detail.mode === 'adventure';
  infoLine(adventure ? `本局 ${ended.score.toLocaleString()} 分 · 通過 ${ended.detail.cleared} / 6 關` : `下了 ${ended.score.toLocaleString()} 層`);
  if (adventure) infoLine(`本關金幣 ${state.stageCoins} · 累計金幣 ${ended.detail.coins} · 剩餘生命 ${state.lives}`);
  if (ended.duplicate) infoLine(DUPLICATE_FINISH_TEXT);
  infoLine(`本局 +${ended.xp} XP`, 'overlay-xp');
  if (!ended.duplicate) appendXpBreakdown($('overlay-info'), ended.xpBreakdown, document);
  if (ended.newAchievements.length) infoLine(`新成就:${ended.newAchievements.map(achName).join('、')}`);
  const line = bestLine({ ...ended, noun: '紀錄', unit: adventure ? ' 分' : ' 層' });
  if (line) infoLine(line);
}

let shownKind = null;
function renderOverlay() {
  const overlay = $('overlay');
  const kind = overlayFor(state) === 'over' && !endingDone(fx) ? null : overlayFor(state); // 結束動畫播完才出遮罩
  const sig = `${state.mode}|${state.stage}|${kind}|${ended ? (ended.pending ? 'p' : 'd') : ''}`;
  if (sig === shownKind) return; // 進行中不重繪遮罩
  shownKind = sig;
  const actions = $('overlay-actions');
  $('overlay-info').textContent = '';
  if (kind === 'ready') {
    $('overlay-title').textContent = state.mode === 'adventure' ? `第 ${state.stage} 關：${stageFor(state).name}` : '準備開始';
    const flip = state.mode === 'adventure' ? flipNotice(state) : null;
    if (flip) infoLine(`🙃 ${flip}`, 'overlay-flip');
    if (state.mode === 'adventure') infoLine(goalText(state));
    infoLine('按 ← →,或按住場地左半邊/右半邊開始');
    actions.innerHTML = '<button class="btn" data-act="resume">▶ 開始</button>';
  } else if (kind === 'paused') {
    $('overlay-title').textContent = '已暫停';
    infoLine('按 P、← →,或按住場地左右半邊接著玩');
    actions.innerHTML = '<button class="btn" data-act="resume">▶ 繼續</button>';
  } else if (kind === 'over') {
    $('overlay-title').textContent = state.won ? '六關全破！' : '遊戲結束';
    actions.innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
    resultInfo();
  } else if (kind === 'cleared') {
    $('overlay-title').textContent = `第 ${state.stage} 關過關！`;
    infoLine(`本關金幣 ${state.stageCoins} · 剩餘生命 ${state.lives}/${MAX_LIVES}`);
    infoLine('過關 +30 分 · 回復 1 命（上限 3）');
    actions.innerHTML = '<button class="btn" data-act="next">下一關</button>';
  } else {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
}

// ---- 事件 ----

const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', a: 'left', d: 'right', ArrowUp: 'up', ArrowDown: 'down', w: 'up', s: 'down' };
function dismount() {
  if (!ridingCloud(state) || state.paused) return;
  dismountQueued = true;
  noteInput();
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.target instanceof HTMLSelectElement) return; // 難度選單用方向鍵切換選項
  if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (ended || e.repeat) return;
    profile.input();
    togglePause();
    return;
  }
  if (e.key === ' ' && ridingCloud(state) && !state.paused) { // 空白鍵下雲
    e.preventDefault();
    if (!e.repeat) dismount();
    return;
  }
  const k = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!k) return;
  e.preventDefault();
  if (ended) return;
  keys[k] = true;
  noteInput();
  if (state.paused) resume();
});

document.addEventListener('keyup', (e) => {
  const k = KEYS[e.key] || KEYS[e.key?.toLowerCase()];
  if (k) keys[k] = false;
});
window.addEventListener('blur', clearInput);

// 觸控:按住場地左半邊/右半邊移動,放開停止;暫停中按下就繼續。遮罩上的按鈕照常點。
const stage = $('stage');
// 觸點在場地座標(畫面方向,與 state 一致)。
const touchOf = (e) => {
  const r = canvas.getBoundingClientRect();
  return { side: e.clientX < r.left + r.width / 2 ? -1 : 1, x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
};
stage.addEventListener('pointerdown', (e) => {
  if (ended || state.over || e.target.closest('button')) return;
  e.preventDefault();
  stage.setPointerCapture?.(e.pointerId);
  touches.delete(e.pointerId);
  touches.set(e.pointerId, touchOf(e));
  noteInput();
  if (state.paused) resume();
});
stage.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  const t = touchOf(e);
  const changed = t.side !== touches.get(e.pointerId).side;
  touches.set(e.pointerId, t); // 駕雲時手指拖到哪就往哪飛
  if (changed) noteInput(); // 拖移換邊 = 一次新輸入
});
const release = (e) => touches.delete(e.pointerId);
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('lostpointercapture', release);
stage.addEventListener('contextmenu', (e) => e.preventDefault());

// 分頁隱藏自動暫停。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pause();
});

$('new').addEventListener('click', () => newGame());
$('cloud-off').addEventListener('click', dismount);
$('pause').addEventListener('click', () => {
  profile.input();
  togglePause();
});
$('difficulty').addEventListener('change', (e) => {
  if (state.mode === 'adventure') return;
  const d = e.target.value;
  if (ended?.pending) {
    e.target.value = state.difficulty;
    return;
  }
  newGame(d);
});
$('mode').addEventListener('change', (e) => {
  if (ended?.pending) { e.target.value = state.mode; return; }
  newGame(undefined, e.target.value);
});
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (act === 'new') newGame();
  if (act === 'next') advanceStage();
  if (act === 'resume') {
    profile.input();
    resume();
  }
});

bindThemeToggle($('theme'));
$('theme').addEventListener('click', () => { readColors(); draw(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
document.addEventListener(SKIN_EVENT, () => { readColors(); draw(); }); // RS19:切換美術主題後重讀色票
readColors();
new ResizeObserver(resize).observe(canvas);

// 載入:有存檔就自動還原(暫停狀態),否則開新局。
const saved = await profile.loadSave(GAME_ID);
if (saved && isValidState(saved)) {
  state = fromSave(saved);
  best = await profile.best(GAME_ID);
  profile.startTimer(GAME_ID);
  profile.setVisible(false);
  render();
} else {
  await startNew();
}
resize();

// ---- 說明與示範:場面一律由 logic 實算 ----

const demoPlatform = (n, y, kind = 'normal', x = 2.5, w = 4) => ({ n, x, y, w, kind, flip: null, item: null });
const demoState = (player, platforms, fields = {}) => ({
  ...initState(() => 0.5),
  paused: false,
  ticks: 1,
  player: { vy: 0, on: null, drop: null, ...player },
  platforms,
  nextN: platforms.at(-1).n + 1,
  ...fields,
});
const stepUntil = (s, done, max = 300) => {
  for (let i = 0; i < max && !done(s) && !s.over; i++) s = stepState(s, { dir: 0 });
  return s;
};
const steps = (s, n) => {
  for (let i = 0; i < n && !s.over; i++) s = stepState(s, { dir: 0 });
  return s;
};
const below = (n0) => [demoPlatform(n0 + 1, 15, 'normal', 0.5, 3), demoPlatform(n0 + 2, 17, 'normal', 5, 3)];

// 示範圖:用遊戲同一套繪圖(draw.js)畫成圖片,美術與實際畫面一致。
const DEMO_PX = 40; // 每個場地單位幾個像素
function demoSvg(s) {
  const c = document.createElement('canvas');
  c.width = W * DEMO_PX;
  c.height = H * DEMO_PX;
  const g = c.getContext('2d');
  g.setTransform(DEMO_PX, 0, 0, DEMO_PX, 0, 0);
  drawScene(g, s, pal, null, { reduced: true, demo: true });
  return `<img class="demo-field" src="${c.toDataURL()}" alt="示範場面">`;
}

const landOn = (s) => stepUntil(s, (x) => x.player.on !== null);
const demoStep = (before, act, caption, result) => ({ before, after: act(before), caption, result });
const adventureDemo = (fields) => ({ ...initAdventure(() => .5, 4), ...fields, paused: false });
// 打開說明時先暫停;先註冊,也涵蓋首次自動開啟說明。
document.addEventListener('helpopen', pause);
setupHelp({
  gameId: GAME_ID,
  title: '下樓梯玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>闖關模式依序挑戰六關：層數、生存時間、金幣與終點旗；第五關往上爬，畫面上下顛倒（像把手機倒著拿），危險刺在底部。每關按開始，過關回 1 命並延續生命。</li>
      <li>平台不斷往上捲;用 ← → / A D,或按住畫面左半邊/右半邊移動。</li>
      <li>刺平台扣 1 命;彈跳平台會把你彈起;翻轉平台踩上 0.5 秒後消失。</li>
      <li>移動平台會載你左右往返；冰平台左右加速、放開仍會滑。敵人側碰扣 1 命，從上方落下踩頭消滅並得 5 分。</li>
      <li>金幣得 2 分；星星無敵 6 秒，碰敵人直接消滅；護盾擋一次傷害；雲：10 秒內駕雲自由飛（← → ↑ ↓，或手指按住要去的位置），碰不到頂刺也不會掉出去；空白鍵或「☁ 下雲」隨時下來；時間到還在空中時，腳下生一朵雲接住，1.5 秒後消散。</li>
      <li>被推到頂端的刺扣 1 命並往下掉;掉出畫面底部直接結束。</li>
      <li>生命 3 格,每下 10 層站上普通平台回 1 命;碰到愛心也回 1 命(滿血照樣撿走)。</li>
      <li>P 或 ⏸ 暫停；難度只影響無盡模式，難度越高捲得越快、刺越多，XP 越多。</li>
      <li>闖關分數 = 累計層數 + 金幣 ×2 + 踩敵人 ×5 + 過關數 ×30。無盡沒有勝利，分數 = 層數；兩模式共用最佳紀錄。</li>
    </ol>`,
  demo: {
    render: demoSvg,
    steps: [
      { ...demoStep(adventureDemo({
        player: { x: 4, y: 4, vy: 4, vx: 0, on: null, drop: null },
        platforms: [{ ...demoPlatform(1, 8), motion: 1, enemy: { offset: 1.5, dir: 1 }, flag: false }, ...below(1)], nextN: 4,
      }), (s) => stepUntil(s, (s) => s.stomps > 0), '從敵人上方落下…', '…踩頭消滅敵人，小彈起並加 5 分'), kind: 'ok' },
      { ...demoStep(adventureDemo({
        player: { x: 1, y: 8 - PLAYER, vy: 0, vx: 0, on: 1, drop: null },
        platforms: [demoPlatform(1, 8, 'normal', 5, 3), ...below(1)], nextN: 4,
        cloudTime: 10, cloudUses: 1,
      }), (s) => { for (let i = 0; i < 30; i++) s = stepState(s, { dy: -1 }); return s; }, '雲寶物生效時按住 ↑…', '…駕雲往上飛，最高停在頂刺下方；隨時可下雲'), kind: 'ok' },
      { ...demoStep(demoState({ x: 4, y: 3 }, [demoPlatform(1, 7), ...below(1)]), landOn,
        '往下掉到普通平台…', '…站穩了:層數 +1'), kind: 'ok' },
      demoStep(demoState({ x: 4, y: 3 }, [demoPlatform(1, 7, 'bounce'), ...below(1)]), (s) => steps(stepUntil(s, (x) => x.player.vy < 0), 12),
        '落到彈跳平台…', '…被彈起來,再落回平台'),
      { ...demoStep(demoState({ x: 4.1, y: 3 }, [{ ...demoPlatform(1, 7), item: 'heart' }, ...below(1)], { lives: 2 }), landOn,
        '普通平台上有愛心…', '…碰到就撿起:生命 +1'), kind: 'ok' },
      { ...demoStep(demoState({ x: 4, y: 3 }, [demoPlatform(1, 7, 'spike'), ...below(1)]), landOn,
        '落到刺平台…', '…扣 1 命(左上愛心少一顆)'), kind: 'fail' },
      { ...demoStep(demoState({ x: 4, y: 1.2, on: 1 }, [demoPlatform(1, 1.2 + PLAYER), demoPlatform(2, 7, 'normal', 2.5, 4), ...below(2)]),
        (s) => steps(stepUntil(s, (x) => x.lives < MAX_LIVES), 20),
        '平台把你推到頂端…', '…被頂刺扎到扣 1 命,往下掉'), kind: 'fail' },
      { ...demoStep(demoState({ x: 0.2, y: 9 }, [demoPlatform(1, 4, 'normal', 5, 3), demoPlatform(2, 6, 'normal', 5, 3), demoPlatform(3, 17, 'normal', 5, 3)]),
        (s) => stepUntil(s, (x) => x.over),
        '底下沒有平台…', '…掉出畫面底部,遊戲結束'), kind: 'fail' },
    ],
  },
});
const helpButton = document.querySelector('.topbar .navigation button');
if (helpButton) {
  helpButton.setAttribute('aria-label', '玩法說明與示範');
  helpButton.innerHTML = '<span aria-hidden="true">?</span><span class="topbar-label">玩法</span>';
}
