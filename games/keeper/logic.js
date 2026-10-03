// 足球守門員規則層:純函式,不碰 DOM。時間一律以毫秒傳入,隨機數(rng)可注入。
// 規則正典:workbook/plans/keeper.md「規則(驗收依據)」。
//
// 座標(世界單位):x = 水平,球門中央為 0,往右為正;y = 離地高度,地面為 0,往上為正。
// 守門員站在門線上,x 範圍 ±X_LIMIT;球的目標點在球門框內。

export const DIFFICULTIES = ['normal', 'hard', 'expert'];
// 難度參數(沿用原版):等待最短/最長、飛行時間(ms)、水平容許值。
export const PARAMS = {
  normal: { waitMin: 1400, waitMax: 3500, flight: 1700, tolerance: 43 },
  hard: { waitMin: 800, waitMax: 3000, flight: 1250, tolerance: 35 },
  expert: { waitMin: 400, waitMax: 1600, flight: 850, tolerance: 28 },
};

export const SHOTS_MIN = 1;
export const SHOTS_MAX = 10;
export const SHOTS_DEFAULT = 3;

export const MOVE_STEP = 22; // 左右移動每次位移
export const X_LIMIT = 118; // 守門員中心 x 範圍 ±118
export const JUMP_PEAK = 70; // 跳起峰高
export const DIVE_SHIFT = 52; // 撲救水平位移
export const DIVE_PEAK = 52; // 撲救峰高
export const HEIGHT_TOL = 48; // 高度容許值

// 以下為規格未寫、本實作自訂的數值(列於 PR「待 PM 裁」)。
export const REACH_BASE = 40; // 守門員站立時的可及高度(手的高度);跳起/撲起時加上當下離地高度
export const GOAL_HALF_W = 150; // 球門半寬(門柱在 ±150)
export const GOAL_H = 140; // 球門高
export const TARGET_X_MAX = 135; // 射門目標 x ∈ [-135, 135]
export const TARGET_Y_MIN = 10; // 射門目標 y ∈ [10, 125]
export const TARGET_Y_MAX = 125;
export const ACTION_MS = 600; // 跳起 / 撲救動作全長
export const RUNUP_MS = 500; // 射手助跑到起腳
export const RESULT_MS = 1300; // 每球結果顯示時間
export const SAVE_SCORE = 100;
export const STREAK_SCORE = 50;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 固定種子的 rng(mulberry32):測試與示範用,同一種子產生同一序列。
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const paramsFor = (difficulty) => PARAMS[difficulty] ?? PARAMS.normal;

// ---- 射門 ----

// 每球開始前的隨機等待時間(含兩端)。
export function waitMs(difficulty, rng = Math.random) {
  const { waitMin, waitMax } = paramsFor(difficulty);
  return waitMin + Math.floor(rng() * (waitMax - waitMin + 1));
}

// 球門內隨機目標點(x、y 皆隨機)。
export function shotTarget(rng = Math.random) {
  const x = Math.round(-TARGET_X_MAX + rng() * 2 * TARGET_X_MAX);
  const y = Math.round(TARGET_Y_MIN + rng() * (TARGET_Y_MAX - TARGET_Y_MIN));
  return { x, y };
}

// 一球 = 等待時間 + 目標點(先抽等待、再抽 x、y)。
export function newShot(difficulty, rng = Math.random) {
  const wait = waitMs(difficulty, rng);
  return { wait, target: shotTarget(rng) };
}

// 連續 n 球的射門序列(固定種子下可重現)。
export function shotSequence(difficulty, n, rng = Math.random) {
  return Array.from({ length: n }, () => newShot(difficulty, rng));
}

// ---- 守門員 ----
// keeper = { x, action: null | 'jump' | 'diveL' | 'diveR', at(動作已進行 ms), from(動作開始時 x) }

export const idleKeeper = (x = 0) => ({ x, action: null, at: 0, from: x });

const diveTo = (from, action) => clamp(from + (action === 'diveL' ? -DIVE_SHIFT : DIVE_SHIFT), -X_LIMIT, X_LIMIT);

// 守門員當下姿勢:中心 x 與離地高度 h。
export function keeperPose(k) {
  if (!k.action) return { x: k.x, h: 0 };
  const p = clamp(k.at / ACTION_MS, 0, 1);
  const arc = Math.sin(Math.PI * p);
  if (k.action === 'jump') return { x: k.x, h: JUMP_PEAK * arc };
  // 撲救:前半段完成水平位移,高度整段走弧線。
  const to = diveTo(k.from, k.action);
  return { x: k.from + (to - k.from) * Math.min(1, p * 2), h: DIVE_PEAK * arc };
}

// 可及高度 = 站立手高 + 當下離地高度。
export const reachHeight = (h) => REACH_BASE + h;

// 動作進行 dt 毫秒;做完回到站立(撲救停在撲到的位置)。
export function advanceKeeper(k, dt) {
  if (!k.action) return k;
  const at = k.at + dt;
  if (at < ACTION_MS) return { ...k, at };
  const x = k.action === 'jump' ? k.x : diveTo(k.from, k.action);
  return idleKeeper(x);
}

// 輸入動作:'left' / 'right' 移動、'jump' 跳、'diveL' / 'diveR' 撲。動作進行中不接受新輸入 ⇒ 原物件。
export function keeperAct(k, act) {
  if (k.action) return k;
  if (act === 'left' || act === 'right') {
    const x = clamp(k.x + (act === 'left' ? -MOVE_STEP : MOVE_STEP), -X_LIMIT, X_LIMIT);
    return x === k.x ? k : idleKeeper(x);
  }
  if (act === 'jump' || act === 'diveL' || act === 'diveR') return { x: k.x, action: act, at: 0, from: k.x };
  return k;
}

// ---- 撲救判定(球抵達門線瞬間)----

// |守門員中心x − 目標x| ≤ 容許值 且 |守門員可及高度 − 目標y| ≤ 48 ⇒ 撲到。
export function isSave({ keeperX, reach, target, tolerance }) {
  return Math.abs(keeperX - target.x) <= tolerance && Math.abs(reach - target.y) <= HEIGHT_TOL;
}

export function judgeShot(keeper, target, difficulty) {
  const { x, h } = keeperPose(keeper);
  return isSave({ keeperX: x, reach: reachHeight(h), target, tolerance: paramsFor(difficulty).tolerance });
}

// ---- 計分與結算 ----

export const winThreshold = (n) => Math.ceil(n / 2);
export const scoreFor = (saves, bestStreak) => saves * SAVE_SCORE + bestStreak * STREAK_SCORE;
export const resultFor = ({ saves, total }) => (saves >= winThreshold(total) ? 'win' : 'lose');

// 依每球結果('save' / 'goal')算出統計。
export function tally(log) {
  let saves = 0;
  let streak = 0;
  let bestStreak = 0;
  for (const r of log) {
    if (r === 'save') {
      saves++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
    } else streak = 0;
  }
  return { saves, conceded: log.length - saves, streak, bestStreak, score: scoreFor(saves, bestStreak) };
}

export const normalizeShots = (n) => (Number.isInteger(n) ? clamp(n, SHOTS_MIN, SHOTS_MAX) : SHOTS_DEFAULT);

// ---- 狀態轉移(純函式,UI 只呼叫)----
// state = { difficulty, total, log, phase, t, shot, keeper, paused, actions }
//   total   本回合球數 N
//   log     已踢完每球的結果('save' / 'goal');log.length = 已踢球數
//   phase   'ready'(開局或續玩還原,等開始) / 'wait' / 'runup' / 'flight' / 'result' / 'over'
//   t       本階段已經過 ms
//   shot    本球 { wait, target };ready 時為 null
//   paused  球進行中暫停
//   actions 本回合守門員有效動作數(§4.2 判斷「新遊戲」要不要記錄)

export function initState({ difficulty = 'normal', total = SHOTS_DEFAULT } = {}) {
  return {
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    total: normalizeShots(total),
    log: [],
    phase: 'ready',
    t: 0,
    shot: null,
    keeper: idleKeeper(),
    paused: false,
    actions: 0,
  };
}

// ready ⇒ 開始下一球(守門員回中央)。其他階段 ⇒ 原 state。
export function startShot(state, rng = Math.random) {
  if (state.phase !== 'ready') return state;
  return { ...state, phase: 'wait', t: 0, shot: newShot(state.difficulty, rng), keeper: idleKeeper(), paused: false };
}

const PLAYING = ['wait', 'runup', 'flight'];
export const isPlaying = (state) => PLAYING.includes(state.phase) && !state.paused;

export function actState(state, act) {
  if (!isPlaying(state)) return state;
  const keeper = keeperAct(state.keeper, act);
  if (keeper === state.keeper) return state;
  return { ...state, keeper, actions: state.actions + 1 };
}

// 球進行中與結果顯示中都可暫停(ready、over 不用暫停)。
export const canPause = (state) => [...PLAYING, 'result'].includes(state.phase) && !state.paused;

export function pauseState(state) {
  if (!canPause(state)) return state;
  return { ...state, paused: true };
}

export function resumeState(state) {
  if (!state.paused) return state;
  return { ...state, paused: false };
}

const phaseLength = (state) => {
  if (state.phase === 'wait') return state.shot.wait;
  if (state.phase === 'runup') return RUNUP_MS;
  if (state.phase === 'flight') return paramsFor(state.difficulty).flight;
  if (state.phase === 'result') return RESULT_MS;
  return Infinity;
};

// 時間前進 dt 毫秒;跨越階段邊界時逐段處理,判定一律在球抵達門線的那一刻。
// 每球結果顯示完自動開下一球(rng 抽下一球);最後一球判定後直接進 'over'(結果照樣顯示)。
// ready / over / 暫停 ⇒ 原 state。
export function stepState(state, dt, rng = Math.random) {
  if (state.paused || !['wait', 'runup', 'flight', 'result'].includes(state.phase)) return state;
  let s = state;
  let left = dt;
  while (left > 0 && ['wait', 'runup', 'flight', 'result'].includes(s.phase)) {
    const step = Math.min(left, phaseLength(s) - s.t);
    s = { ...s, t: s.t + step, keeper: s.phase === 'result' ? s.keeper : advanceKeeper(s.keeper, step) };
    left -= step;
    if (s.t < phaseLength(s)) break;
    if (s.phase === 'wait') s = { ...s, phase: 'runup', t: 0 };
    else if (s.phase === 'runup') s = { ...s, phase: 'flight', t: 0 };
    else if (s.phase === 'flight') {
      const log = [...s.log, judgeShot(s.keeper, s.shot.target, s.difficulty) ? 'save' : 'goal'];
      s = { ...s, log, phase: log.length >= s.total ? 'over' : 'result', t: 0 };
    } else s = startShot({ ...s, phase: 'ready', t: 0, shot: null }, rng);
  }
  return s;
}

// 最近一球結果;沒有 ⇒ null。
export const lastResult = (state) => state.log.at(-1) ?? null;

// 「新遊戲」時有沒有玩過(§4.2):只算玩家的有效操作(移動/跳/撲);自動踢完的球、開始鍵都不算。
export const movesOf = (state) => state.actions;

// 結算資料(finishPlay 用)。
export function finishInfo(state) {
  const t = tally(state.log);
  return {
    result: resultFor({ saves: t.saves, total: state.total }),
    score: t.score,
    difficulty: state.difficulty,
    detail: { shots: state.log.length, saves: t.saves, streak: t.bestStreak },
  };
}

// ---- 手機手勢 ----
// 放開手指時分類:dx、dy = 位移(px,往下為正)、ms = 持續時間、upper = 起點在畫面上半。
//   點(位移 < 12):上半 ⇒ 跳;下半 ⇒ 無
//   快速(≤ 350ms)往左上/右上滑 ⇒ 撲
//   其他滑動(含較慢的斜滑)依主方向:水平為主 ⇒ 移動,每 35px 一步(至少 1、至多 6 步);往上為主 ⇒ 跳;往下為主 ⇒ 無
export const TAP_PX = 12;
export const SWIPE_PX = 24;
export const FLICK_MS = 350;
export const STEP_PX = 35;

export function classifyGesture({ dx, dy, ms, upper }) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < TAP_PX) return upper ? { act: 'jump' } : null;
  if (dy <= -SWIPE_PX && ax >= SWIPE_PX && ay >= ax * 0.4 && ms <= FLICK_MS) return { act: dx < 0 ? 'diveL' : 'diveR' };
  if (ax >= ay) return ax >= SWIPE_PX ? { act: dx < 0 ? 'left' : 'right', steps: clamp(Math.round(ax / STEP_PX), 1, 6) } : null;
  return dy <= -SWIPE_PX ? { act: 'jump' } : null;
}

// ---- 存檔(續玩,存檔點 = 球與球之間)----

// actions 一併保存:續玩後按「新遊戲」仍依玩家操作判斷 quit(§4.2)。
export function toSave({ difficulty, total, log, actions }) {
  return { difficulty, total, log: [...log], actions };
}

// 還原到「下一球開始前」。
export function fromSave(saved) {
  return { ...initState({ difficulty: saved.difficulty, total: saved.total }), log: [...saved.log], actions: saved.actions };
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
// 已踢完全部球數的存檔不合格(那一局應已結算)。
export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const { difficulty, total, log, actions } = s;
  if (!DIFFICULTIES.includes(difficulty)) return false;
  if (!Number.isInteger(total) || total < SHOTS_MIN || total > SHOTS_MAX) return false;
  if (!Array.isArray(log) || log.length >= total) return false;
  if (!Number.isInteger(actions) || actions < 0) return false;
  return log.every((r) => r === 'save' || r === 'goal');
}
