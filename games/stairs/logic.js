// 下樓梯規則層:純函式,不碰 DOM。座標單位 = 場地單位,x 往右、y 往下(0 在畫面頂端)。
// 規則正典:workbook/plans/stairs.md「規則(驗收依據)」。
import { STAGES, ADVENTURE, stageFor, directionFor, stageComplete } from './stages.js?v=a9ad940';
export { STAGES, ADVENTURE, stageFor, directionFor, flipNotice, goalText, goalProgress, stageComplete } from './stages.js?v=a9ad940';

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

export function enemyBox(p) {
  return { x: p.x + p.enemy.offset, y: p.y - ADVENTURE.enemySize, w: ADVENTURE.enemySize, h: ADVENTURE.enemySize };
}

// 三角波巡邏：在邊界反射，沒有依賴全域時間。
function patrol(x, dir, distance, max) {
  const phase = ((dir > 0 ? x : 2 * max - x) + distance) % (2 * max);
  return { x: phase <= max ? phase : 2 * max - phase, dir: phase < max ? 1 : -1 };
}

export function spawnStagePlatform(seed, n, y, stage) {
  const st = STAGES[stage - 1];
  const random = () => { let r; [r, seed] = nextRandom(seed); return r; };
  let choice = random();
  let kind = 'normal';
  for (const [k, weight] of st.kinds) {
    if (choice < weight) { kind = k; break; }
    choice -= weight;
  }
  const w = 2 + Math.floor(random() * 3);
  const x = Math.round(random() * (W - w) * 100) / 100;
  const rItem = random();
  let item = null;
  // 一層至多一個寶物；愛心的機率仍是普通平台 6%。
  const table = kind === 'normal' ? [['heart', st.heart], ['star', st.star], ['shield', st.shield], ['cloud', st.cloud], ['coin', st.coin]]
    : kind === 'spike' ? [] : [['star', st.star], ['shield', st.shield], ['cloud', st.cloud], ['coin', st.coin]];
  let threshold = 0;
  for (const [name, weight] of table) {
    threshold += weight ?? 0;
    if (rItem < threshold) { item = name; break; }
  }
  const rEnemy = random();
  const flag = st.goal === 'flag' && n === st.target;
  if (flag) { kind = 'normal'; item = null; }
  const enemy = !flag && ['normal', 'moving', 'ice'].includes(kind) && rEnemy < (st.enemy ?? 0)
    ? { offset: (w - ADVENTURE.enemySize) / 2, dir: 1 } : null;
  return { seed, platform: { n, x, y, w, kind, flip: null, item, enemy, motion: 1, flag } };
}

// 翻轉以平台「接觸面」為基準，玩家框與垂直速度也一起翻轉。
export function mirrorState(s) {
  return { ...s, player: { ...s.player, y: H - s.player.y - PLAYER, vy: -s.player.vy },
    platforms: s.platforms.map((p) => ({ ...p, y: H - p.y })),
    ...(s.clouds ? { clouds: s.clouds.map((p) => ({ ...p, y: H - p.y })) } : {}) };
}
export const canonicalState = (s) => directionFor(s) === -1 ? mirrorState(s) : s;

export function initAdventure(rng = Math.random, stage = 1) {
  if (!Number.isInteger(stage) || stage < 1 || stage > STAGES.length) throw new RangeError('關卡超出範圍');
  const base = initState(() => 0, 'normal');
  const first = { ...base.platforms[0], enemy: null, motion: 1, flag: false };
  const filled = fill([first], Math.floor(rng() * 4294967296) >>> 0, 1, 'normal', stage);
  const s = { ...base, ...filled, mode: 'adventure', stage, speed: STAGES[stage - 1].speed,
    player: { ...base.player, vx: 0 }, stageTicks: 0, stageCoins: 0, coins: 0, bankedFloors: 0,
    cleared: stage - 1, stageCleared: false, won: false, flagReached: false, stomps: 0,
    star: 0, shield: false, cloudTime: 0, cloudUses: 0, cloudSerial: 0, clouds: [] };
  return directionFor(s) === -1 ? mirrorState(s) : s;
}

export function nextStage(s) {
  if (s.mode !== 'adventure' || !s.stageCleared || s.over) return s;
  const next = initAdventure(() => s.seed / 4294967296, s.stage + 1);
  return { ...next, lives: s.lives, coins: s.coins, hearts: s.hearts, stomps: s.stomps,
    bankedFloors: s.bankedFloors + s.floors, ticks: s.ticks, cleared: s.cleared };
}

export function scoreFor(s) {
  return s.mode === 'adventure' ? s.bankedFloors + s.floors + s.coins * ADVENTURE.coinScore + s.stomps * ADVENTURE.stompScore + s.cleared * ADVENTURE.clearScore : s.floors;
}
export function detailFor(s) {
  return s.mode === 'adventure' ? { mode: 'adventure', stage: s.stage, cleared: s.cleared, coins: s.coins, floors: s.bankedFloors + s.floors }
    : { mode: 'endless', floors: s.floors, hearts: s.hearts ?? 0 };
}
export const resultFor = (s) => s.mode === 'adventure' && s.won ? 'win' : 'lose';

// 從最下面那層往下補平台,補到畫面底部以下一層。
function fill(platforms, seed, nextN, difficulty, adventureStage = null) {
  const list = [...platforms];
  let lastY = list.length ? list[list.length - 1].y : START_Y;
  while (lastY <= H) {
    lastY += GAP;
    const out = adventureStage ? spawnStagePlatform(seed, nextN, lastY, adventureStage) : spawnPlatform(seed, nextN, lastY, difficulty);
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
    mode: 'endless',
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
  if (!state.paused || state.over || state.stageCleared) return state;
  return { ...state, paused: false };
}

const overlaps = (x, p) => x + PLAYER > p.x && x < p.x + p.w;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 駕雲中(IR48):雲寶物生效期間自由飛,不受重力、不落地。
export const ridingCloud = (s) => s.mode === 'adventure' && s.cloudTime > 0;

// 推進一步。input = { dir: -1 左 / 0 不動 / 1 右, dy: -1 往畫面上 / 0 / 1 往畫面下(只在駕雲時有效), dismount: 下雲 }。
// 暫停或已結束 ⇒ 原 state。
export function stepState(state, input = {}, dt = DT) {
  if (state.paused || state.over || state.stageCleared) return state;
  const reversed = directionFor(state) === -1;
  // dy 以畫面方向給;翻轉關在內部座標上下相反。
  const next = stepSimulation(reversed ? mirrorState(state) : state, reversed ? { ...input, dy: -(input.dy || 0) } : input, dt);
  return reversed ? mirrorState(next) : next;
}

// 所有關卡與無盡共用這套向下的座標物理；入口/出口翻轉第 5 關。
function stepSimulation(state, input = {}, dt = DT) {
  if (state.paused || state.over) return state;
  const adventure = state.mode === 'adventure';
  const dir = Math.sign(input.dir || 0);
  const time = state.time + dt;
  const speed = adventure ? stageFor(state).speed : speedAt(state.difficulty, time);
  const dy = speed * dt;

  // 1. 平台上移;翻轉平台計時到就消失;移出頂端的刪掉;底下補新平台。
  let platforms = [];
  for (const p of state.platforms) {
    const flip = p.flip === null ? null : p.flip + dt;
    if (flip !== null && flip >= FLIP_DELAY) continue;
    const y = p.y - dy;
    if (y < -1) continue;
    let moved = { ...p, y, flip };
    if (adventure && p.kind === 'moving') {
      const motion = patrol(p.x, p.motion, ADVENTURE.movingSpeed * dt, W - p.w);
      moved = { ...moved, x: motion.x, motion: motion.dir };
    }
    if (adventure && p.enemy) {
      const motion = patrol(p.enemy.offset, p.enemy.dir, ADVENTURE.enemySpeed * dt, p.w - ADVENTURE.enemySize);
      moved.enemy = { offset: motion.x, dir: motion.dir };
    }
    platforms.push(moved);
  }
  const filled = fill(platforms, state.seed, state.nextN, state.difficulty, adventure ? state.stage : null);
  platforms = filled.platforms;
  // 雲平台固定在畫面上不隨平台上捲(IR48:站在雲上不會被帶去撞頂刺),到期消散。
  let clouds = adventure ? state.clouds.map((p) => ({ ...p, life: p.life - dt })).filter((p) => p.life > 0) : [];
  let star = adventure ? Math.max(0, state.star - dt) : 0;
  // 駕雲:本步仍在雲上(沒按下雲)就自由飛;時間在本步用完 ⇒ 飛完這步後生雲接住。
  const riding = ridingCloud(state) && !input.dismount;
  let cloudTime = riding ? Math.max(0, state.cloudTime - dt) : 0;
  const rideEnded = riding && cloudTime === 0;
  let cloudUses = riding ? state.cloudUses : 0;
  let cloudSerial = state.cloudSerial ?? 0;
  let shield = adventure && state.shield;
  let stomps = state.stomps ?? 0;

  // 2. 玩家左右移動。
  let { x, y, vy, on, drop } = state.player;
  const x0 = x;
  const y0 = y;
  let fallingVy = vy;
  const oldStanding = state.platforms.find((p) => p.n === on);
  let vx = dir * MOVE_SPEED;
  if (adventure && oldStanding?.kind === 'ice') {
    vx = dir ? clamp((state.player.vx ?? 0) + dir * ADVENTURE.iceAccel * dt, -MOVE_SPEED, MOVE_SPEED)
      : (state.player.vx ?? 0) * Math.max(0, 1 - ADVENTURE.iceDrag * dt);
  }
  const carried = adventure && oldStanding?.kind === 'moving' ? (platforms.find((p) => p.n === on)?.x ?? oldStanding.x) - oldStanding.x : 0;
  x = clamp(x + carried + vx * dt, 0, W - PLAYER);

  let { lives, floors, healAt } = state;
  let hurt = Math.max(0, state.hurt - dt);
  const damage = () => {
    if (adventure && (star > 0 || hurt > 0)) return;
    if (shield) shield = false;
    else lives -= 1;
    hurt = HURT_SEC;
  };

  // 3. 站著:隨平台上移;走出平台或平台消失 ⇒ 開始掉。
  const standing = on === null ? null : [...platforms, ...clouds].find((p) => p.n === on);
  if (riding) {
    // 駕雲:不受重力、不落地,上下由 dy 控制;最高 cloudTop(碰不到頂刺)、最低貼底(不會掉出去)。
    on = null;
    drop = null;
    vy = 0;
    fallingVy = 0; // 舊存檔可能帶著下落速度;駕雲時不能用它觸發踩頭改寫位置
    y = clamp(y + Math.sign(input.dy || 0) * ADVENTURE.flySpeed * dt, ADVENTURE.cloudTop, H - PLAYER);
  } else if (standing && overlaps(x, standing)) {
    y = standing.y - PLAYER;
    vy = 0;
  } else {
    on = null;
    // 4. 空中:重力;以「相對平台」的掃掠判定落地(避免高速穿過)。
    const prevBottom = y + PLAYER;
    vy = Math.min(MAX_FALL, vy + GRAVITY * dt);
    fallingVy = vy;
    y += vy * dt;
    const bottom = y + PLAYER;
    let land = null;
    for (const p of [...platforms, ...clouds]) {
      if (p.n === drop) continue;
      // 相對平台:步初在上緣之上(gap0 ≥ 0)、步末在上緣之下(gap1 ≤ 0)⇒ 本步穿過上緣。
      const gap0 = p.y + (p.kind === 'cloud' ? 0 : dy) - prevBottom; // 雲不上捲
      const gap1 = p.y - bottom;
      if (gap0 < -1e-9 || gap1 > 0) continue;
      // 水平重疊看「穿過上緣那一刻」的 x(依交會時刻內插),不看步末的 x。
      const t = gap0 - gap1 > 0 ? Math.max(0, gap0) / (gap0 - gap1) : 1;
      const oldX = state.platforms.find((q) => q.n === p.n)?.x ?? p.x;
      if (!overlaps(x0 + (x - x0) * t, { ...p, x: oldX + (p.x - oldX) * t })) continue;
      if (!land || p.y < land.y) land = p;
    }
    if (land) {
      y = land.y - PLAYER;
      drop = null;
      if (land.n > floors) floors = land.n; // 雲的平台號為負，不加層數
      if (land.kind === 'bounce') {
        vy = -BOUNCE_V;
      } else {
        vy = 0;
        on = land.n;
        if (land.kind === 'spike') {
          damage();
        } else if (land.kind === 'flip' && land.flip === null) {
          platforms = platforms.map((p) => (p === land ? { ...p, flip: 0 } : p));
        } else if (land.kind === 'normal' && floors >= healAt) {
          lives = Math.min(MAX_LIVES, lives + 1);
          healAt = (Math.floor(floors / HEAL_EVERY) + 1) * HEAL_EVERY;
        }
      }
    }
  }

  // 敵人頭頂掃掠，使用同一座標方向；側碰與星星碰撞共用傷害閘門。
  if (adventure && lives > 0) {
    platforms = platforms.map((p) => {
      if (!p.enemy) return p;
      const b = enemyBox(p);
      const old = state.platforms.find((q) => q.n === p.n);
      const before = old?.enemy ? enemyBox(old) : { ...b, y: b.y + dy };
      const gap0 = before.y - (y0 + PLAYER);
      const gap1 = b.y - (y + PLAYER);
      const t = gap0 - gap1 > 0 ? clamp(gap0 / (gap0 - gap1), 0, 1) : 1;
      const bx = before.x + (b.x - before.x) * t;
      const px = x0 + (x - x0) * t;
      const stomp = state.player.on === null && fallingVy > 0 && gap0 >= -1e-9 && gap1 <= 0 && px + PLAYER > bx && px < bx + b.w;
      const touch = x + PLAYER > b.x && x < b.x + b.w && y + PLAYER > b.y && y < b.y + b.h;
      if (!stomp && !touch) return p;
      if (star > 0 || stomp) {
        if (stomp && star <= 0) { stomps++; y = b.y - PLAYER; vy = -ADVENTURE.stompBounce; on = null; }
        return { ...p, enemy: null };
      }
      damage();
      return p;
    });
  }

  // 駕雲時敵人碰撞後仍套飛行界線,不會被修正回頂刺區。
  if (riding) {
    y = clamp(y, ADVENTURE.cloudTop, H - PLAYER);
    vy = 0;
    on = null;
  }

  // 5. 落地與踩頭修正位置後統一處理頂刺(第 5 關翻轉為底刺)。
  // 扣 1 命，穿過腳下平台被推開；無敵或護盾也必須修正位置。
  if (y < CEIL) {
    damage();
    drop = on ?? drop;
    on = null;
    y = CEIL;
    vy = Math.max(vy, PUSH_V);
  }

  if (adventure && lives > 0 && rideEnded && on === null && cloudUses > 0) {
    // 駕雲時間到:腳下生一朵靜止的雲接住,讓玩家有時間走回平台。
    cloudUses--;
    const n = -(++cloudSerial);
    const cloud = { n, x: clamp(x + PLAYER / 2 - ADVENTURE.cloudWidth / 2, 0, W - ADVENTURE.cloudWidth), y: y + PLAYER, w: ADVENTURE.cloudWidth, kind: 'cloud', flip: null, life: ADVENTURE.cloudLife };
    clouds.push(cloud);
    on = n;
    vy = 0;
  }
  if (cloudTime === 0) cloudUses = 0;

  // 6. 碰到愛心就撿起:生命 +1(上限 3);滿血也撿走但不加命(RS17)。
  let { hearts } = state;
  let picked = null;
  let coins = state.coins ?? 0;
  let stageCoins = state.stageCoins ?? 0;
  if (lives > 0) {
    platforms = platforms.map((p) => {
      if (!p.item || (!adventure && p.item !== 'heart')) return p;
      const b = heartBox(p);
      if (!(x + PLAYER > b.x && x < b.x + b.w && y + PLAYER > b.y && y < b.y + b.h)) return p;
      if (p.item === 'heart') {
        hearts += 1;
        picked = lives < MAX_LIVES ? 'heal' : 'full';
        lives = Math.min(MAX_LIVES, lives + 1);
      } else {
        picked = p.item;
        if (p.item === 'coin') { coins++; stageCoins++; }
        if (p.item === 'star') star = ADVENTURE.starSec;
        if (p.item === 'shield') shield = true;
        if (p.item === 'cloud') { cloudTime = ADVENTURE.cloudSec; cloudUses = ADVENTURE.cloudUses; }
      }
      return { ...p, item: null };
    });
  }

  const over = lives <= 0 || y > H; // 生命歸零或掉出底部
  const next = {
    ...state,
    player: { x, y, vy, on, drop, ...(adventure ? { vx: on !== null && platforms.find((p) => p.n === on)?.kind === 'ice' ? vx : dir * MOVE_SPEED } : {}) },
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
  if (!adventure) return next;
  Object.assign(next, { clouds, star, shield, cloudTime, cloudUses, cloudSerial, stomps, coins, stageCoins,
    stageTicks: state.stageTicks + 1, flagReached: state.flagReached || platforms.some((p) => p.flag && p.n === on) });
  if (stageComplete(next)) {
    next.stageCleared = true;
    next.cleared++;
    next.lives = Math.min(MAX_LIVES, next.lives + 1);
    next.paused = true;
    if (next.stage === STAGES.length) { next.over = true; next.won = true; }
  }
  return next;
}

// 遮罩:'ready' 開局未動 / 'paused' / 'over' / null。
export function overlayFor({ paused, over, ticks, mode, stageTicks, stageCleared }) {
  if (over) return 'over';
  if (stageCleared) return 'cleared';
  if (paused) return (mode === 'adventure' ? stageTicks : ticks) === 0 ? 'ready' : 'paused';
  return null;
}

// ---- 存檔(續玩)----

const SAVE_KEYS = ['player', 'platforms', 'seed', 'nextN', 'floors', 'lives', 'healAt', 'hearts', 'time', 'ticks', 'speed', 'difficulty'];
const ADVENTURE_KEYS = ['mode', 'stage', 'stageTicks', 'stageCoins', 'coins', 'bankedFloors', 'cleared', 'stageCleared', 'won', 'flagReached', 'stomps', 'star', 'shield', 'cloudTime', 'cloudUses', 'cloudSerial', 'clouds', 'hurt'];

export function toSave(state) {
  const keys = state.mode === 'adventure' ? [...SAVE_KEYS, ...ADVENTURE_KEYS] : [...SAVE_KEYS, 'mode'];
  return structuredClone(Object.fromEntries(keys.map((k) => [k, state[k]])));
}

// 還原後處於暫停狀態。RS17 之前的存檔沒有 item / hearts,補成「無道具、撿到 0 顆」。
export function fromSave(saved) {
  const s = structuredClone(saved);
  return {
    ...s,
    mode: s.mode ?? 'endless',
    platforms: s.platforms.map((p) => ({ ...p, item: p.item ?? null })),
    hearts: s.hearts ?? 0,
    hurt: s.mode === 'adventure' ? s.hurt : 0,
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

function validAdventure(saved) {
  if (!Number.isInteger(saved.stage) || saved.stage < 1 || saved.stage > STAGES.length) return false;
  if (!isObj(saved.player) || !Array.isArray(saved.platforms) || !saved.platforms.every(isObj) || !Array.isArray(saved.clouds) || !saved.clouds.every(isObj)) return false;
  const s = canonicalState(saved);
  const st = stageFor(s);
  const { player: p, platforms: ps, clouds } = s;
  if (s.difficulty !== 'normal' || s.speed !== st.speed || !isCount(s.seed) || s.seed > 0xffffffff) return false;
  if (!isCount(s.stageTicks) || !isCount(s.ticks) || s.ticks < s.stageTicks || !inRange(s.time, 0, 1e7) || Math.abs(s.time - s.stageTicks * DT) > 1e-6 * (s.stageTicks + 1)) return false;
  if (!isCount(s.cleared) || s.cleared !== s.stage - 1 + Number(s.stageCleared) || typeof s.stageCleared !== 'boolean' || s.won !== false || s.flagReached !== false) return false;
  if (s.stageCleared && (s.stage === STAGES.length || !stageComplete(s))) return false;
  if (!inRange(s.lives, 1, MAX_LIVES) || !Number.isInteger(s.lives)) return false;
  if (!['floors', 'stageCoins', 'coins', 'bankedFloors', 'stomps', 'hearts', 'cloudSerial'].every((k) => isCount(s[k])) || s.stageCoins > s.coins) return false;
  if (!inRange(s.star, 0, ADVENTURE.starSec) || !inRange(s.hurt, 0, HURT_SEC) || typeof s.shield !== 'boolean') return false;
  // IR48 前的存檔雲可接住 2 次;載入後依新規則只在駕雲結束時用 1 次。
  if (!inRange(s.cloudTime, 0, ADVENTURE.cloudSec) || !isCount(s.cloudUses) || s.cloudUses > 2 || (s.cloudTime === 0 && s.cloudUses !== 0)) return false;
  if (!Array.isArray(ps) || !ps.length || ps.length > 20) return false;
  const kinds = ['normal', ...st.kinds.map(([k]) => k)];
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (!isObj(q) || !isCount(q.n) || (i && q.n <= ps[i - 1].n) || !kinds.includes(q.kind) || ![2, 3, 4].includes(q.w) || !inRange(q.x, 0, W - q.w) || !inRange(q.y, -1, H + GAP)) return false;
    if (Math.abs(q.y - (START_Y + q.n * GAP - st.speed * s.time)) > 1e-6 * (s.stageTicks + 1)) return false;
    if (!(q.flip === null || (q.kind === 'flip' && inRange(q.flip, 0, FLIP_DELAY)))) return false;
    if (![1, -1].includes(q.motion) || typeof q.flag !== 'boolean' || q.flag !== (st.goal === 'flag' && q.n === st.target) || (q.flag && (q.kind !== 'normal' || q.item !== null || q.enemy !== null))) return false;
    if (q.item !== null && !['heart', 'coin', 'star', 'shield', 'cloud'].includes(q.item)) return false;
    if (q.item === 'heart' && q.kind !== 'normal' || q.item && q.kind === 'spike') return false;
    if (['star', 'shield', 'cloud'].includes(q.item) && !st[q.item]) return false;
    if (q.enemy !== null && (!st.enemy || !['normal', 'moving', 'ice'].includes(q.kind) || !isObj(q.enemy) || !inRange(q.enemy.offset, 0, q.w - ADVENTURE.enemySize) || ![-1, 1].includes(q.enemy.dir))) return false;
  }
  if (s.nextN !== ps.at(-1).n + 1 || s.floors >= s.nextN || s.stageCoins >= s.nextN) return false;
  if (!isCount(s.healAt) || s.healAt % HEAL_EVERY || s.healAt < HEAL_EVERY || s.healAt > s.floors + HEAL_EVERY) return false;
  // 重複取得寶物會補滿兩次，但已生成的雲仍保留到 1.5 秒到期。
  // 每步至多生一朵，因此存活平台數有自然上限。
  if (!Array.isArray(clouds) || clouds.length > Math.ceil(ADVENTURE.cloudLife / DT)) return false;
  const ids = new Set();
  for (const q of clouds) {
    if (!isObj(q) || !Number.isInteger(q.n) || q.n >= 0 || -q.n > s.cloudSerial || ids.has(q.n) || q.kind !== 'cloud' || q.w !== ADVENTURE.cloudWidth || q.flip !== null || !inRange(q.x, 0, W - q.w) || !inRange(q.y, -1, H + PLAYER) || !inRange(q.life, Number.EPSILON, ADVENTURE.cloudLife)) return false;
    ids.add(q.n);
  }
  if (!isObj(p) || !inRange(p.x, 0, W - PLAYER) || !inRange(p.y, CEIL, H) || !inRange(p.vy, -BOUNCE_V, MAX_FALL) || !inRange(p.vx, -MOVE_SPEED, MOVE_SPEED)) return false;
  if (p.on !== null) {
    const q = [...ps, ...clouds].find((q) => q.n === p.on);
    if (!q || Math.abs(p.y + PLAYER - q.y) > 1e-6 || p.vy !== 0) return false;
  }
  if (p.drop !== null && (!Number.isInteger(p.drop) || p.drop >= s.nextN || (p.drop < 0 && -p.drop > s.cloudSerial))) return false;
  return true;
}

export function isValidState(s) {
  if (!isObj(s)) return false;
  if (s.mode === 'adventure') return validAdventure(s);
  if (s.mode !== undefined && s.mode !== 'endless') return false;
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
