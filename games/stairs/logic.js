// 下樓梯規則層:純函式,不碰 DOM。座標單位 = 場地單位,x 往右、y 往下(0 在畫面頂端)。
// 規則正典:workbook/plans/stairs.md「規則(驗收依據)」。

export const W = 9; // 場地寬
export const H = 16; // 場地高
export const PLAYER = 0.8; // 玩家方塊邊長
export const GAP = 2; // 相鄰平台垂直間距(固定)
export const CEIL = 0.6; // 頂端刺的高度:玩家頂緣進到這裡就被刺到
export const DT = 1 / 60; // 固定時間步長(秒)
export const GRAVITY = 30; // 重力加速度(單位/秒²)
export const MAX_FALL = 10; // 最大下落速度
export const MOVE_SPEED = 6; // 左右移動速度
export const BOUNCE_V = 7; // 彈跳平台彈起的初速
export const FLIP_DELAY = 0.5; // 翻轉平台踩上後幾秒消失
export const PUSH_V = 2; // 被頂刺推下的初速
export const HURT_SEC = 0.6; // 受傷閃爍時間(只給畫面用)
export const MAX_LIVES = 3;
export const HEAL_EVERY = 10; // 每 10 層站上普通平台回 1 命
export const KINDS = ['normal', 'spike', 'bounce', 'flip'];
export const ITEMS = ['heart']; // 平台上的道具(RS17)
export const HEART = 0.6; // 愛心邊長
export const HEART_LIFT = 0.15; // 愛心底緣離平台上緣的高度
export const DIFFICULTIES = ['normal', 'hard', 'expert'];

// 難度參數:初始捲動速度、加速度(單位/秒²)、速度上限、各平台比例(其餘為普通)。
export const LEVELS = {
// heart = 新生成的普通平台帶愛心的機率(RS17)。
  normal: { speed0: 1.5, accel: 0.03, maxSpeed: 4, spike: 0.1, bounce: 0.1, flip: 0.15, heart: 0.06 },
  hard: { speed0: 2, accel: 0.04, maxSpeed: 5, spike: 0.2, bounce: 0.1, flip: 0.15, heart: 0.04 },
  expert: { speed0: 2.5, accel: 0.05, maxSpeed: 6, spike: 0.3, bounce: 0.1, flip: 0.15, heart: 0.03 },
};

const START_Y = 8; // 開局平台高度(畫面中段)
const START_W = 4;

// ---- 可重現的亂數(種子存在 state 裡,存檔還原後序列不變)----

// mulberry32:回傳 [0~1 的亂數, 下一個種子]。
export function nextRandom(seed) {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

export function speedAt(difficulty, time) {
  const { speed0, accel, maxSpeed } = LEVELS[difficulty];
  return Math.min(maxSpeed, speed0 + accel * time);
}

// 依難度比例決定平台種類。r ∈ [0, 1)。
export function kindFor(difficulty, r) {
  const { spike, bounce, flip } = LEVELS[difficulty];
  if (r < spike) return 'spike';
  if (r < spike + bounce) return 'bounce';
  if (r < spike + bounce + flip) return 'flip';
  return 'normal';
}

// 產生第 n 層平台(上緣在 y):寬 2~4、水平位置隨機;普通平台依難度機率帶愛心。→ { platform, seed }
// 每塊平台固定取 4 個亂數(不論種類),序列只由種子決定,存檔續玩可重現。
export function spawnPlatform(seed, n, y, difficulty) {
  let r1, r2, r3, r4;
  [r1, seed] = nextRandom(seed);
  [r2, seed] = nextRandom(seed);
  [r3, seed] = nextRandom(seed);
  [r4, seed] = nextRandom(seed);
  const w = 2 + Math.floor(r2 * 3);
  const x = Math.round(r3 * (W - w) * 100) / 100;
  const kind = kindFor(difficulty, r1);
  const item = kind === 'normal' && r4 < LEVELS[difficulty].heart ? 'heart' : null;
  return { platform: { n, x, y, w, kind, flip: null, item }, seed };
}

// 愛心的範圍(在平台中央上方,隨平台移動)。
export function heartBox(p) {
  return { x: p.x + (p.w - HEART) / 2, y: p.y - HEART_LIFT - HEART, w: HEART, h: HEART };
}

// 從最下面那層往下補平台,補到畫面底部以下一層。
function fill(platforms, seed, nextN, difficulty) {
  const list = [...platforms];
  let lastY = list.length ? list[list.length - 1].y : START_Y;
  while (lastY <= H) {
    lastY += GAP;
    const out = spawnPlatform(seed, nextN, lastY, difficulty);
    list.push(out.platform);
    seed = out.seed;
    nextN++;
  }
  return { platforms: list, seed, nextN };
}

// ---- 狀態 ----
// state = { player, platforms, seed, nextN, floors, lives, healAt, hearts, time, ticks, speed, difficulty, hurt, picked, paused, over }
//   player    { x, y, vy, on }:左上角座標、垂直速度、站著的平台層號(null = 空中)、drop = 正要穿過的平台層號
//   platforms 由上到下;每個 { n 層號, x, y 上緣, w, kind, flip 翻轉計時(null = 未踩), item 道具('heart' / null) }
//   floors    分數 = 經過的層數 = 踩過最深的層號(開局平台是第 0 層)
//   healAt    下一次可回命的層數門檻
//   hearts    本局撿到的愛心數(RS17;不加分,記在 detail)
//   picked    本步撿到愛心:'heal' 加命 / 'full' 滿血沒加 / null(只給畫面用,不存檔)
//   ticks     本局已推進的步數(§4.2 判斷「新遊戲」要不要記錄)

export function initState(rng = Math.random, difficulty = 'normal') {
  const diff = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
  const first = { n: 0, x: (W - START_W) / 2, y: START_Y, w: START_W, kind: 'normal', flip: null, item: null };
  const filled = fill([first], Math.floor(rng() * 4294967296) >>> 0, 1, diff);
  return {
    player: { x: (W - PLAYER) / 2, y: START_Y - PLAYER, vy: 0, on: 0, drop: null },
    platforms: filled.platforms,
    seed: filled.seed,
    nextN: filled.nextN,
    floors: 0,
    lives: MAX_LIVES,
    healAt: HEAL_EVERY,
    hearts: 0,
    time: 0,
    ticks: 0,
    speed: speedAt(diff, 0),
    difficulty: diff,
    hurt: 0,
    picked: null,
    paused: true,
    over: false,
  };
}

export function pauseState(state) {
  if (state.paused || state.over) return state;
  return { ...state, paused: true };
}

export function resumeState(state) {
  if (!state.paused || state.over) return state;
  return { ...state, paused: false };
}

const overlaps = (x, p) => x + PLAYER > p.x && x < p.x + p.w;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 推進一步。input = { dir: -1 左 / 0 不動 / 1 右 }。暫停或已結束 ⇒ 原 state。
export function stepState(state, input = {}, dt = DT) {
  if (state.paused || state.over) return state;
  const dir = Math.sign(input.dir || 0);
  const time = state.time + dt;
  const speed = speedAt(state.difficulty, time);
  const dy = speed * dt;

  // 1. 平台上移;翻轉平台計時到就消失;移出頂端的刪掉;底下補新平台。
  let platforms = [];
  for (const p of state.platforms) {
    const flip = p.flip === null ? null : p.flip + dt;
    if (flip !== null && flip >= FLIP_DELAY) continue;
    const y = p.y - dy;
    if (y < -1) continue;
    platforms.push({ ...p, y, flip });
  }
  const filled = fill(platforms, state.seed, state.nextN, state.difficulty);
  platforms = filled.platforms;

  // 2. 玩家左右移動。
  let { x, y, vy, on, drop } = state.player;
  const x0 = x;
  x = clamp(x + dir * MOVE_SPEED * dt, 0, W - PLAYER);

  let { lives, floors, healAt } = state;
  let hurt = Math.max(0, state.hurt - dt);

  // 3. 站著:隨平台上移;走出平台或平台消失 ⇒ 開始掉。
  const standing = on === null ? null : platforms.find((p) => p.n === on);
  if (standing && overlaps(x, standing)) {
    y = standing.y - PLAYER;
    vy = 0;
  } else {
    on = null;
    // 4. 空中:重力;以「相對平台」的掃掠判定落地(避免高速穿過)。
    const prevBottom = y + PLAYER;
    vy = Math.min(MAX_FALL, vy + GRAVITY * dt);
    y += vy * dt;
    const bottom = y + PLAYER;
    let land = null;
    for (const p of platforms) {
      if (p.n === drop) continue;
      // 相對平台:步初在上緣之上(gap0 ≥ 0)、步末在上緣之下(gap1 ≤ 0)⇒ 本步穿過上緣。
      const gap0 = p.y + dy - prevBottom;
      const gap1 = p.y - bottom;
      if (gap0 < -1e-9 || gap1 > 0) continue;
      // 水平重疊看「穿過上緣那一刻」的 x(依交會時刻內插),不看步末的 x。
      const t = gap0 - gap1 > 0 ? Math.max(0, gap0) / (gap0 - gap1) : 1;
      if (!overlaps(x0 + (x - x0) * t, p)) continue;
      if (!land || p.y < land.y) land = p;
    }
    if (land) {
      y = land.y - PLAYER;
      drop = null;
      if (land.n > floors) floors = land.n; // 層號從 0 起算 ⇒ 踩過最深的層號 = 經過的層數(跳過的層也算)
      if (land.kind === 'bounce') {
        vy = -BOUNCE_V;
      } else {
        vy = 0;
        on = land.n;
        if (land.kind === 'spike') {
          lives -= 1;
          hurt = HURT_SEC;
        } else if (land.kind === 'flip' && land.flip === null) {
          platforms = platforms.map((p) => (p === land ? { ...p, flip: 0 } : p));
        } else if (land.kind === 'normal' && floors >= healAt) {
          lives = Math.min(MAX_LIVES, lives + 1);
          healAt = (Math.floor(floors / HEAL_EVERY) + 1) * HEAL_EVERY;
        }
      }
    }
  }

  // 5. 碰到頂端的刺:扣 1 命,穿過腳下平台被推下。
  if (y < CEIL) {
    lives -= 1;
    hurt = HURT_SEC;
    drop = on ?? drop;
    on = null;
    y = CEIL;
    vy = Math.max(vy, PUSH_V);
  }

  // 6. 碰到愛心就撿起:生命 +1(上限 3);滿血也撿走但不加命(RS17)。
  let { hearts } = state;
  let picked = null;
  if (lives > 0) {
    platforms = platforms.map((p) => {
      if (p.item !== 'heart') return p;
      const b = heartBox(p);
      if (!(x + PLAYER > b.x && x < b.x + b.w && y + PLAYER > b.y && y < b.y + b.h)) return p;
      hearts += 1;
      picked = lives < MAX_LIVES ? 'heal' : 'full';
      lives = Math.min(MAX_LIVES, lives + 1);
      return { ...p, item: null };
    });
  }

  const over = lives <= 0 || y > H; // 生命歸零或掉出底部
  return {
    ...state,
    player: { x, y, vy, on, drop },
    platforms,
    seed: filled.seed,
    nextN: filled.nextN,
    floors,
    lives: Math.max(0, lives),
    healAt,
    hearts,
    time,
    ticks: state.ticks + 1,
    speed,
    hurt,
    picked,
    over,
  };
}

// 遮罩:'ready' 開局未動 / 'paused' / 'over' / null。
export function overlayFor({ paused, over, ticks }) {
  if (over) return 'over';
  if (paused) return ticks === 0 ? 'ready' : 'paused';
  return null;
}

// ---- 存檔(續玩)----

const SAVE_KEYS = ['player', 'platforms', 'seed', 'nextN', 'floors', 'lives', 'healAt', 'hearts', 'time', 'ticks', 'speed', 'difficulty'];

export function toSave(state) {
  return structuredClone(Object.fromEntries(SAVE_KEYS.map((k) => [k, state[k]])));
}

// 還原後處於暫停狀態。RS17 之前的存檔沒有 item / hearts,補成「無道具、撿到 0 顆」。
export function fromSave(saved) {
  const s = structuredClone(saved);
  return {
    ...s,
    platforms: s.platforms.map((p) => ({ ...p, item: p.item ?? null })),
    hearts: s.hearts ?? 0,
    hurt: 0,
    picked: null,
    paused: true,
    over: false,
  };
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

function isPlatform(p) {
  return isObj(p) && isCount(p.n) && KINDS.includes(p.kind) && inRange(p.w, 2, 4) && inRange(p.x, 0, W - p.w)
    && inRange(p.y, -1, H + GAP) && (p.flip === null || (p.kind === 'flip' && inRange(p.flip, 0, FLIP_DELAY)))
    && (p.item === undefined || p.item === null || (ITEMS.includes(p.item) && p.kind === 'normal')); // 愛心只在普通平台;undefined = RS17 前的存檔
}

// 開局到 time 秒平台累計上移的距離(速度線性增加到上限後固定)。
export function scrolledBy(difficulty, time) {
  const { speed0, accel, maxSpeed } = LEVELS[difficulty];
  const tc = (maxSpeed - speed0) / accel;
  if (time <= tc) return speed0 * time + (accel * time * time) / 2;
  return speed0 * tc + (accel * tc * tc) / 2 + maxSpeed * (time - tc);
}

const SCROLL_TOL = 0.1; // 逐步累加與解析解的誤差上限(遠小於平台間距)

export function isValidState(s) {
  if (!isObj(s)) return false;
  const { player, platforms, seed, nextN, floors, lives, healAt, hearts, time, ticks, speed, difficulty } = s;
  if (!DIFFICULTIES.includes(difficulty)) return false;
  if (!Array.isArray(platforms) || platforms.length === 0 || platforms.length > 20 || !platforms.every(isPlatform)) return false;
  for (let i = 1; i < platforms.length; i++) {
    if (platforms[i].n <= platforms[i - 1].n) return false; // 翻轉平台消失會留下缺號
  }
  if (!isCount(nextN) || nextN !== platforms[platforms.length - 1].n + 1) return false;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return false;
  if (!isCount(ticks) || !inRange(time, 0, 1e7) || Math.abs(time - ticks * DT) > 1e-6 * (ticks + 1)) return false;
  if (!inRange(speed, LEVELS[difficulty].speed0, LEVELS[difficulty].maxSpeed)) return false;
  // 層號與高度一致:第 n 層的上緣 = 開局高度 + n 個間距 − 已捲動距離(同時保證間距固定、層號不能整批平移)。
  const scrolled = scrolledBy(difficulty, time);
  if (!platforms.every((p) => Math.abs(p.y - (START_Y + GAP * p.n - scrolled)) <= SCROLL_TOL)) return false;
  const maxN = platforms[platforms.length - 1].n;
  if (!isCount(floors) || floors > maxN) return false;
  if (!Number.isInteger(lives) || lives < 1 || lives > MAX_LIVES) return false; // 生命 0 = 已結束,不會存檔
  if (hearts !== undefined && (!isCount(hearts) || hearts > nextN)) return false; // 每層最多一顆;undefined = RS17 前的存檔
  if (!isCount(healAt) || healAt % HEAL_EVERY !== 0 || healAt < HEAL_EVERY || healAt > floors + HEAL_EVERY) return false;
  if (!isObj(player) || !inRange(player.x, 0, W - PLAYER) || !inRange(player.y, CEIL, H) || !inRange(player.vy, -BOUNCE_V, MAX_FALL)) return false;
  if (player.on !== null) {
    // 站著:平台存在、腳底貼齊上緣、沒有垂直速度
    const p = platforms.find((q) => q.n === player.on);
    if (!p || Math.abs(player.y + PLAYER - p.y) > 1e-6 || player.vy !== 0) return false;
  }
  if (player.drop !== null && (!isCount(player.drop) || player.drop > maxN)) return false;
  return true;
}
