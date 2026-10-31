// 橫向越野機車純規則。x=前進距離、lanePos=車道插值、h=地面以上世界高度。
export const W = 16;
export const H = 12;
export const DT = 1 / 60;
export const TRACK_LEN = 4200;
export const LANES = 4;
export const COUNTDOWN = 3;
export const MAX_SPEED = 67.2;
export const ACCEL = 24;
export const BRAKE = 58;
export const COAST = 4.8;
export const LANE_SEC = 0.2;
export const CRASH_SEC = 1.5;
// 未定物理與投影數值集中於此,供 PM 調整。
export const SPRINT_MULT = 1.25;
export const SPRINT_SPEED = MAX_SPEED * SPRINT_MULT;
export const SPRINT_ACCEL = ACCEL * 1.6;
export const HEAT_UP = 30;
export const HEAT_THROTTLE_COOL = 10;
export const HEAT_IDLE_COOL = 25;
// RS42:只按油門且速度 ≥ 最高速 85% 時改為升溫(原為降溫);完美落地降溫。
export const HEAT_FAST_RATIO = 0.85;
export const HEAT_FAST_UP = 5;
export const PERFECT_COOL = 15;
export const OVERHEAT_SEC = 3;
export const GRAVITY = 32;
export const JUMP_BASE = 8;
export const JUMP_SPEED = 0.16;
export const TILT_SPEED = 100; // 度/秒,後仰正、前傾負。
export const ANGLE_LIMIT = 85;
export const PERFECT_DEG = 8;
export const SAFE_DEG = 25;
export const PERFECT_BOOST = 5;
export const NORMAL_LOSS = 0.2;
export const MAX_HEIGHT = 24;
export const MAX_AIR_SEC = 3;
export const HILL_HEIGHT = 2;
export const RAMP_HEIGHT = 4;
export const HEIGHT_SCALE = 0.16;
export const LAUNCH_DEG = 18;
export const COOLING_EVERY = 12; // RS42:冷卻點變稀疏,一路按油門(約 20 秒)才會在到達冷卻點前過熱。
export const G9_MAX_SPEED = 42;
export const G9_DIST_SCALE = 0.05;
export const G9_W = 9;
export const SCROLL_RATIO = 1.8; // 同畫布寬度的像素/秒比;衝刺為 2.25 倍。
export const DIST_SCALE = G9_DIST_SCALE * SCROLL_RATIO * G9_MAX_SPEED / MAX_SPEED * W / G9_W;
export const RIDER_X = 4;
export const LANE_Y = 5.5;
export const LANE_GAP = 1.35;
export const LANE_SKEW = 0.42;
export const ROAD_SKEW = 0.06; // 畫面斜視投影,不改世界地形高度。
export const PARALLAX = [0.14, 0.45, 1.15];
export const MUD_CAP = 0.5;
export const SEGMENT = 140;
export const FIRST_OBJECT = 180;
export const OBJECT_LENGTHS = { mud: 35, barrier: 8, ramp: 24, hill: 55, cooling: 6 };
export const CAR_GAP = 8;
export const CAR_HALF_LANE = 0.38;
// RS42:車輛相撞。相對速度 < RAM_CRASH_DIFF 擦撞(後車降為前車 70%、前車 +3),≥ 則後車摔車。
export const RAM_CRASH_DIFF = 25;
export const RAM_KEEP = 0.7;
export const RAM_PUSH = 3;
export const LANE_BUMP_LOSS = 0.1;
export const BUMP_SEC = 0.35;
// 被同車道慢車擋住時的提示:3 秒內第 2 次擦撞,提示「換個車道超車!」(顯示 1.5 秒,同一場每 10 秒最多一次)。
export const HINT_WINDOW = 3;
export const HINT_COOLDOWN = 10;
export const HINT_SEC = 1.5;
// RS42:跳台下限與種類(大跳台=kind 'ramp';高跳台高 1.5 倍、起跳垂直速度 ×1.25,飛得更遠)。
export const RAMP_MIN = { normal: 10, hard: 12, expert: 12 };
export const HIGH_RAMP_MIN = { normal: 0, hard: 2, expert: 3 };
export const COMBO_MIN = { normal: 1, hard: 2, expert: 2 };
export const HIGH_RAMP_HEIGHT = RAMP_HEIGHT * 1.5;
export const HIGH_RAMP_BOOST = 1.25;
export const COMBO_OFFSET = 124; // 連續跳台:第二個跳台起點 = 第一個起點 + 124(兩台間距 100)。
export const LANDING_CLEAR = 140; // 跳台尾端之後這段距離同車道不放路障/泥坑。
export const HIGH_LANDING_CLEAR = 170;
export const isHighRamp = (o) => o.kind === 'ramp' && o.height > RAMP_HEIGHT;
export const GHOST_INTERVAL = 0.1;
export const GHOST_LIMIT = 2000;
export const GHOST_MAX_LANE_DELTA = 1; // 0.1 秒內換道加上摔車回正,最多一條車道。
export const TIME_SEEDS = { normal: 9001, hard: 9002, expert: 9003 };
export const DIFFICULTIES = ['normal', 'hard', 'expert'];
export const MODES = ['race', 'time'];
// push=溫度允許時比巡航多衝的速度;aim=落地前先預估落點坡角再調整(RS42)。
export const LEVELS = {
  normal: { density: 0.38, target: 55, accuracy: 0.62, reaction: 48, heatLimit: 95, push: 3, aim: false },
  hard: { density: 0.58, target: 62, accuracy: 0.82, reaction: 66, heatLimit: 82, push: 4, aim: true },
  expert: { density: 0.78, target: 67, accuracy: 0.96, reaction: 86, heatLimit: 68, push: 14, aim: true },
};
export const AI_SPEED_OFFSETS = [-2, 0, 1];
export const PLACE_POINTS = [3000, 2000, 1000, 500];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const near = (a, b) => Math.abs(a - b) < 1e-6;

export function nextRandom(seed) {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

// 安全車道每段最多移一格,相鄰物件間留足換道距離。
// RS42:先照密度亂數鋪物件,再補到跳台下限、挑出連續跳台與高跳台、清掉落地區的路障/泥坑。
export function generateTrack(seed, difficulty = 'normal', rng) {
  const random = () => {
    if (rng) return rng();
    let r;
    [r, seed] = nextRandom(seed);
    return r;
  };
  const level = LEVELS[difficulty];
  let safe = Math.floor(random() * LANES);
  const segs = [];
  for (let x = FIRST_OBJECT; x < TRACK_LEN - SEGMENT; x += SEGMENT) {
    safe = clamp(safe + Math.floor(random() * 3) - 1, 0, LANES - 1);
    const cells = Array.from({ length: LANES }, () => null);
    for (let lane = 0; lane < LANES; lane++) {
      if (lane === safe || random() >= level.density) continue;
      const r = random();
      cells[lane] = { kind: r < 0.18 ? 'mud' : r < 0.42 ? 'barrier' : r < 0.74 ? 'ramp' : 'hill', combo: false, high: false };
    }
    segs.push({ x, safe, cells });
  }
  const pick = (n) => Math.min(n - 1, Math.floor(random() * n));
  const ramps = () => segs.reduce((n, g) => n + g.cells.filter((c) => c?.kind === 'ramp').length, 0);
  // 1. 補到跳台下限(亂數挑空格,挑不到就依序掃描,保證結束)。
  const place = (min) => {
    for (let tries = 0; ramps() < min && tries < 200; tries++) {
      const g = segs[pick(segs.length)], lane = pick(LANES);
      if (lane !== g.safe && !g.cells[lane]) g.cells[lane] = { kind: 'ramp', combo: false, high: false };
    }
    // 空格不夠(退化亂數把格子鋪滿)時,把路障/泥坑/土坡改成跳台,仍保證下限。
    for (const empty of [true, false]) for (const g of segs) for (let lane = 0; lane < LANES && ramps() < min; lane++)
      if (lane !== g.safe && (empty ? !g.cells[lane] : g.cells[lane].kind !== 'ramp')) g.cells[lane] = { kind: 'ramp', combo: false, high: false };
  };
  place(RAMP_MIN[difficulty]);
  // 2. 連續跳台:同車道下一段清空(第二個跳台落在那裡),且不得落在下一段的安全車道上。
  const comboCandidates = () => segs.flatMap((g, i) => i + 1 < segs.length ? g.cells.flatMap((c, lane) =>
    c?.kind === 'ramp' && !c.combo && !c.high && lane !== segs[i + 1].safe && segs[i + 1].cells[lane]?.kind !== 'ramp'
      ? [[i, lane]] : []) : []);
  for (let n = 0; n < COMBO_MIN[difficulty]; n++) {
    const list = comboCandidates(); if (!list.length) break;
    const [i, lane] = list[pick(list.length)];
    segs[i].cells[lane].combo = true; segs[i + 1].cells[lane] = null;
  }
  // 3. 高跳台:困難以上才有;從不屬於連續組的跳台挑。
  for (let n = 0; n < HIGH_RAMP_MIN[difficulty]; n++) {
    const list = segs.flatMap((g, i) => g.cells.flatMap((c, lane) => c?.kind === 'ramp' && !c.combo && !c.high ? [[i, lane]] : []));
    if (!list.length) break;
    const [i, lane] = list[pick(list.length)]; segs[i].cells[lane].high = true;
  }
  // 4. 落地區不放路障/泥坑(同車道,跳台尾端之後 LANDING_CLEAR);連續跳台的第二台一併處理。
  const objects = [];
  const add = (lane, x, kind, height) => objects.push({ id: 0, lane, x, kind, length: OBJECT_LENGTHS[kind], height });
  segs.forEach((g) => g.cells.forEach((c, lane) => {
    if (!c) return;
    const height = c.kind === 'hill' ? HILL_HEIGHT : c.kind === 'ramp' ? (c.high ? HIGH_RAMP_HEIGHT : RAMP_HEIGHT) : 0;
    add(lane, g.x, c.kind, height);
    if (c.combo) add(lane, g.x + COMBO_OFFSET, 'ramp', RAMP_HEIGHT);
  }));
  const hazards = new Set();
  for (const o of objects.filter((o) => o.kind === 'ramp')) {
    const end = o.x + o.length, clear = o.height > RAMP_HEIGHT ? HIGH_LANDING_CLEAR : LANDING_CLEAR;
    for (const h of objects) if (['barrier', 'mud'].includes(h.kind) && h.lane === o.lane && h.x > o.x && h.x < end + clear) hazards.add(h);
  }
  const track = objects.filter((o) => !hazards.has(o));
  // 冷卻標誌在段落間,全車道可用;不會占用安全車道。
  for (let x = FIRST_OBJECT + SEGMENT / 2; x < TRACK_LEN - SEGMENT; x += SEGMENT * COOLING_EVERY)
    track.push({ id: 0, lane: -1, x, kind: 'cooling', length: OBJECT_LENGTHS.cooling, height: 0 });
  track.sort((a, b) => a.x - b.x || a.lane - b.lane);
  track.forEach((o, i) => { o.id = i; });
  return track;
}

const vehicle = (id, lane) => ({
  id, lane, lanePos: lane, from: lane, laneLeft: 0, x: 0, speed: 0,
  crash: 0, air: 0, h: 0, vy: 0, angle: 0, heat: 0, overheat: 0,
  sprinting: false, landing: null, mud: false, lastObject: null, seen: null, finishAt: null,
  bump: 0, ram: false, avoid: null, // RS42:碰撞閃爍計時、因追撞摔車、電腦車已處理過的前車
  hitAt: null, hintAt: null, // RS42:玩家上次擦撞(當後車)的時刻、上次出現「換道超車」提示的時刻(只有玩家會填)
});

export function initState(rng = Math.random, difficulty = 'normal', mode = 'race') {
  difficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
  mode = MODES.includes(mode) ? mode : 'race';
  const seed = mode === 'time' ? TIME_SEEDS[difficulty] : Math.floor(rng() * 4294967296) >>> 0;
  return {
    difficulty, mode, seed, rngSeed: seed, track: generateTrack(seed, difficulty),
    vehicles: Array.from({ length: mode === 'race' ? 4 : 1 }, (_, i) => vehicle(i, i)),
    countdown: COUNTDOWN, time: 0, ticks: 0, moves: 0, paused: true, over: false,
    recording: mode === 'time' ? [{ x: 0, lane: 0, h: 0 }] : [],
  };
}

export const pauseState = (s) => s.over || s.paused ? s : { ...s, paused: true };
export const resumeState = (s) => s.over || !s.paused ? s : { ...s, paused: false };
export const overlayFor = (s) => s.over ? 'over' : s.paused ? (s.ticks ? 'paused' : 'ready') : null;
export const playerOf = (s) => s.vehicles[0];

function changeLane(v, dir) {
  if (!dir || v.air > 0 || v.overheat > 0 || v.crash > 0 || v.laneLeft > 0) return;
  const lane = clamp(v.lane + Math.sign(dir), 0, LANES - 1);
  if (lane === v.lane) return;
  v.from = v.lanePos;
  v.lane = lane;
  v.laneLeft = LANE_SEC;
}

// 以目前速度與垂直速度估計落點,回傳該處坡角(高難度電腦車與「會玩」機器人用來對準落地角度)。
export function landingSlope(v, track) {
  let h = terrainAt(v.x, v.lanePos, track).h, t = 0;
  for (let k = 0; k < 3; k++) {
    t = (v.vy + Math.sqrt(Math.max(0, v.vy * v.vy + 2 * GRAVITY * (v.h - h)))) / GRAVITY;
    h = terrainAt(v.x + v.speed * t, v.lanePos, track).h;
  }
  return terrainAt(v.x + v.speed * t, v.lanePos, track).angle;
}
const hazardOn = (track, lane, from, to) => track.some((o) => ['barrier', 'mud'].includes(o.kind) && o.lane === lane
  && o.x + o.length >= from && o.x <= to);

function aiInput(v, s, random) {
  const level = LEVELS[s.difficulty];
  // 目標車道前方沒有障礙,旁邊也沒有緊貼的車。
  const free = (lane) => lane >= 0 && lane < LANES && !hazardOn(s.track, lane, v.x, v.x + level.reaction)
    && !s.vehicles.some((o) => o.id !== v.id && solid(o) && Math.abs(o.lanePos - lane) <= CAR_HALF_LANE * 2
      && o.x > v.x - CAR_GAP * 2 && o.x < v.x + CAR_GAP * 3);
  const obstacle = s.track.find((o) => ['barrier', 'mud'].includes(o.kind) && o.lane === v.lane
    && o.x >= v.x && o.x - v.x <= level.reaction && o.id !== v.seen);
  if (obstacle && !v.air && !v.crash && !v.laneLeft) {
    v.seen = obstacle.id; // 每個障礙只作一次反應,不因 fps 重抽機率。
    if (random() < level.accuracy) {
      const safe = [-1, 1].filter((d) => free(v.lane + d));
      if (safe.length) changeLane(v, safe[Math.floor(random() * safe.length)]);
    }
  }
  // RS42:前方有慢車就試著換道繞開;每台前車只作一次反應。
  const slow = s.vehicles.find((o) => o.id !== v.id && solid(o) && Math.abs(o.lanePos - v.lanePos) <= CAR_HALF_LANE * 2
    && o.x > v.x && o.x - v.x <= level.reaction * 0.6 && v.speed > o.speed + 2);
  if (!slow) v.avoid = null;
  else if (v.avoid !== slow.id && !v.air && !v.crash && !v.laneLeft) {
    v.avoid = slow.id;
    if (random() < level.accuracy) {
      const safe = [-1, 1].filter((d) => free(v.lane + d));
      if (safe.length) changeLane(v, safe[Math.floor(random() * safe.length)]);
    }
  }
  // 溫度允許時衝刺並追加 push;溫度到 heatLimit 就鬆油門(滑行降溫),再靠 -25/s 回來。
  const cool = v.heat < level.heatLimit, cruise = level.target + AI_SPEED_OFFSETS[v.id - 1];
  const goal = cool ? cruise + level.push : cruise;
  const ground = terrainAt(v.x + v.speed * DT, v.lanePos, s.track);
  const aim = v.air ? (level.aim ? landingSlope(v, s.track) : ground.angle) : 0;
  return { throttle: v.speed < goal && (cool || v.speed < MAX_SPEED * HEAT_FAST_RATIO),
    brake: v.speed > cruise + level.push + 1, sprint: cool && v.speed < goal,
    tilt: v.air ? Math.sign(aim - v.angle) * Math.min(1, Math.abs(aim - v.angle) / (TILT_SPEED * DT)) : 0 };
}

// 同一地形供物理、落地角度與繪圖使用;車道間高度線性插值。
export function terrainAt(x, lanePos, track) {
  let h = 0, slope = 0;
  for (const o of track) {
    if (!['hill', 'ramp'].includes(o.kind) || x < o.x || x >= o.x + o.length) continue;
    const weight = Math.max(0, 1 - Math.abs(lanePos - o.lane));
    const t = (x - o.x) / o.length;
    const phase = t * Math.PI * (o.kind === 'hill' ? 2 : 0.5);
    const height = o.kind === 'hill' ? o.height * (1 - Math.cos(phase)) / 2 : o.height * Math.sin(phase);
    const derivative = o.kind === 'hill' ? o.height * Math.PI * Math.sin(phase) / o.length
      : o.height * Math.PI / 2 * Math.cos(phase) / o.length;
    h += height * weight; slope += derivative * weight;
  }
  return { h, angle: Math.atan(slope * HEIGHT_SCALE / DIST_SCALE) * 180 / Math.PI };
}
export function landingFor(angle, slope) {
  const difference = Math.abs(angle - slope);
  return difference <= PERFECT_DEG ? 'perfect' : difference <= SAFE_DEG ? 'normal' : 'crash';
}
function crashVehicle(v, objectId = v.lastObject, ram = false) {
  v.speed = 0; v.crash = CRASH_SEC; v.air = 0; v.vy = 0; v.mud = false;
  v.sprinting = false; v.laneLeft = 0; v.from = v.lane; v.lanePos = v.lane;
  v.lastObject = objectId; v.ram = ram;
}
// 摔車中的車手已離開機車,不參與相撞;其餘在地面的車都是實體。
const solid = (v) => v.air === 0 && v.crash === 0 && v.finishAt === null;
function advanceVehicle(v, old, input, track, dt) {
  v.landing = null; v.sprinting = false;
  v.bump = Math.max(0, v.bump - dt);
  if (v.bump < 1e-9) v.bump = 0;
  if (v.finishAt !== null) return;
  if (v.overheat > 0) {
    v.overheat = Math.max(0, v.overheat - dt);
    if (v.overheat < 1e-9) v.overheat = 0;
    v.heat = 100 * v.overheat / OVERHEAT_SEC;
    v.speed = 0;
    return;
  }
  // RS42:只按油門時,速度 ≥ 最高速 85% 升溫、低於則降溫;煞車等同放開油門。
  const braking = input.brake || (input.left && !v.air);
  const heating = input.sprint && !v.crash ? HEAT_UP
    : input.throttle && !braking ? (v.speed >= MAX_SPEED * HEAT_FAST_RATIO ? HEAT_FAST_UP : -HEAT_THROTTLE_COOL) : -HEAT_IDLE_COOL;
  v.heat = clamp(v.heat + heating * dt, 0, 100);
  if (v.heat >= 100 - 1e-9) {
    v.heat = 100; v.overheat = OVERHEAT_SEC; v.speed = 0;
    // 強制停車時回到當前坡面,避免停在半空。
    v.air = 0; v.vy = 0; v.mud = false;
    const ground = terrainAt(v.x, v.lanePos, track); v.h = ground.h; v.angle = ground.angle;
    return;
  }
  if (v.crash > 0) {
    v.crash = Math.max(0, v.crash - dt);
    if (v.crash < 1e-9) v.crash = 0;
    v.speed = 0;
    if (!v.crash) {
      v.ram = false;
      const ground = terrainAt(v.x, v.lanePos, track);
      v.h = ground.h; v.angle = ground.angle;
    }
    return;
  }
  const tilt = input.tilt ?? ((input.up || input.left ? 1 : 0) - (input.down || input.right ? 1 : 0));
  changeLane(v, input.dir ?? ((input.down ? 1 : 0) - (input.up ? 1 : 0)));
  v.laneLeft = Math.max(0, v.laneLeft - dt);
  if (v.laneLeft < 1e-9) v.laneLeft = 0;
  v.lanePos = v.laneLeft > 0 ? v.lane + (v.from - v.lane) * v.laneLeft / LANE_SEC : v.lane;
  if (!v.laneLeft) v.from = v.lane;
  v.mud = !v.air && track.some((o) => o.kind === 'mud' && Math.abs(v.lanePos - o.lane) <= CAR_HALF_LANE
    && v.x >= o.x && v.x <= o.x + o.length);
  v.sprinting = !!input.sprint && !input.brake && !(input.left && !v.air);
  const cap = v.mud ? MAX_SPEED * MUD_CAP : v.sprinting ? SPRINT_SPEED : MAX_SPEED;
  const acceleration = input.brake || (input.left && !v.air) ? -BRAKE
    : v.sprinting ? SPRINT_ACCEL : input.throttle ? ACCEL : -COAST;
  v.speed = v.speed > cap && !v.mud && acceleration >= -COAST
    ? Math.max(cap, v.speed - COAST * dt) : clamp(v.speed + acceleration * dt, 0, cap);
  v.x += v.speed * dt;
  const ground = terrainAt(v.x, v.lanePos, track);
  if (v.air > 0) {
    v.angle = clamp(v.angle + tilt * TILT_SPEED * dt, -ANGLE_LIMIT, ANGLE_LIMIT);
    v.h += v.vy * dt - GRAVITY * dt * dt / 2;
    v.vy -= GRAVITY * dt; v.air += dt;
    if (v.h <= ground.h && v.vy <= 0) {
      v.air = 0; v.h = ground.h; v.vy = 0;
      v.landing = landingFor(v.angle, ground.angle);
      if (v.landing === 'crash') {
        crashVehicle(v);
        v.h = terrainAt(v.x, v.lanePos, track).h;
      }
      else {
        v.speed = Math.min(v.landing === 'perfect' ? SPRINT_SPEED : cap, v.speed * (1 - NORMAL_LOSS * Math.abs(v.angle - ground.angle) / SAFE_DEG)
          + (v.landing === 'perfect' ? PERFECT_BOOST : 0));
        if (v.landing === 'perfect') v.heat = Math.max(0, v.heat - PERFECT_COOL);
      }
      v.angle = ground.angle;
    }
  } else { v.h = ground.h; v.angle = ground.angle; }
  for (const o of track) {
    if (o.kind === 'cooling') {
      if (old.x <= o.x + o.length && v.x >= o.x) v.heat = 0;
      continue;
    }
    if (o.kind === 'hill' || v.crash || v.air || o.id === v.lastObject) continue;
    let enter = 0, leave = 1;
    for (const [start, end, lo, hi] of [
      [old.x, v.x, o.kind === 'ramp' ? o.x + o.length : o.x, o.x + o.length],
      [old.lanePos, v.lanePos, o.lane - CAR_HALF_LANE, o.lane + CAR_HALF_LANE],
    ]) {
      if (end === start) { if (start < lo || start > hi) leave = -1; }
      else {
        const a = (lo - start) / (end - start), b = (hi - start) / (end - start);
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter > leave) continue;
    // 起跳前已騰空的路徑只在落地點檢查,不能追溯撞到飛越的障礙。
    if (old.air && !(v.x >= o.x && v.x <= o.x + o.length
      && Math.abs(v.lanePos - o.lane) <= CAR_HALF_LANE)) continue;
    if (o.kind === 'mud') { v.mud = true; v.speed = Math.min(v.speed, MAX_SPEED * MUD_CAP); }
    else if (o.kind === 'ramp' && v.speed > 0) {
      v.air = dt * Math.max(0.001, 1 - enter);
      v.vy = (JUMP_BASE + JUMP_SPEED * v.speed) * (isHighRamp(o) ? HIGH_RAMP_BOOST : 1);
      v.h = o.height; v.angle = LAUNCH_DEG;
      v.mud = false; v.lastObject = o.id;
    } else if (o.kind === 'barrier') {
      v.x = old.air ? v.x : old.x + (v.x - old.x) * enter;
      v.lane = o.lane; crashVehicle(v, o.id); v.h = terrainAt(v.x, v.lanePos, track).h;
      break;
    }
  }
}

export function ranking(s) {
  return [...s.vehicles].sort((a, b) => {
    if (a.finishAt !== null || b.finishAt !== null) {
      if (a.finishAt === null) return 1;
      if (b.finishAt === null) return -1;
      return a.finishAt - b.finishAt || a.id - b.id;
    }
    return b.x - a.x || a.id - b.id;
  }).map((v) => v.id);
}

export function scoreFor(mode, place, seconds) {
  return (mode === 'time' ? 1000 : PLACE_POINTS[place - 1]) + Math.floor(Math.max(0, 150 - seconds) * 10);
}
export function resultFor(s, quit = false) {
  const place = s.mode === 'time' ? null : ranking(s).indexOf(0) + 1;
  return {
    result: quit ? 'quit' : s.mode === 'time' || place === 1 ? 'win' : 'lose',
    score: quit ? 0 : scoreFor(s.mode, place, s.time), difficulty: s.difficulty,
    detail: { mode: s.mode, place, ms: Math.round(s.time * 1000) },
  };
}

// 速度上限(撞擊推前車時不超過):泥坑/衝刺/一般;已超速(衝刺餘速)的不再加。
const capOf = (v) => Math.max(v.speed, v.mud ? MAX_SPEED * MUD_CAP : v.sprinting ? SPRINT_SPEED : MAX_SPEED);
function settle(v, track) {
  const ground = terrainAt(v.x, v.lanePos, track);
  v.h = ground.h; v.angle = ground.angle;
}
// 換道撞車:換道動畫倒轉回原車道(lanePos 連續),速度 -10%。
function bounce(v) {
  const elapsed = LANE_SEC - v.laneLeft, target = v.lane;
  v.lane = v.from; v.from = target; v.laneLeft = elapsed;
  v.speed *= 1 - LANE_BUMP_LOSS; v.bump = BUMP_SEC;
}
// RS42:同車道、都在地面的車相撞;騰空與摔車中的車不參與,影子車完全不參與。
// 前車先處理,降速可以向後傳遞。
// 玩家當後車的擦撞紀錄:3 秒內第 2 次且距上次提示 ≥ 10 秒 ⇒ 記下提示時刻(畫面據此顯示)。
function noteHit(v, now) {
  if (v.hitAt !== null && now - v.hitAt <= HINT_WINDOW && (v.hintAt === null || now - v.hintAt >= HINT_COOLDOWN)) v.hintAt = now;
  v.hitAt = now;
}
export const hintActive = (s) => playerOf(s).hintAt !== null && s.time - playerOf(s).hintAt < HINT_SEC;
function collide(s, state, now) {
  const cars = s.vehicles, old = (v) => state.vehicles[v.id];
  const bounced = new Set();
  const contact = (a, b) => Math.abs(a.x - b.x) < CAR_GAP && Math.abs(a.lanePos - b.lanePos) <= CAR_HALF_LANE * 2;
  // 換道途中第一次碰到車(不論先橫向重疊或先縱向接近):朝對方移動、還在換道的那台被彈回,不算追撞。
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (!solid(a) || !solid(b) || !contact(a, b) || contact(old(a), old(b))) continue;
    for (const [v, other] of [[a, b], [b, a]]) {
      const moved = v.lanePos - old(v).lanePos, toward = old(other).lanePos - old(v).lanePos;
      if (v.laneLeft > 0 && moved * toward > 0) { bounce(v); bounced.add(v.id); }
    }
  }
  const ahead = [...cars].sort((a, b) => old(b).x - old(a).x || a.id - b.id);
  for (let i = 1; i < ahead.length; i++) {
    const rear = ahead[i];
    for (let j = 0; j < i; j++) {
      const front = ahead[j];
      if (!solid(front) || !solid(rear) || bounced.has(front.id) || bounced.has(rear.id)
        || Math.abs(front.lanePos - rear.lanePos) > CAR_HALF_LANE * 2
        // 橫向正在拉開(剛被彈回):不算追撞。
        || Math.abs(front.lanePos - rear.lanePos) > Math.abs(old(front).lanePos - old(rear).lanePos) + 1e-9
        || front.x - rear.x >= CAR_GAP || rear.speed <= front.speed) continue;
      const diff = rear.speed - front.speed;
      rear.x = Math.max(old(rear).x, front.x - CAR_GAP);
      rear.bump = front.bump = BUMP_SEC;
      if (diff >= RAM_CRASH_DIFF) { crashVehicle(rear, rear.lastObject, true); }
      else {
        rear.speed = front.speed * RAM_KEEP;
        if (rear.id === 0) noteHit(rear, now);
        // 過熱停車中的前車不被推動(過熱時速度必須維持 0)。
        if (!front.overheat) front.speed = Math.min(capOf(front), front.speed + RAM_PUSH);
      }
      settle(rear, s.track);
    }
  }
}

// UI 使用 DT 累積器;測試可傳 dt 或注入 rng。預設亂數序列完整存在 state 中。
export function stepState(state, input = {}, dt = DT, rng) {
  if (state.paused || state.over || !Number.isFinite(dt) || dt <= 0 || dt > 0.25) return state;
  const s = { ...state, vehicles: state.vehicles.map((v) => ({ ...v })), ticks: state.ticks + 1 };
  if (state.countdown > 0) {
    s.countdown = Math.max(0, state.countdown - dt);
    if (s.countdown < 1e-9) s.countdown = 0;
    return s; // 倒數中的輸入完全忽略。
  }
  const random = () => {
    let r;
    [r, s.rngSeed] = nextRandom(s.rngSeed);
    return rng ? rng() : r;
  };
  if (input.throttle || input.sprint || input.brake || input.dir || input.up || input.down || input.left || input.right || input.tilt) s.moves++;
  s.vehicles.forEach((v, i) => {
    const controls = i === 0 ? input : aiInput(v, s, random);
    advanceVehicle(v, state.vehicles[i], controls, s.track, dt);
  });
  collide(s, state, state.time + dt);
  s.time += dt;
  for (const v of s.vehicles) {
    if (v.finishAt === null && v.x >= TRACK_LEN) {
      const old = state.vehicles[v.id];
      const fraction = clamp((TRACK_LEN - old.x) / (v.x - old.x), 0, 1);
      v.finishAt = state.time + dt * fraction;
      v.x = TRACK_LEN;
    }
  }
  const player = playerOf(s);
  if (player.finishAt !== null) {
    s.over = true;
    s.time = player.finishAt;
    for (const v of s.vehicles.slice(1)) {
      if (state.vehicles[v.id].finishAt !== null) continue;
      if (v.finishAt !== null && v.finishAt <= s.time) continue;
      const fraction = (s.time - state.time) / dt;
      const oldY = state.vehicles[v.id].x;
      const endY = v.finishAt !== null ? oldY + (TRACK_LEN - oldY) * dt / (v.finishAt - state.time) : v.x;
      v.finishAt = null;
      v.x = oldY + (endY - oldY) * fraction;
    }
  }
  if (s.mode === 'time') {
    s.recording = [...state.recording];
    while (s.recording.length < GHOST_LIMIT && s.recording.length * GHOST_INTERVAL <= s.time + 1e-9) {
      const fraction = clamp((s.recording.length * GHOST_INTERVAL - state.time) / dt, 0, 1);
      const old = playerOf(state);
      s.recording.push({ x: old.x + (player.x - old.x) * fraction,
        lane: old.lanePos + (player.lanePos - old.lanePos) * fraction, h: old.h + (player.h - old.h) * fraction });
    }
  }
  return s;
}

const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const uint = (v) => Number.isInteger(v) && num(v, 0, 0xffffffff);
const sample = (p) => obj(p) && num(p.lane, 0, 3) && num(p.x, 0, TRACK_LEN) && num(p.h, 0, MAX_HEIGHT);
function validSamples(list) {
  return Array.isArray(list) && list.length > 0 && list.length <= GHOST_LIMIT
    && list.every((p, i) => sample(p) && (i === 0 ? p.x === 0 && p.lane === 0 && p.h === 0 : p.x >= list[i - 1].x
      && p.x - list[i - 1].x <= SPRINT_SPEED * GHOST_INTERVAL + 1e-6
      && Math.abs(p.lane - list[i - 1].lane) <= GHOST_MAX_LANE_DELTA + 1e-6
      && Math.abs(p.h - list[i - 1].h) <= MAX_HEIGHT));
}
export function isValidGhost(g) {
  // ms 四捨五入後可能剛好落在採樣邊界;允許半毫秒內的兩種筆數。
  const countAt = (seconds) => Math.min(GHOST_LIMIT, Math.floor((seconds + 1e-9) / GHOST_INTERVAL) + 1);
  return obj(g) && num(g.ms, TRACK_LEN / SPRINT_SPEED * 1000, 1e10) && Number.isInteger(g.ms)
    && validSamples(g.samples) && g.samples.length >= countAt(g.ms / 1000 - 0.0005)
    && g.samples.length <= countAt(g.ms / 1000 + 0.0005)
    && TRACK_LEN - g.samples.at(-1).x <= SPRINT_SPEED
      * (g.ms / 1000 + 0.0005 - (g.samples.length - 1) * GHOST_INTERVAL) + 1e-6;
}
export function ghostFor(s) {
  return s.mode === 'time' && s.over ? { ms: Math.round(s.time * 1000), samples: structuredClone(s.recording) } : null;
}
export function betterGhost(current, candidate) {
  return isValidGhost(candidate) && (!isValidGhost(current) || candidate.ms < current.ms) ? candidate : current;
}
// RS49:影子抵達位置 x 的時間(秒);只在已記錄的點之間插值,⛔ 外推。
// 採樣沒被截斷時,最後一點到終點(不足一個採樣間隔)以終點時間補齊;紀錄超過 GHOST_LIMIT 筆被截斷時,
// 超出已記錄範圍的位置回傳 null(不顯示秒差),不捏造。無影子或超出賽道也回傳 null。
export function ghostArrival(g, x) {
  if (!g || !Array.isArray(g.samples) || !g.samples.length || !Number.isFinite(x) || x < 0 || x > TRACK_LEN) return null;
  const n = g.samples.length;
  const truncated = n >= GHOST_LIMIT && g.ms / 1000 > n * GHOST_INTERVAL + 1e-9;
  if (truncated && x > g.samples[n - 1].x) return null;
  const count = truncated ? n : n + 1;
  const at = (i) => i < n ? { x: g.samples[i].x, t: i * GHOST_INTERVAL } : { x: TRACK_LEN, t: g.ms / 1000 };
  let lo = 0, hi = count; // 第一個 x >= 目標的點(未截斷時含補齊的終點)。
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid).x >= x) hi = mid; else lo = mid + 1;
  }
  if (lo === 0) return 0;
  const a = at(lo - 1), b = at(lo);
  return b.x === a.x ? b.t : a.t + (b.t - a.t) * (x - a.x) / (b.x - a.x);
}
// 正=玩家領先影子(較早到同一位置),負=落後;沒有影子時 null。
export function ghostLead(g, x, seconds) {
  const arrival = ghostArrival(g, x);
  return arrival === null ? null : arrival - seconds;
}
export const leadLabel = (lead) => lead === null || !Number.isFinite(lead) ? null
  : `${lead >= 0 ? '領先' : '落後'} ${Math.abs(lead).toFixed(1)} 秒`;
export function ghostAt(g, seconds) {
  if (!g || seconds * 1000 > g.ms || seconds < 0) return null;
  const at = seconds / GHOST_INTERVAL;
  if (at > g.samples.length - 1 && g.samples.length === GHOST_LIMIT) return null;
  const i = Math.min(Math.floor(at), g.samples.length - 1);
  const a = g.samples[i], b = g.samples[Math.min(i + 1, g.samples.length - 1)];
  const f = at - Math.floor(at);
  return { x: a.x + (b.x - a.x) * f, lane: a.lane + (b.lane - a.lane) * f, h: a.h + (b.h - a.h) * f };
}

const SAVE_KEYS = ['difficulty', 'mode', 'seed', 'rngSeed', 'track', 'vehicles', 'countdown', 'time', 'ticks', 'moves', 'recording'];
export const toSave = (s) => structuredClone(Object.fromEntries(SAVE_KEYS.map((k) => [k, s[k]])));
export const fromSave = (s) => ({ ...structuredClone(s), paused: true, over: false });

export function isValidState(s) {
  if (!obj(s) || !DIFFICULTIES.includes(s.difficulty) || !MODES.includes(s.mode) || !uint(s.seed) || !uint(s.rngSeed)
    || !uint(s.ticks) || !uint(s.moves) || s.moves > s.ticks || !num(s.time, 0, 1e7) || !num(s.countdown, 0, COUNTDOWN)
    || s.time + COUNTDOWN - s.countdown > s.ticks * 0.25 + 1e-6
    || (s.countdown > 0 && (s.time !== 0 || s.moves !== 0))) return false;
  if (s.mode === 'time' && s.seed !== TIME_SEEDS[s.difficulty]) return false;
  const expected = generateTrack(s.seed, s.difficulty);
  if (!Array.isArray(s.track) || s.track.length !== expected.length
    || !s.track.every((o, i) => obj(o) && ['id', 'lane', 'x', 'kind', 'length', 'height'].every((k) => o[k] === expected[i][k]))) return false;
  if (!Array.isArray(s.vehicles) || s.vehicles.length !== (s.mode === 'time' ? 1 : 4)) return false;
  if (!s.vehicles.every((v, i) => {
    if (!obj(v) || v.id !== i || !Number.isInteger(v.lane) || !num(v.lane, 0, 3) || !num(v.lanePos, 0, 3)
      || !Number.isInteger(v.from) || !num(v.from, 0, 3) || !num(v.x, 0, TRACK_LEN)
      || !num(v.speed, 0, SPRINT_SPEED) || !num(v.laneLeft, 0, LANE_SEC) || !num(v.crash, 0, CRASH_SEC)
      || !num(v.air, 0, MAX_AIR_SEC) || !num(v.h, 0, MAX_HEIGHT) || !num(v.vy, -GRAVITY * MAX_AIR_SEC, (JUMP_BASE + JUMP_SPEED * SPRINT_SPEED) * HIGH_RAMP_BOOST)
      || !num(v.angle, -ANGLE_LIMIT, ANGLE_LIMIT) || !num(v.heat, 0, 100) || !num(v.overheat, 0, OVERHEAT_SEC)
      || typeof v.mud !== 'boolean' || typeof v.sprinting !== 'boolean' || typeof v.ram !== 'boolean' || !num(v.bump, 0, BUMP_SEC)
      || (v.avoid !== null && (!Number.isInteger(v.avoid) || !num(v.avoid, 0, 3) || v.avoid === i))
      || (v.hitAt !== null && !num(v.hitAt, 0, s.time + 1e-6)) || (v.hintAt !== null && (v.hitAt === null || !num(v.hintAt, 0, v.hitAt + 1e-6)))
      || (i !== 0 && (v.hitAt !== null || v.hintAt !== null))
      || ![null, 'perfect', 'normal', 'crash'].includes(v.landing)) return false;
    if (!near(v.lanePos, v.lane + (v.from - v.lane) * v.laneLeft / LANE_SEC) || Math.abs(v.from - v.lane) > 1
      || (!v.laneLeft && v.from !== v.lane)
      || (v.air > 0 && (v.crash || v.overheat || v.mud))
      || (v.crash > 0 && (v.speed || v.laneLeft || v.mud || v.sprinting)) || (v.ram && !v.crash)
      || (v.overheat > 0 && (v.speed || v.sprinting || !near(v.heat, 100 * v.overheat / OVERHEAT_SEC)))
      || (v.mud && v.speed > MAX_SPEED * MUD_CAP + 1e-6)) return false;
    const ground = terrainAt(v.x, v.lanePos, s.track);
    if ((!v.air && (!near(v.h, ground.h) || v.vy !== 0)) || (v.air && v.h < ground.h - 1e-6)) return false;
    if (!v.air && !v.crash && !near(v.angle, ground.angle)) return false;
    for (const k of ['lastObject', 'seen'])
      if (v[k] !== null && (!Number.isInteger(v[k]) || !s.track.some((o) => o.id === v[k]))) return false;
    const last = s.track.find((o) => o.id === v.lastObject);
    if (last && last.x > v.x + 1e-6) return false;
    if (v.air && (!last || last.kind !== 'ramp'
      || v.x - last.x > last.length + SPRINT_SPEED * MAX_AIR_SEC
      || Math.abs(v.lanePos - last.lane) > CAR_HALF_LANE + Math.min(1, v.air / LANE_SEC) + 1e-6)) return false;
    if (v.crash && !v.ram && (!last || !['barrier', 'ramp'].includes(last.kind))) return false;
    if (v.finishAt !== null && (!num(v.finishAt, TRACK_LEN / SPRINT_SPEED, s.time) || v.x !== TRACK_LEN || i === 0)) return false;
    if (v.finishAt === null && v.x === TRACK_LEN) return false;
    if (s.time === 0 && (v.x || v.speed || v.lane !== i || v.lanePos !== i || v.crash || v.air || v.laneLeft
      || v.h || v.vy || v.angle || v.heat || v.overheat || v.sprinting || v.landing !== null || v.lastObject !== null || v.seen !== null
      || v.bump || v.ram || v.avoid !== null || v.hitAt !== null || v.hintAt !== null)) return false;
    return v.x <= SPRINT_SPEED * s.time + 1e-6;
  })) return false;
  if (s.mode === 'race') return Array.isArray(s.recording) && s.recording.length === 0;
  return validSamples(s.recording) && s.recording.length === Math.min(GHOST_LIMIT, Math.floor((s.time + 1e-8) / GHOST_INTERVAL) + 1)
    && s.recording.at(-1).x <= playerOf(s).x + 1e-6;
}
