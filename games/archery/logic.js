// 弓箭射擊規則(G14 第一期:拋物線拉弓射靶)。純函式,不碰 DOM;隨機數可注入;物理以固定步長推進。
// 座標:場景 400 × 240,y 向上為正(地面 y = 0);畫面翻轉由 draw.js 處理。

export const W = 400;
export const H = 240;
export const ARCHER = Object.freeze({ x: 30, y: 60 });
export const GRAVITY = 300;
export const DT = 1 / 60;
export const ARROWS = 10;
export const V_MIN = 120;
export const V_RANGE = 280;
export const PULL_MAX = 120;
export const PULL_MIN = 12;
export const GRAB_R = 80;
export const ANGLE_MIN = -10;
export const ANGLE_MAX = 80;
export const PREVIEW_SEC = 0.4;
export const RESULT_MS = 800; // 命中/脫靶結果停留(UI 層)
export const MAX_FLIGHT = 10; // 秒;保險,避免逆風把箭吹回原地永遠不落地
export const DIFFICULTIES = ['normal', 'hard', 'expert'];
// 靶位與風力(A1 照表):每箭重新抽(normal 固定靶、無風)。
export const LEVELS = Object.freeze({
  normal: { x: [300, 300], y: [60, 60], r: 40, wind: [0, 0] },
  hard: { x: [280, 360], y: [40, 120], r: 32, wind: [-20, 20] },
  expert: { x: [300, 380], y: [30, 180], r: 26, wind: [-40, 40] },
});
// 五環:dist ≤ 半徑 × 比例 ⇒ 分數(由內而外)。
export const RINGS = Object.freeze([[0.2, 10], [0.4, 8], [0.6, 6], [0.8, 4], [1.0, 2]]);
export const POINTS = Object.freeze([0, 2, 4, 6, 8, 10]);
// 勝負門檻(A2):10 箭總分達到即勝。
export const THRESHOLDS = Object.freeze({ normal: 50, hard: 50, expert: 40 });
export const DEFAULT_AIM = Object.freeze({ angle: 35, power: 0.6 });
export const PHASES = ['aim', 'flying', 'result', 'over'];

const pick = ([lo, hi], rng) => (lo === hi ? lo : Math.round(lo + rng() * (hi - lo)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 一箭的靶位與風力(rng 可注入;normal 不吃亂數)。
export function targetFor(difficulty = 'normal', rng = Math.random) {
  const lv = LEVELS[difficulty] ?? LEVELS.normal;
  const x = pick(lv.x, rng);
  const y = pick(lv.y, rng);
  const wind = pick(lv.wind, rng);
  return { target: { x, y, r: lv.r }, wind };
}

// 以種子與抽取次數保存亂數進度;每次取值皆為純函式(Mulberry32)。
export function randomStep(rng) {
  let n = (rng.seed + Math.imul(rng.index + 1, 0x6d2b79f5)) >>> 0;
  n = Math.imul(n ^ (n >>> 15), n | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return { value: ((n ^ (n >>> 14)) >>> 0) / 4294967296, rng: { seed: rng.seed, index: rng.index + 1 } };
}

function seededTarget(difficulty, rng) {
  let progress = rng;
  const field = targetFor(difficulty, () => {
    const next = randomStep(progress);
    progress = next.rng;
    return next.value;
  });
  return { ...field, rng: progress };
}

// 可注入整數種子,或注入僅用來產生初始種子的亂數函式。
export function initState(difficulty = 'normal', seed = Math.random) {
  const d = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
  const rng = { seed: (typeof seed === 'function' ? Math.floor(seed() * 4294967296) : seed) >>> 0, index: 0 };
  return { difficulty: d, phase: 'aim', scores: [], shots: 0, aim: { ...DEFAULT_AIM }, shot: null, hit: null, ...seededTarget(d, rng) };
}

// 拉弓起點必須在弓手附近(半徑 GRAB_R 內)。
export function canGrab(point) {
  return Math.hypot(point.x - ARCHER.x, point.y - ARCHER.y) <= GRAB_R;
}

// 拖曳 → 角度/力度:拖曳向量 = 起點 − 目前點(往後拉,箭往反方向飛)。拖曳太短 ⇒ valid:false(不射)。
export function aimFromDrag(start, current) {
  const dx = start.x - current.x;
  const dy = start.y - current.y;
  const len = Math.hypot(dx, dy);
  const angle = clamp(Math.atan2(dy, dx) * 180 / Math.PI, ANGLE_MIN, ANGLE_MAX);
  const power = Math.min(len, PULL_MAX) / PULL_MAX;
  return { valid: len >= PULL_MIN, angle, power };
}

// 鍵盤微調:角度每次 2°、力度每次 5%,都夾在上下限內。
export function adjustAim(aim, dAngle = 0, dPower = 0) {
  return {
    angle: clamp(Math.round((aim.angle + dAngle) * 10) / 10, ANGLE_MIN, ANGLE_MAX),
    power: clamp(Math.round((aim.power + dPower) * 100) / 100, 0, 1),
  };
}

export function launchVelocity({ angle, power }) {
  const speed = V_MIN + V_RANGE * clamp(power, 0, 1);
  const rad = clamp(angle, ANGLE_MIN, ANGLE_MAX) * Math.PI / 180;
  return { vx: speed * Math.cos(rad), vy: speed * Math.sin(rad) };
}

// 拉弓中的預測虛線:只算前 PREVIEW_SEC 秒(A4),⛔ 畫完整落點。
export function previewPath(state, aim) {
  let p = { x: ARCHER.x, y: ARCHER.y, ...launchVelocity(aim) };
  const out = [{ x: p.x, y: p.y }];
  for (let t = 0; t < PREVIEW_SEC - 1e-9; t += DT) {
    p = advance(p, state.wind);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

// 射出:只在瞄準階段;aim 無效(拖曳太短)不射、狀態不變。
export function shoot(state, aim) {
  if (state.phase !== 'aim' || !Number.isInteger(state.shots) || state.shots < 0 || state.shots >= ARROWS
    || state.scores.length !== state.shots || aim?.valid === false) return state;
  const a = { angle: clamp(aim.angle, ANGLE_MIN, ANGLE_MAX), power: clamp(aim.power, 0, 1) };
  return { ...state, phase: 'flying', aim: a, shots: state.shots + 1, hit: null,
    shot: { x: ARCHER.x, y: ARCHER.y, ...launchVelocity(a), t: 0 } };
}

// 一步物理(半隱式 Euler):先改速度(風、重力),再移動。
function advance(p, wind, dt = DT) {
  const vx = p.vx + wind * dt;
  const vy = p.vy - GRAVITY * dt;
  return { ...p, vx, vy, x: p.x + vx * dt, y: p.y + vy * dt, t: (p.t ?? 0) + dt };
}

export function ringPoints(dist, r) {
  for (const [ratio, points] of RINGS) if (dist <= r * ratio + 1e-9) return points;
  return 0;
}

// 固定步長推進;箭到達靶的 x 時以線性內插求高度判定命中(A5),出界或落地為脫靶。
export function stepState(state, dt = DT) {
  if (state.phase !== 'flying' || state.shots < 1 || state.shots > ARROWS || state.scores.length !== state.shots - 1) return state;
  const prev = state.shot;
  const next = advance(prev, state.wind, dt);
  const { target } = state;
  if (prev.x < target.x && next.x >= target.x) {
    const y = prev.y + (next.y - prev.y) * (target.x - prev.x) / (next.x - prev.x);
    const dist = Math.abs(y - target.y);
    if (dist <= target.r + 1e-9) {
      const points = ringPoints(dist, target.r);
      return { ...state, phase: 'result', shot: { ...next, x: target.x, y }, hit: { x: target.x, y, dist, points }, scores: [...state.scores, points] };
    }
  }
  if (next.x > W + 20 || next.y < 0 || next.t > MAX_FLIGHT) {
    return { ...state, phase: 'result', shot: next, hit: { x: next.x, y: Math.max(0, next.y), dist: null, points: 0 }, scores: [...state.scores, 0] };
  }
  return { ...state, shot: next };
}

// 結果顯示完 ⇒ 下一箭(重新抽靶位與風力);10 箭射完 ⇒ over。
export function nextArrow(state) {
  if (state.phase !== 'result' || state.shots < 1 || state.shots > ARROWS || state.scores.length !== state.shots) return state;
  if (state.shots === ARROWS) return { ...state, phase: 'over', shot: null };
  return { ...state, phase: 'aim', shot: null, hit: null, ...seededTarget(state.difficulty, state.rng) };
}

// 一箭從射出跑到結果(示範與測試用)。
export function simulate(state, aim) {
  let s = shoot(state, aim);
  const trail = s.shot ? [{ x: s.shot.x, y: s.shot.y }] : [];
  for (let i = 0; i < MAX_FLIGHT / DT + 2 && s.phase === 'flying'; i++) {
    s = stepState(s);
    trail.push({ x: s.shot.x, y: s.shot.y });
  }
  return { state: s, trail };
}

export const scoreFor = (state) => state.scores.reduce((a, b) => a + b, 0);
export const resultFor = (state) => (scoreFor(state) >= THRESHOLDS[state.difficulty] ? 'win' : 'lose');
export const detailFor = (state) => ({
  arrows: state.scores.length,
  hits: state.scores.filter((p) => p > 0).length,
  bullseyes: state.scores.filter((p) => p === 10).length,
});
// 新遊戲的有效操作數(§4.2):射出過的箭。
export const movesOf = (state) => state.shots;
// 最後一箭得分當下即完成,結果展示的 800ms 不影響勝負或重開結算。
export const completedResult = (state) => state.scores.length === ARROWS ? resultFor(state) : null;
// 只判定十箭是否全中既有最內環;不參與計分、XP 或成就,也不排除輔助局。
export const isPerfectRound = (state) => state.scores.length === ARROWS
  && state.scores.filter((points) => points === RINGS[0][1]).length === ARROWS;
export const resultOnRestart = (state) => completedResult(state) ?? (movesOf(state) > 0 ? 'quit' : null);

// 各暫停原因獨立保存;解除自動原因不解除手動暫停。
export const initialPause = () => ({ manual: false, hidden: false, help: false, confirm: false });
export const isPaused = (reasons) => Object.values(reasons).some(Boolean);
export function changePause(reasons, reason, active) {
  const next = { ...reasons, [reason]: active };
  return { reasons: next, paused: isPaused(next), cancelDrag: active,
    resetClock: isPaused(reasons) && !isPaused(next) };
}

// 存檔只在箭與箭之間:飛行中存 ⇒ 回到這一箭射出前(這一箭重射,分數不變)。
export function toSave(state) {
  if (state.phase === 'flying') return { ...state, phase: 'aim', shot: null, hit: null, shots: state.shots - 1 };
  return { ...state, shot: null };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, [lo, hi]) => isNum(v) && v >= lo && v <= hi;
export function isValidState(s) {
  if (!s || typeof s !== 'object' || !DIFFICULTIES.includes(s.difficulty)) return false;
  if (!['aim', 'result', 'over'].includes(s.phase)) return false;
  if (!Array.isArray(s.scores) || s.scores.length > ARROWS || !s.scores.every((p) => POINTS.includes(p))) return false;
  if (!Number.isInteger(s.shots) || s.shots < 0 || s.shots > ARROWS || s.shots !== s.scores.length) return false;
  if (s.phase === 'over' && s.scores.length !== ARROWS) return false;
  if (s.phase === 'aim' && (s.shots >= ARROWS || s.hit !== null)) return false;
  if (s.phase === 'result' && (s.shots === 0 || !s.hit || !POINTS.includes(s.hit.points) || s.scores.at(-1) !== s.hit.points)) return false;
  if (s.shot !== null) return false;
  const targets = s.phase === 'aim' ? s.shots + 1 : s.shots;
  if (!s.rng || !Number.isInteger(s.rng.seed) || s.rng.seed < 0 || s.rng.seed > 0xffffffff
    || s.rng.index !== (s.difficulty === 'normal' ? 0 : targets * 3)) return false;
  const lv = LEVELS[s.difficulty];
  if (!s.target || !inRange(s.target.x, lv.x) || !inRange(s.target.y, lv.y) || s.target.r !== lv.r || !inRange(s.wind, lv.wind)) return false;
  if (!s.aim || !inRange(s.aim.angle, [ANGLE_MIN, ANGLE_MAX]) || !inRange(s.aim.power, [0, 1])) return false;
  return true;
}
export function fromSave(saved) {
  return { ...saved, shot: null };
}

// ---- 說明與示範 ----
export const HELP_RULES = [
  '在弓手附近按住往後拖曳拉弓,拖越長力越大,放開射出。',
  '箭受重力畫出拋物線;困難以上有風,會把箭往左右吹。',
  '虛線只預告開頭一小段,落點要自己判斷。',
  '電腦也可用 ↑↓ 調角度、←→ 調力度、空白鍵射出;P 暫停。',
  '一局 10 箭,靶環由內而外 10、8、6、4、2 分,脫靶 0 分。',
  '10 箭總分達門檻就贏(一般、困難 50 分,高手 40 分)。',
];

// 示範:固定角度與力度,全部由 simulate 實算。
export function demoAims(state = initState('normal')) {
  let hit8 = null;
  // 先找有明顯弧度的角度(25° 起),示範圖才看得出拋物線。
  const angles = [...Array.from({ length: 36 }, (_, i) => 25 + i), ...Array.from({ length: 15 }, (_, i) => 10 + i)];
  for (const angle of angles) {
    if (hit8) break;
    for (let power = 0.3; power <= 1.0001 && !hit8; power += 0.01) {
      const aim = { angle, power: Math.round(power * 100) / 100 };
      if (simulate(state, aim).state.hit?.points === 8) hit8 = aim;
    }
  }
  return { hit8, weak: { angle: 20, power: 0.05 }, short: { x: ARCHER.x - 6, y: ARCHER.y - 4 } };
}
