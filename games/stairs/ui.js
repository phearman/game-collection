// 下樓梯畫面層:requestAnimationFrame 迴圈、輸入收集、Canvas 繪圖。規則一律呼叫 logic.js(遊戲)與 shared/profile.js(紀錄),這裡不寫規則。
import {
  W, H, PLAYER, CEIL, DT, MAX_LIVES, FLIP_DELAY, DIFFICULTIES, initState, stepState, pauseState, resumeState, overlayFor,
  toSave, fromSave, isValidState,
} from './logic.js';
import { createProfile } from '../../shared/profile.js';
import { LocalStore } from '../../shared/stores/local.js';
import { ACHIEVEMENTS, resultOnGameOver, resultOnNewGame } from '../../shared/progress.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';
import { load, save } from '../../shared/storage.js';

const GAME_ID = 'stairs';
const DIFF_KEY = 'difficulty:stairs'; // 上次選的難度(開新局用)
const SAVE_EVERY = 30; // 每推進幾步存一次檔(0.5 秒);暫停、分頁隱藏時也存
const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });

let state;
let best = 0; // 本局開始前的最佳分數(profile 管)
let ended = null; // 本局已結算:{ xp, newAchievements, isBest, bestBefore, score };結算中為 { pending: true }
let gameNo = 0; // 每開一局 +1;非同步結算回來時,局號不同就不動畫面

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

async function startNew(difficulty = difficultyPref()) {
  state = initState(Math.random, difficulty);
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
  const snap = { score: state.floors, difficulty: state.difficulty };
  ended = { pending: true };
  const no = gameNo;
  render();
  return run(async () => {
    const bestBefore = best;
    const out = await profile.finishPlay(GAME_ID, {
      result, score: snap.score, difficulty: snap.difficulty, detail: { floors: snap.score },
    });
    best = Math.max(best, snap.score);
    if (no !== gameNo) return;
    ended = {
      xp: out.xpGained,
      newAchievements: out.newAchievements,
      isBest: out.play.is_best,
      bestBefore,
      score: snap.score,
    };
    render();
  });
}

// 新遊戲(含切換難度):未動不記錄、已動未結束 ⇒ quit。
function newGame(difficulty) {
  if (ended?.pending) return; // 結算中:忽略連點
  if (!ended) {
    const result = resultOnNewGame({ everWon: false, moves: state.ticks });
    if (result) finish(result);
  }
  startNew(difficulty);
}

function pause() {
  if (ended || state.paused) return;
  state = pauseState(state);
  persist();
  timerPause();
  render();
}

function resume() {
  if (ended || !state.paused) return;
  state = resumeState(state);
  timerResume();
  render();
}

function togglePause() {
  if (state.paused) resume();
  else pause();
}

// ---- 輸入:按住移動、放開停止 ----

const keys = { left: false, right: false };
const touches = new Map(); // pointerId → -1 / 1(後按的優先)
const HOLD_INPUT_MS = 1000; // 按住不放時,每秒至少記一次輸入(避免被判閒置)
let lastInputAt = 0;
const noteInput = (t = performance.now()) => {
  lastInputAt = t;
  profile.input();
};

function inputDir() {
  if (touches.size) return [...touches.values()].at(-1);
  return (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
}

// ---- 迴圈:固定步長累積,只在進行中跑 ----

let running = false;
let last = 0;
let acc = 0;
const playing = () => !state.paused && !state.over && !ended;

function frame(t) {
  if (!playing()) {
    running = false;
    return;
  }
  acc += Math.min(0.25, (t - last) / 1000); // 切回分頁或卡頓時不一次追太多步
  last = t;
  if (inputDir() !== 0 && t - lastInputAt >= HOLD_INPUT_MS) noteInput(t);
  while (acc >= DT && playing()) {
    acc -= DT;
    state = stepState(state, { dir: inputDir() });
    if (state.over) {
      finish(resultOnGameOver({ everWon: false }));
    } else if (state.ticks % SAVE_EVERY === 0) {
      persist();
    }
  }
  render();
  requestAnimationFrame(frame);
}

// 只在「進行中且未結算」時跑迴圈;暫停後下一張 frame 自行停下。
function syncLoop() {
  if (!playing() || running) return;
  running = true;
  last = performance.now();
  acc = 0;
  requestAnimationFrame(frame);
}

// ---- 繪圖 ----

const canvas = $('field');
const ctx = canvas.getContext('2d');
let colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['bg', 'wall', 'normal', 'spike', 'bounce', 'flip', 'player', 'eye', 'text']) {
    colors[k] = cs.getPropertyValue(`--st-${k}`).trim();
  }
}

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

const THICK = 0.3; // 平台厚度(只影響畫面)

function spikesRow(c, x0, x1, base, tip, n) {
  const step = (x1 - x0) / n;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    c.moveTo(x0 + i * step, base);
    c.lineTo(x0 + (i + 0.5) * step, tip);
    c.lineTo(x0 + (i + 1) * step, base);
  }
  c.closePath();
  c.fill();
}

function draw() {
  if (!state) return;
  const s = canvas.width / W;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  for (const p of state.platforms) {
    ctx.globalAlpha = p.flip === null ? 1 : Math.max(0.2, 1 - p.flip / FLIP_DELAY);
    if (p.kind === 'spike') {
      ctx.fillStyle = colors.spike;
      ctx.fillRect(p.x, p.y, p.w, THICK);
      spikesRow(ctx, p.x, p.x + p.w, p.y, p.y - 0.28, Math.round(p.w * 2.5));
    } else if (p.kind === 'bounce') {
      ctx.strokeStyle = colors.bounce;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      for (let i = 0; i <= p.w * 4; i++) ctx.lineTo(p.x + i / 4, p.y + (i % 2 ? THICK : 0.06));
      ctx.stroke();
      ctx.fillStyle = colors.bounce;
      ctx.fillRect(p.x, p.y, p.w, 0.1);
    } else if (p.kind === 'flip') {
      ctx.fillStyle = colors.flip;
      const shake = p.flip === null ? 0 : Math.sin(p.flip * 60) * 0.05;
      for (let x = 0; x < p.w; x += 0.5) ctx.fillRect(p.x + x + shake, p.y, 0.4, THICK);
    } else {
      ctx.fillStyle = colors.normal;
      ctx.fillRect(p.x, p.y, p.w, THICK);
    }
  }
  ctx.globalAlpha = 1;

  // 頂端的刺
  ctx.fillStyle = colors.spike;
  ctx.fillRect(0, 0, W, 0.12);
  spikesRow(ctx, 0, W, 0.1, CEIL, 18);

  // 玩家:受傷時閃爍
  const { x, y } = state.player;
  const blink = state.hurt > 0 && Math.floor(state.hurt * 10) % 2 === 0;
  ctx.fillStyle = blink ? colors.spike : colors.player;
  ctx.fillRect(x, y, PLAYER, PLAYER);
  ctx.fillStyle = colors.eye;
  ctx.fillRect(x + 0.18, y + 0.22, 0.14, 0.18);
  ctx.fillRect(x + PLAYER - 0.32, y + 0.22, 0.14, 0.18);

  // 生命
  ctx.font = '0.55px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.spike;
  ctx.fillText('♥'.repeat(state.lives), 0.25, CEIL + 0.15);
  ctx.fillStyle = colors.wall;
  ctx.fillText('♥'.repeat(MAX_LIVES - state.lives), 0.25 + state.lives * 0.48, CEIL + 0.15);
}

// ---- 畫面 ----

let shown = { score: -1, best: -1, lives: -1 };
function render() {
  const score = state.floors;
  const b = Math.max(best, score);
  if (shown.score !== score) $('score').textContent = score.toLocaleString();
  if (shown.best !== b) $('best').textContent = b.toLocaleString();
  if (shown.lives !== state.lives) $('status').textContent = `生命 ${state.lives}/${MAX_LIVES}`;
  shown = { score, best: b, lives: state.lives };
  $('difficulty').value = state.difficulty;
  const pauseBtn = $('pause');
  const label = state.paused ? (state.ticks === 0 ? '開始' : '繼續') : '暫停';
  pauseBtn.textContent = state.paused ? '▶' : '⏸';
  pauseBtn.setAttribute('aria-label', label);
  pauseBtn.title = `${label}(P)`;
  pauseBtn.disabled = !!ended || state.over;
  draw();
  renderOverlay();
  syncLoop();
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
  const lines = [`<p>下了 ${ended.score.toLocaleString()} 層</p>`, `<p class="overlay-xp">本局 +${ended.xp} XP</p>`];
  if (ended.newAchievements.length) lines.push(`<p>新成就:${ended.newAchievements.map(achName).join('、')}</p>`);
  lines.push(ended.isBest
    ? '<p>🎉 新的最佳紀錄!</p>'
    : `<p>距最佳 ${ended.bestBefore.toLocaleString()} 層還差 ${(ended.bestBefore - ended.score).toLocaleString()}</p>`);
  return lines.join('');
}

let shownKind = null;
function renderOverlay() {
  const overlay = $('overlay');
  const kind = overlayFor(state);
  const sig = `${kind}|${ended ? (ended.pending ? 'p' : 'd') : ''}`;
  if (sig === shownKind) return; // 進行中不重繪遮罩
  shownKind = sig;
  const actions = $('overlay-actions');
  let info = '';
  if (kind === 'ready') {
    $('overlay-title').textContent = '準備開始';
    info = '<p>按 ← →,或按住場地左半邊/右半邊開始</p>';
    actions.innerHTML = '<button class="btn" data-act="resume">▶ 開始</button>';
  } else if (kind === 'paused') {
    $('overlay-title').textContent = '已暫停';
    info = '<p>按 P、← →,或按住場地左右半邊接著玩</p>';
    actions.innerHTML = '<button class="btn" data-act="resume">▶ 繼續</button>';
  } else if (kind === 'over') {
    $('overlay-title').textContent = '遊戲結束';
    actions.innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
  } else {
    overlay.hidden = true;
    return;
  }
  $('overlay-info').innerHTML = kind === 'over' ? infoHtml() : info;
  overlay.hidden = false;
}

// ---- 事件 ----

const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', a: 'left', d: 'right' };

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
window.addEventListener('blur', () => { keys.left = false; keys.right = false; touches.clear(); });

// 觸控:按住場地左半邊/右半邊移動,放開停止;暫停中按下就繼續。遮罩上的按鈕照常點。
const stage = $('stage');
const sideOf = (e) => {
  const r = stage.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? -1 : 1;
};
stage.addEventListener('pointerdown', (e) => {
  if (ended || state.over || e.target.closest('button')) return;
  e.preventDefault();
  stage.setPointerCapture?.(e.pointerId);
  touches.delete(e.pointerId);
  touches.set(e.pointerId, sideOf(e));
  noteInput();
  if (state.paused) resume();
});
stage.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  const side = sideOf(e);
  if (side === touches.get(e.pointerId)) return;
  touches.set(e.pointerId, side);
  noteInput(); // 拖移換邊 = 一次新輸入
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
$('pause').addEventListener('click', () => {
  profile.input();
  togglePause();
});
$('difficulty').addEventListener('change', (e) => {
  const d = e.target.value;
  if (ended?.pending) {
    e.target.value = state.difficulty;
    return;
  }
  save(DIFF_KEY, d);
  newGame(d);
});
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (act === 'new') newGame();
  if (act === 'resume') {
    profile.input();
    resume();
  }
});

bindThemeToggle($('theme'));
$('theme').addEventListener('click', () => { readColors(); draw(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
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

const demoPlatform = (n, y, kind = 'normal', x = 2.5, w = 4) => ({ n, x, y, w, kind, flip: null });
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

const COLOR_VAR = { normal: 'var(--st-normal)', spike: 'var(--st-spike)', bounce: 'var(--st-bounce)', flip: 'var(--st-flip)' };
function demoSvg(s) {
  const plats = s.platforms.filter((p) => p.y < H).map((p) => {
    const spikes = p.kind === 'spike'
      ? `<path d="${Array.from({ length: p.w * 2 }, (_, i) => `M${p.x + i / 2} ${p.y}l0.25 -0.3l0.25 0.3z`).join('')}" fill="${COLOR_VAR.spike}"/>`
      : '';
    return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${THICK}" fill="${COLOR_VAR[p.kind]}"${p.kind === 'flip' ? ' stroke-dasharray="0.4 0.1" opacity="0.8"' : ''}/>${spikes}`;
  }).join('');
  const ceil = `<path d="${Array.from({ length: 18 }, (_, i) => `M${i / 2} 0.1l0.25 ${CEIL - 0.1}l0.25 ${-(CEIL - 0.1)}z`).join('')}" fill="var(--st-spike)"/>`;
  const { x, y } = s.player;
  const hurt = s.hurt > 0 ? 'var(--st-spike)' : 'var(--st-player)';
  const player = s.player.y <= H ? `<rect x="${x}" y="${y}" width="${PLAYER}" height="${PLAYER}" fill="${hurt}"/>` : '';
  const hud = `<text x="0.3" y="1.5" font-size="0.7" fill="var(--st-spike)">${'♥'.repeat(s.lives)}</text>`
    + `<text x="8.7" y="1.5" font-size="0.7" text-anchor="end" fill="var(--st-text)">${s.over ? '結束' : `${s.floors} 層`}</text>`;
  return `<svg class="demo-field" viewBox="0 0 ${W} ${H}" role="img" aria-label="示範場面">${plats}${ceil}${player}${hud}</svg>`;
}

const landOn = (s) => stepUntil(s, (x) => x.player.on !== null);
const demoStep = (before, act, caption, result) => ({ before, after: act(before), caption, result });
setupHelp({
  gameId: GAME_ID,
  title: '下樓梯玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>平台不斷往上捲;用 ← → / A D,或按住畫面左半邊/右半邊移動。</li>
      <li>刺平台扣 1 命;彈跳平台會把你彈起;翻轉平台踩上 0.5 秒後消失。</li>
      <li>被推到頂端的刺扣 1 命並往下掉;掉出畫面底部直接結束。</li>
      <li>生命 3 格,每下 10 層站上普通平台回 1 命。</li>
      <li>P 或 ⏸ 暫停;難度越高捲得越快、刺越多,XP 越多。</li>
      <li>沒有勝利,撐到結束為止;分數 = 下了幾層,最佳 = 單局最多層。</li>
    </ol>`,
  demo: {
    render: demoSvg,
    steps: [
      demoStep(demoState({ x: 4, y: 3 }, [demoPlatform(1, 7), ...below(1)]), landOn,
        '往下掉到普通平台…', '…站穩了:層數 +1'),
      demoStep(demoState({ x: 4, y: 3 }, [demoPlatform(1, 7, 'bounce'), ...below(1)]), (s) => steps(stepUntil(s, (x) => x.player.vy < 0), 12),
        '落到彈跳平台…', '…被彈起來,再落回平台'),
      demoStep(demoState({ x: 4, y: 3 }, [demoPlatform(1, 7, 'spike'), ...below(1)]), landOn,
        '落到刺平台…', '…扣 1 命(左上愛心少一顆)'),
      demoStep(demoState({ x: 4, y: 1.2, on: 1 }, [demoPlatform(1, 1.2 + PLAYER), demoPlatform(2, 7, 'normal', 2.5, 4), ...below(2)]),
        (s) => steps(stepUntil(s, (x) => x.lives < MAX_LIVES), 20),
        '平台把你推到頂端…', '…被頂刺扎到扣 1 命,往下掉'),
      demoStep(demoState({ x: 0.2, y: 9 }, [demoPlatform(1, 4, 'normal', 5, 3), demoPlatform(2, 6, 'normal', 5, 3), demoPlatform(3, 17, 'normal', 5, 3)]),
        (s) => stepUntil(s, (x) => x.over),
        '底下沒有平台…', '…掉出畫面底部,遊戲結束'),
    ],
  },
});
// 打開說明時先暫停,避免在背後掉下去。
document.querySelector('.topbar .btn').nextElementSibling.addEventListener('click', pause);
