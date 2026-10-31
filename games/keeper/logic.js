// 足球守門員規則層:純函式,不碰 DOM。時間一律以毫秒傳入,隨機數(rng)可注入。
// 規則正典:workbook/plans/keeper.md「規則(驗收依據)」;操作以 workbook/plans/rs12-keeper.md 為準(RS12 取代原操作段)。
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

// 踢球員未定參數集中在此，供手感驗收調整。
export const ROLES = ['keeper', 'kicker'];
export const KICKER_SHOTS = 5;
export const KICKER_WIN_GOALS = 3;
export const POWER_HALF_MS = 900;
export const AIM_STEP = 8;
export const COMPUTER_MIN_REACH = 12;
export const AIM_DEFAULT = { x: 0, y: 70 };
export const CURVES = ['straight', 'left', 'right', 'lob'];
export const CURVE_NAMES = { straight: '直球', left: '左弧', right: '右弧', lob: '高吊' };
export const KICK_PARAMS = { flight: 1600, speedGain: 700, weak: 0.3, weakHeight: 12, strong: 0.8,
  overshoot: 300, bend: 55, curveDrift: 24, lift: 30, lobLift: 95, lobRise: 18, cornerMax: 50 };
export const COMPUTER_PARAMS = {
  normal: { reaction: 480, speed: 105, heightSpeed: 90, tolerance: 25, heightTolerance: 28, error: 20 },
  hard: { reaction: 320, speed: 150, heightSpeed: 125, tolerance: 33, heightTolerance: 36, error: 12 },
  expert: { reaction: 180, speed: 210, heightSpeed: 170, tolerance: 42, heightTolerance: 44, error: 5 },
};
export const roleOf = (value) => value?.role ?? value?.detail?.role ?? 'keeper'; // 舊局面／紀錄缺 role = 守門員
export const powerAt = (elapsed) => {
  const p = Math.max(0, elapsed) / POWER_HALF_MS % 2;
  return p <= 1 ? p : 2 - p;
};

export const MOVE_STEP = 22; // 一步位移(滑動手勢未達即時拖曳時的備援)
export const MOVE_SPEED = 180; // 連續移動:按住方向每秒移動的單位(RS12)
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
export const ACTION_MS = 480; // 跳起 / 撲救動作全長(RS12:原 600)
export const RUNUP_MS = 500; // 射手助跑到起腳
export const RESULT_MS = 1300; // 每球結果顯示時間
export const SAVE_SCORE = 100;
export const STREAK_SCORE = 50;

// 天氣未定數值集中於此:風為側向加速度(單位/s²)、雨天加速度(單位/s²)。
export const WEATHERS = ['sun', 'rain', 'snow', 'night', 'wind'];
export const WEATHER_CHOICES = ['random', ...WEATHERS];
export const WEATHER_PARAMS = {
  sun: { name: '晴', description: '球路與移動維持平常節奏。', ballSpeed: 1, keeperSpeed: 1, acceleration: Infinity, retention: 0.65, bonus: 1 },
  rain: { name: '雨', description: '低球彈地後滑得更快，起步與停下會滑行。', kickerDescription: '低球彈地後保留更多速度，更快抵達門線。', ballSpeed: 1, keeperSpeed: 1, acceleration: 450, retention: 0.9, bonus: 1.2 },
  snow: { name: '雪', description: '球速與守門員最高移動速度都降低 15%。', ballSpeed: 0.85, keeperSpeed: 0.85, acceleration: Infinity, retention: 0.65, bonus: 1.2 },
  night: { name: '夜', description: '暗場燈光下守門，球路與移動維持平常節奏。', kickerDescription: '暗場燈光下射門，足球帶微光，球路維持平常節奏。', ballSpeed: 1, keeperSpeed: 1, acceleration: Infinity, retention: 0.65, bonus: 1.3 },
  wind: { name: '風', description: '側風把球吹成弧線，本回合風向與風力固定。', ballSpeed: 1, keeperSpeed: 1, acceleration: Infinity, retention: 0.65, bonus: 1.3 },
};
export const WIND_MIN = 20;
export const WIND_MAX = 45;
// RS40:風力手感加強。側向加速度 = 風力 × WIND_GAIN(RS20 原為 ×1);守門員模式的小朋友起腳先往逆風側瞄 WIND_AIM 倍的
// 整段風偏,球路先偏逆風、再被吹回來形成明顯弧線,落點仍多半在門框內。踢球員模式由玩家自己決定要不要逆風瞄準。
export const WIND_GAIN = 2.6;
export const WIND_AIM = 0.2;
export const WIND_LEVELS = 5;
// 畫面與提示顯示的風力等級 1~5(風力 20 → 1 級、45 → 5 級)。
export const windLevel = (strength) => clamp(1 + Math.round((strength - WIND_MIN) * (WIND_LEVELS - 1) / (WIND_MAX - WIND_MIN)), 1, WIND_LEVELS);
// 飛行 seconds 秒時,風造成的側向位移(世界單位);非風天氣為 0。
export const windDrift = (weather, wind, seconds) => weather === 'wind' && wind
  ? wind.direction * wind.strength * WIND_GAIN * seconds ** 2 / 2 : 0;
export const LOW_BALL_Y = 40;
export const BOUNCE_AT = 0.65;
export const BOUNCE_HEIGHT = 12;
export const BALL_LIFT = 30;
export const DRAG_RESPONSE = 8;
export const weatherFor = (weather) => WEATHER_PARAMS[weather] ?? WEATHER_PARAMS.sun;
export function roundWeather(choice = 'random', rng = Math.random) {
  const weather = choice === 'random' ? WEATHERS[Math.min(WEATHERS.length - 1, Math.floor(rng() * WEATHERS.length))]
    : WEATHERS.includes(choice) ? choice : 'sun';
  const wind = weather === 'wind' ? { direction: rng() < 0.5 ? -1 : 1, strength: WIND_MIN + Math.floor(rng() * (WIND_MAX - WIND_MIN + 1)) }
    : { direction: 0, strength: 0 };
  return { weather, wind };
}

const retainedSpeed = (weather, target) => target?.y <= LOW_BALL_Y ? weatherFor(weather).retention / WEATHER_PARAMS.sun.retention : 1;
export function flightMs(difficulty, weather = 'sun', target) {
  const base = paramsFor(difficulty).flight / weatherFor(weather).ballSpeed;
  return base * (BOUNCE_AT + (1 - BOUNCE_AT) / retainedSpeed(weather, target));
}

// 同一條球路供飛行繪製、影子與門線判定使用。progress 表示往門線的距離。
export function ballMotion(target, elapsed, difficulty = 'normal', weather = 'sun', wind = { direction: 0, strength: 0 }) {
  const base = paramsFor(difficulty).flight / weatherFor(weather).ballSpeed;
  const seconds = clamp(elapsed, 0, flightMs(difficulty, weather, target)) / 1000;
  const q = clamp(elapsed / base, 0, 1);
  const progress = clamp(q <= BOUNCE_AT ? q : BOUNCE_AT + (q - BOUNCE_AT) * retainedSpeed(weather, target), 0, 1);
  const x = clamp(keeperWindX(target, seconds, flightMs(difficulty, weather, target) / 1000, progress, weather, wind),
    -TARGET_X_MAX, TARGET_X_MAX);
  let y = target.y * progress + Math.sin(Math.PI * progress) * BALL_LIFT;
  if (target.y <= LOW_BALL_Y && weather === 'rain') {
    if (progress <= BOUNCE_AT) y *= 1 - progress / BOUNCE_AT;
    else {
      const bounce = (progress - BOUNCE_AT) / (1 - BOUNCE_AT);
      y = target.y * bounce + Math.sin(Math.PI * bounce) * BOUNCE_HEIGHT;
    }
  }
  return { x, y: progress >= 1 - 1e-12 ? target.y : y, progress: progress >= 1 - 1e-12 ? 1 : progress };
}
// 守門員模式球的水平位置(未限制在門框內):起腳瞄點逆風修正 WIND_AIM 倍整段風偏,再加上當下風偏。
function keeperWindX(target, seconds, total, progress, weather, wind) {
  const aim = target.x - WIND_AIM * windDrift(weather, wind, total);
  return aim * progress + windDrift(weather, wind, seconds);
}
// 球抵達門線時的水平位置(未限制在門框內);進框率統計用。
export const windLandingX = (target, difficulty = 'normal', weather = 'sun', wind = { direction: 0, strength: 0 }) => {
  const total = flightMs(difficulty, weather, target) / 1000;
  return keeperWindX(target, total, total, 1, weather, wind);
};
export const impactTarget = (state) => {
  const { x, y } = ballMotion(state.shot.target, flightMs(state.difficulty, state.weather, state.shot.target), state.difficulty, state.weather, state.wind);
  return { x, y };
};

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
  if (k.ai) return { x: k.x, h: k.h };
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

// 撲救範圍(世界座標):水平 守門員中心 ± 容許值、高度 可及高度 ± 48。判定與畫面上的手套都用這一份(RS12)。
export function saveZone(keeper, difficulty) {
  const { x, h } = keeperPose(keeper);
  const tol = paramsFor(difficulty).tolerance;
  const reach = reachHeight(h);
  return { x0: x - tol, x1: x + tol, y0: reach - HEIGHT_TOL, y1: reach + HEIGHT_TOL, x, reach };
}

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
  const z = saveZone(keeper, difficulty);
  return target.x >= z.x0 && target.x <= z.x1 && target.y >= z.y0 && target.y <= z.y1;
}

// ---- 計分與結算 ----

export const winThreshold = (n) => Math.ceil(n / 2);
export const scoreFor = (saves, bestStreak, weather = 'sun') => Math.round((saves * SAVE_SCORE + bestStreak * STREAK_SCORE) * weatherFor(weather).bonus);
export const resultFor = ({ saves, total }) => (saves >= winThreshold(total) ? 'win' : 'lose');

// 依每球結果('save' / 'goal')算出統計。
export function tally(log, weather = 'sun') {
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
  return { saves, conceded: log.length - saves, streak, bestStreak, score: scoreFor(saves, bestStreak, weather) };
}

export const normalizeShots = (n) => (Number.isInteger(n) ? clamp(n, SHOTS_MIN, SHOTS_MAX) : SHOTS_DEFAULT);

// ---- 狀態轉移(純函式,UI 只呼叫)----
// state = { difficulty, total, weather, weatherChoice, wind, log, phase, t, shot, keeper, move, velocity, dragTarget, paused, actions }
//   weather 實際天氣;weatherChoice 選單偏好(random 或固定天氣);wind 本回合固定的方向與力道
//   velocity 雨天滑行速度;dragTarget 雨雪拖曳目標(均不存檔)
//   total   本回合球數 N
//   log     已踢完每球的結果('save' / 'goal');log.length = 已踢球數
//   phase   'ready'(開局或續玩還原,等開始) / 'wait' / 'runup' / 'flight' / 'result' / 'over'
//   t       本階段已經過 ms
//   shot    本球 { wait, target };ready 時為 null
//   move    按住的移動方向 -1 / 0 / 1(RS12 連續移動;不存檔)
//   moved   這次按住已經實際位移過(有效操作只在每次按住的首次位移計一次;不存檔)
//   paused  球進行中暫停
//   actions 本回合守門員有效動作數(§4.2 判斷「新遊戲」要不要記錄)

// 無天氣參數的舊呼叫維持晴天;選單預設 random,開局即抽出實際天氣。
export function initState({ difficulty = 'normal', total = SHOTS_DEFAULT, weather = 'sun', role = 'keeper' } = {}, rng = Math.random) {
  role = ROLES.includes(role) ? role : 'keeper';
  return {
    role,
    ...(role === 'kicker' ? { aim: { ...AIM_DEFAULT }, curve: 'straight', power: 0, bonuses: [] } : {}),
    ...roundWeather(weather, rng),
    weatherChoice: WEATHER_CHOICES.includes(weather) ? weather : 'sun',
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    total: role === 'kicker' ? KICKER_SHOTS : normalizeShots(total),
    log: [],
    phase: 'ready',
    t: 0,
    shot: null,
    keeper: idleKeeper(),
    move: 0,
    moved: false,
    velocity: 0,
    dragTarget: null,
    paused: false,
    actions: 0,
  };
}

// ready ⇒ 開始下一球(守門員回中央)。其他階段 ⇒ 原 state。
export function startShot(state, rng = Math.random) {
  if (state.phase !== 'ready') return state;
  if (roleOf(state) === 'kicker') return { ...state, phase: 'aim', t: 0, shot: null,
    power: 0, keeper: idleKeeper(), paused: false };
  return { ...state, phase: 'wait', t: 0, shot: newShot(state.difficulty, rng), keeper: idleKeeper(), velocity: 0, dragTarget: null, paused: false };
}

const PLAYING = ['wait', 'runup', 'flight', 'aim', 'charge'];
export const isPlaying = (state) => PLAYING.includes(state.phase) && !state.paused;

export function actState(state, act) {
  if (roleOf(state) === 'kicker') return state;
  if (!isPlaying(state)) return state;
  if (['rain', 'snow'].includes(state.weather) && (act === 'left' || act === 'right')) {
    return moveTo(state, state.keeper.x + (act === 'left' ? -MOVE_STEP : MOVE_STEP));
  }
  const keeper = keeperAct(state.keeper, act);
  if (keeper === state.keeper) return state;
  return { ...state, keeper, velocity: 0, dragTarget: null, actions: state.actions + 1 };
}

// 按住/放開方向(鍵盤 ← →、畫面 ◀ ▶):只記住方向,時間推進時才移動。
// 有效操作(§4.2)在每次按住期間「首次實際位移」時計一次(stepState 裡判斷);按住但沒動到(開始前、頂住邊界)不計。
export function setMove(state, dir) {
  if (roleOf(state) === 'kicker') return state;
  const move = Math.sign(dir || 0);
  if (move === (state.move ?? 0)) return state;
  return { ...state, move, moved: false, dragTarget: null };
}

// 拖曳:限 ±118;雨雪記目標由時間推進(受移速/加速度限制),其餘即時移到 x。
// 動作中(跳/撲)或球沒在進行 ⇒ 原 state。
export function moveTo(state, x) {
  if (roleOf(state) === 'kicker') return state;
  if (!isPlaying(state) || state.keeper.action) return state;
  const nx = clamp(x, -X_LIMIT, X_LIMIT);
  if (['rain', 'snow'].includes(state.weather)) {
    if (nx === state.dragTarget || (nx === state.keeper.x && !state.velocity)) return state;
    return { ...state, dragTarget: nx };
  }
  if (nx === state.keeper.x) return state;
  return { ...state, keeper: idleKeeper(nx), actions: state.actions + 1 };
}

export const releaseDrag = (state) => state.dragTarget === null ? state : { ...state, dragTarget: null, moved: false };

// 連續移動 dt 毫秒(動作中不動)。
function slide(keeper, move, dt) {
  if (!move || keeper.action || dt <= 0) return keeper;
  const x = clamp(keeper.x + (move * MOVE_SPEED * dt) / 1000, -X_LIMIT, X_LIMIT);
  return x === keeper.x ? keeper : idleKeeper(x);
}

// 動作推進 dt;動作在這段時間內做完的話,剩下的時間才照按住的方向移動。
function advanceAndSlide(keeper, move, dt) {
  if (!keeper.action) return slide(keeper, move, dt);
  const left = ACTION_MS - keeper.at;
  const next = advanceKeeper(keeper, dt);
  return next.action ? next : slide(next, move, dt - left);
}

// 一段時間的守門員推進;連續移動造成首次位移時計一次有效操作。
function keeperStep(s, dt) {
  if (['rain', 'snow'].includes(s.weather)) return weatherKeeperStep(s, dt);
  const before = s.keeper.action ? advanceKeeper(s.keeper, dt) : s.keeper;
  const keeper = advanceAndSlide(s.keeper, s.move ?? 0, dt);
  const slid = keeper.x !== before.x && !keeper.action;
  if (!slid || s.moved) return { ...s, keeper };
  return { ...s, keeper, moved: true, actions: s.actions + 1 };
}

function weatherKeeperStep(s, dt) {
  let keeper = advanceKeeper(s.keeper, dt);
  if (keeper.action) return { ...s, keeper, velocity: 0 };
  const ms = s.keeper.action ? Math.max(0, dt - (ACTION_MS - s.keeper.at)) : dt;
  const cfg = weatherFor(s.weather);
  const speed = MOVE_SPEED * cfg.keeperSpeed;
  // 拖曳也受最高速度/加速度限制,不會繞過天氣規則。
  const distance = s.dragTarget === null ? null : s.dragTarget - keeper.x;
  const desired = distance === null ? (s.move ?? 0) * speed : clamp(distance * DRAG_RESPONSE, -speed, speed);
  const old = s.keeper.action ? 0 : s.velocity;
  const seconds = ms / 1000;
  const velocity = Number.isFinite(cfg.acceleration)
    ? old + clamp(desired - old, -cfg.acceleration * seconds, cfg.acceleration * seconds) : desired;
  const ramp = Number.isFinite(cfg.acceleration) ? Math.min(seconds, Math.abs(desired - old) / cfg.acceleration) : 0;
  const dx = (old + velocity) * ramp / 2 + velocity * (seconds - ramp);
  let x = clamp(keeper.x + dx, -X_LIMIT, X_LIMIT);
  if (s.weather === 'snow' && distance !== null && Math.abs(dx) > Math.abs(distance)) x = s.dragTarget;
  const slid = x !== keeper.x;
  const active = s.move || distance !== null;
  const counted = slid && active && !s.moved;
  if (slid) keeper = idleKeeper(x);
  return { ...s, keeper, velocity: x === X_LIMIT || x === -X_LIMIT ? 0 : velocity,
    moved: s.moved || !!counted, actions: s.actions + (counted ? 1 : 0) };
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
  if (state.phase === 'flight') return flightMs(state.difficulty, state.weather, state.shot.target);
  if (state.phase === 'result') return RESULT_MS;
  return Infinity;
};

// 時間前進 dt 毫秒;跨越階段邊界時逐段處理,判定一律在球抵達門線的那一刻。
// 每球結果顯示完自動開下一球(rng 抽下一球);最後一球判定後直接進 'over'(結果照樣顯示)。
// ready / over / 暫停 ⇒ 原 state。
export function stepState(state, dt, rng = Math.random) {
  if (roleOf(state) === 'kicker') return stepKicker(state, dt);
  if (state.paused || !['wait', 'runup', 'flight', 'result'].includes(state.phase)) return state;
  let s = state;
  let left = dt;
  while (left > 0 && ['wait', 'runup', 'flight', 'result'].includes(s.phase)) {
    const step = Math.min(left, phaseLength(s) - s.t);
    s = { ...s, t: s.t + step };
    if (s.phase !== 'result') s = keeperStep(s, step);
    left -= step;
    if (s.t < phaseLength(s)) break;
    if (s.phase === 'wait') s = { ...s, phase: 'runup', t: 0 };
    else if (s.phase === 'runup') s = { ...s, phase: 'flight', t: 0 };
    else if (s.phase === 'flight') {
      const log = [...s.log, judgeShot(s.keeper, impactTarget(s), s.difficulty) ? 'save' : 'goal'];
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
  if (roleOf(state) === 'kicker') {
    const t = kickerTally(state);
    return { result: t.goals >= KICKER_WIN_GOALS ? 'win' : 'lose', score: t.score, difficulty: state.difficulty,
      detail: { role: 'kicker', goals: t.goals, shots: state.log.length, weather: state.weather } };
  }
  const t = tally(state.log, state.weather);
  return {
    result: resultFor({ saves: t.saves, total: state.total }),
    score: t.score,
    difficulty: state.difficulty,
    detail: { role: 'keeper', shots: state.log.length, saves: t.saves, streak: t.bestStreak, weather: state.weather },
  };
}

// ---- 踢球員：瞄準 → 按住蓄力 → 放開射門 → 電腦反應／判定 ----
const aiming = (s) => roleOf(s) === 'kicker' && s.phase === 'aim' && !s.paused;
export function aimAt(state, target) {
  if (!aiming(state) || !Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return state;
  const aim = { x: clamp(target.x, -GOAL_HALF_W, GOAL_HALF_W), y: clamp(target.y, 0, GOAL_H) };
  return aim.x === state.aim.x && aim.y === state.aim.y ? state : { ...state, aim, actions: state.actions + 1 };
}
export const nudgeAim = (s, dx, dy) => aimAt(s, { x: s.aim?.x + dx * AIM_STEP, y: s.aim?.y + dy * AIM_STEP });
export function chooseCurve(state, curve) {
  return aiming(state) && CURVES.includes(curve) && curve !== state.curve
    ? { ...state, curve, actions: state.actions + 1 } : state;
}
export const chargeShot = (state) => aiming(state)
  ? { ...state, phase: 'charge', t: 0, power: 0, actions: state.actions + 1 } : state;
export const cancelCharge = (state) => roleOf(state) === 'kicker' && state.phase === 'charge'
  ? { ...state, phase: 'aim', t: 0, power: 0 } : state;

export function kickTarget(shot) {
  const p = shot.power, cfg = KICK_PARAMS;
  const direction = shot.curve === 'left' ? -1 : shot.curve === 'right' ? 1 : 0;
  return { x: shot.target.x + direction * cfg.curveDrift,
    y: (p < cfg.weak ? Math.min(shot.target.y, cfg.weakHeight) * p / cfg.weak : shot.target.y)
      + Math.max(0, p - cfg.strong) * cfg.overshoot
      + (shot.curve === 'lob' && p >= cfg.weak ? cfg.lobRise : 0) };
}
export function kickFlightMs(shot, weather = 'sun') {
  const base = (KICK_PARAMS.flight - KICK_PARAMS.speedGain * shot.power) / weatherFor(weather).ballSpeed;
  return base * (BOUNCE_AT + (1 - BOUNCE_AT) / retainedSpeed(weather, kickTarget(shot)));
}
export function kickMotion(shot, elapsed, weather = 'sun', wind = { direction: 0, strength: 0 }) {
  const base = (KICK_PARAMS.flight - KICK_PARAMS.speedGain * shot.power) / weatherFor(weather).ballSpeed;
  const seconds = clamp(elapsed, 0, kickFlightMs(shot, weather)) / 1000;
  const q = clamp(elapsed / base, 0, 1), target = kickTarget(shot);
  const p = clamp(q <= BOUNCE_AT ? q : BOUNCE_AT + (q - BOUNCE_AT) * retainedSpeed(weather, target), 0, 1);
  const dir = shot.curve === 'left' ? -1 : shot.curve === 'right' ? 1 : 0;
  const x = target.x * p + dir * Math.sin(Math.PI * p) * KICK_PARAMS.bend + windDrift(weather, wind, seconds);
  let y = target.y * p + Math.sin(Math.PI * p) * (shot.curve === 'lob' ? KICK_PARAMS.lobLift : KICK_PARAMS.lift);
  if (shot.power < KICK_PARAMS.weak) y = target.y * p;
  if (target.y <= LOW_BALL_Y && weather === 'rain') {
    if (p <= BOUNCE_AT) y *= 1 - p / BOUNCE_AT;
    else { const b = (p - BOUNCE_AT) / (1 - BOUNCE_AT); y = target.y * b + Math.sin(Math.PI * b) * BOUNCE_HEIGHT; }
  }
  return { x, y: p >= 1 - 1e-12 ? target.y : y, progress: p >= 1 - 1e-12 ? 1 : p };
}
export const kickImpact = (state) => {
  const { x, y } = kickMotion(state.shot, kickFlightMs(state.shot, state.weather), state.weather, state.wind);
  return { x, y };
};

// 在反應時刻觀察當時球路並外推，非直接讀取最終落點。誤差每球只抽一次。
export function computerPrediction(state) {
  const cfg = COMPUTER_PARAMS[state.difficulty];
  const m = kickMotion(state.shot, cfg.reaction, state.weather, state.wind);
  const p = Math.max(m.progress, 0.001);
  const lift = state.shot.power < KICK_PARAMS.weak ? 0 : KICK_PARAMS.lift;
  return { x: m.x / p + state.shot.error.x,
    y: (m.y - Math.sin(Math.PI * m.progress) * lift) / p + state.shot.error.y };
}
export function computerKeeperAt(state, elapsed) {
  const cfg = COMPUTER_PARAMS[state.difficulty], prediction = computerPrediction(state);
  const seconds = Math.max(0, elapsed - cfg.reaction) / 1000;
  const x = clamp(prediction.x, -X_LIMIT, X_LIMIT);
  const h = clamp(prediction.y - REACH_BASE, COMPUTER_MIN_REACH - REACH_BASE, JUMP_PEAK);
  return { ...idleKeeper(clamp(x, -cfg.speed * weatherFor(state.weather).keeperSpeed * seconds,
    cfg.speed * weatherFor(state.weather).keeperSpeed * seconds)), ai: true,
    h: clamp(h, -cfg.heightSpeed * seconds, cfg.heightSpeed * seconds) || 0 };
}
export function computerSaveZone(state) {
  const cfg = COMPUTER_PARAMS[state.difficulty], { x, h } = keeperPose(state.keeper), reach = REACH_BASE + h;
  return { x, reach, x0: x - cfg.tolerance, x1: x + cfg.tolerance,
    y0: reach - cfg.heightTolerance, y1: reach + cfg.heightTolerance };
}
export function judgeKick(state) {
  const target = kickImpact(state);
  if (target.y > GOAL_H) return 'high';
  if (Math.abs(target.x) > GOAL_HALF_W || target.y < 0) return 'miss';
  const zone = computerSaveZone(state);
  return target.x >= zone.x0 && target.x <= zone.x1 && target.y >= zone.y0 && target.y <= zone.y1 ? 'save' : 'goal';
}
export function releaseShot(state, rng = Math.random) {
  if (roleOf(state) !== 'kicker' || state.phase !== 'charge' || state.paused) return state;
  const error = COMPUTER_PARAMS[state.difficulty].error;
  const shot = { target: { ...state.aim }, power: state.power, curve: state.curve,
    error: { x: (rng() * 2 - 1) * error, y: (rng() * 2 - 1) * error } };
  return { ...state, shot, phase: 'flight', t: 0, keeper: idleKeeper() };
}
export const cornerBonus = (target) => Math.round(KICK_PARAMS.cornerMax
  * clamp(Math.abs(target.x) / GOAL_HALF_W, 0, 1) * clamp(target.y / GOAL_H, 0, 1));
export function kickerTally(state) {
  const goals = state.log.filter((r) => r === 'goal').length;
  return { goals, saves: state.log.filter((r) => r === 'save').length,
    misses: state.log.filter((r) => r === 'miss' || r === 'high').length,
    score: Math.round((goals * SAVE_SCORE + state.bonuses.reduce((a, b) => a + b, 0)) * weatherFor(state.weather).bonus) };
}
function stepKicker(state, dt) {
  if (state.paused || !Number.isFinite(dt) || dt <= 0) return state;
  if (state.phase === 'charge') {
    const t = state.t + dt;
    return { ...state, t, power: powerAt(t) };
  }
  let s = state, left = dt;
  while (left > 0 && ['flight', 'result'].includes(s.phase)) {
    const duration = s.phase === 'flight' ? kickFlightMs(s.shot, s.weather) : RESULT_MS;
    const step = Math.min(left, duration - s.t);
    s = { ...s, t: s.t + step }; left -= step;
    if (s.phase === 'flight') s = { ...s, keeper: computerKeeperAt(s, s.t) };
    if (s.t < duration) break;
    if (s.phase === 'flight') {
      const result = judgeKick(s), log = [...s.log, result];
      s = { ...s, log, bonuses: [...s.bonuses, result === 'goal' ? cornerBonus(s.shot.target) : 0],
        phase: log.length === KICKER_SHOTS ? 'over' : 'result', t: 0 };
    } else s = startShot({ ...s, phase: 'ready', t: 0 });
  }
  return s;
}

// ---- 手機手勢 ----
// 放開手指時分類:dx、dy = 位移(px,往下為正)、ms = 持續時間、upper = 起點在畫面上半。
//   點(位移 < 12):上半 ⇒ 跳;下半 ⇒ 無
//   快速(≤ 350ms)往左上/右上滑 ⇒ 撲
//   其他滑動(含較慢的斜滑)依主方向:水平為主 ⇒ 移動,每 35px 一步(至少 1、至多 6 步);往上為主 ⇒ 跳;往下為主 ⇒ 無
export const TAP_PX = 12;
export const FIELD_W = 360; // 球場畫布寬(世界單位 1:1),拖曳換算用
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

// 即時拖曳(RS12):按住球場後水平為主地拖(往上 < 0.4 × 水平,與快撲的斜滑分開)就進入拖曳,守門員即時跟著手指。
export const isDrag = ({ dx, dy }) => Math.abs(dx) >= TAP_PX && Math.abs(dy) < Math.abs(dx) * 0.4;

// 拖曳換算:起點 x + 手指水平位移(px)× 世界寬/畫面寬,限 ±118。
export const dragX = (startX, dxPx, cssWidth) => clamp(startX + (dxPx * FIELD_W) / cssWidth, -X_LIMIT, X_LIMIT);

// ---- 存檔(續玩,存檔點 = 球與球之間)----

// actions 一併保存:續玩後按「新遊戲」仍依玩家操作判斷 quit(§4.2)。
export function toSave(state) {
  const { difficulty, total, log, actions, weather, weatherChoice, wind } = state;
  return { role: roleOf(state), difficulty, total, log: [...log], actions, weather, weatherChoice, wind: { ...wind },
    ...(roleOf(state) === 'kicker' ? { aim: { ...state.aim }, curve: state.curve, bonuses: [...state.bonuses] } : {}) };
}

// 還原到「下一球開始前」。
export function fromSave(saved) {
  return { ...initState({ difficulty: saved.difficulty, total: saved.total, role: roleOf(saved) }),
    weather: saved.weather ?? 'sun', weatherChoice: saved.weatherChoice ?? saved.weather ?? 'sun',
    wind: saved.wind ? { ...saved.wind } : { direction: 0, strength: 0 }, log: [...saved.log], actions: saved.actions,
    ...(roleOf(saved) === 'kicker' ? { aim: { ...saved.aim }, curve: saved.curve, bonuses: [...saved.bonuses] } : {}) };
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
// 已踢完全部球數的存檔不合格(那一局應已結算)。
export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const { difficulty, total, log, actions } = s;
  if ('role' in s && !ROLES.includes(s.role)) return false;
  if (!DIFFICULTIES.includes(difficulty)) return false;
  if (!Number.isInteger(total) || total < SHOTS_MIN || total > SHOTS_MAX) return false;
  if (!Array.isArray(log) || log.length >= total) return false;
  if (!Number.isInteger(actions) || actions < 0) return false;
  // 相容舊晴天存檔;新增欄位必須整組合法,不可將未知天氣當晴天還原。
  if ('weather' in s || 'wind' in s || 'weatherChoice' in s) {
    if (!WEATHERS.includes(s.weather) || !WEATHER_CHOICES.includes(s.weatherChoice)) return false;
    if (s.weatherChoice !== 'random' && s.weatherChoice !== s.weather) return false;
    if (!s.wind || typeof s.wind !== 'object' || Array.isArray(s.wind)) return false;
    const { direction, strength } = s.wind;
    if (s.weather === 'wind') {
      if (![1, -1].includes(direction) || !Number.isInteger(strength) || strength < WIND_MIN || strength > WIND_MAX) return false;
    } else if (direction !== 0 || strength !== 0) return false;
  }
  if (roleOf(s) === 'kicker') {
    if (total !== KICKER_SHOTS || !('weather' in s) || !CURVES.includes(s.curve)) return false;
    if (!s.aim || Array.isArray(s.aim) || !Number.isFinite(s.aim.x) || !Number.isFinite(s.aim.y)
      || Math.abs(s.aim.x) > GOAL_HALF_W || s.aim.y < 0 || s.aim.y > GOAL_H) return false;
    if (!Array.isArray(s.bonuses) || s.bonuses.length !== log.length) return false;
    if (!Array.from(s.bonuses).every((b, i) => Number.isInteger(b) && b >= 0 && b <= KICK_PARAMS.cornerMax && (log[i] === 'goal' || b === 0))) return false;
    return Array.from(log).every((r) => ['save', 'goal', 'miss', 'high'].includes(r));
  }
  return log.every((r) => r === 'save' || r === 'goal');
}
