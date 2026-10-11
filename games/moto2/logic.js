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
export const COOLING_EVERY = 5;
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
export const GHOST_INTERVAL = 0.1;
export const GHOST_LIMIT = 2000;
export const GHOST_MAX_LANE_DELTA = 1; // 0.1 秒內換道加上摔車回正,最多一條車道。
export const TIME_SEEDS = { normal: 9001, hard: 9002, expert: 9003 };
export const DIFFICULTIES = ['normal', 'hard', 'expert'];
export const MODES = ['race', 'time'];
export const LEVELS = {
  normal: { density: 0.38, target: 55, accuracy: 0.62, reaction: 48, heatLimit: 95 },
  hard: { density: 0.58, target: 62, accuracy: 0.82, reaction: 66, heatLimit: 82 },
  expert: { density: 0.78, target: 67, accuracy: 0.96, reaction: 86, heatLimit: 68 },
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
export function generateTrack(seed, difficulty = 'normal', rng) {
  const random = () => {
    if (rng) return rng();
    let r;
    [r, seed] = nextRandom(seed);
    return r;
  };
  let safe = Math.floor(random() * LANES);
  const track = [];
  for (let x = FIRST_OBJECT; x < TRACK_LEN - SEGMENT; x += SEGMENT) {
    safe = clamp(safe + Math.floor(random() * 3) - 1, 0, LANES - 1);
    for (let lane = 0; lane < LANES; lane++) {
      if (lane === safe || random() >= LEVELS[difficulty].density) continue;
      const r = random();
      const kind = r < 0.22 ? 'mud' : r < 0.48 ? 'barrier' : r < 0.75 ? 'ramp' : 'hill';
      track.push({ id: track.length, lane, x, kind, length: OBJECT_LENGTHS[kind],
        height: kind === 'hill' ? HILL_HEIGHT : kind === 'ramp' ? RAMP_HEIGHT : 0 });
    }
  }
  // 冷卻標誌在段落間,全車道可用;不會占用安全車道。
  for (let x = FIRST_OBJECT + SEGMENT / 2; x < TRACK_LEN - SEGMENT; x += SEGMENT * COOLING_EVERY)
    track.push({ id: track.length, lane: -1, x, kind: 'cooling', length: OBJECT_LENGTHS.cooling, height: 0 });
  return track.sort((a, b) => a.x - b.x || a.id - b.id);
}

const vehicle = (id, lane) => ({
  id, lane, lanePos: lane, from: lane, laneLeft: 0, x: 0, speed: 0,
  crash: 0, air: 0, h: 0, vy: 0, angle: 0, heat: 0, overheat: 0,
  sprinting: false, landing: null, mud: false, lastObject: null, seen: null, finishAt: null,
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

function aiInput(v, s, random) {
  const level = LEVELS[s.difficulty];
  const obstacle = s.track.find((o) => ['barrier', 'mud'].includes(o.kind) && o.lane === v.lane
    && o.x >= v.x && o.x - v.x <= level.reaction && o.id !== v.seen);
  if (obstacle && !v.air && !v.crash && !v.laneLeft) {
    v.seen = obstacle.id; // 每個障礙只作一次反應,不因 fps 重抽機率。
    if (random() < level.accuracy) {
      const safe = [-1, 1].filter((d) => v.lane + d >= 0 && v.lane + d < LANES
        && !s.track.some((o) => ['barrier', 'mud'].includes(o.kind) && o.lane === v.lane + d
          && o.x + o.length >= v.x && o.x <= v.x + level.reaction));
      if (safe.length) changeLane(v, safe[Math.floor(random() * safe.length)]);
    }
  }
  const target = level.target + AI_SPEED_OFFSETS[v.id - 1];
  const ground = terrainAt(v.x + v.speed * DT, v.lanePos, s.track);
  return { throttle: v.speed < target, brake: v.speed > target + 1,
    sprint: v.speed < target && v.heat < level.heatLimit,
    tilt: v.air ? Math.sign(ground.angle - v.angle) * Math.min(1, Math.abs(ground.angle - v.angle) / (TILT_SPEED * DT)) : 0 };
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
function crashVehicle(v, objectId = v.lastObject) {
  v.speed = 0; v.crash = CRASH_SEC; v.air = 0; v.vy = 0; v.mud = false;
  v.sprinting = false; v.laneLeft = 0; v.from = v.lane; v.lanePos = v.lane;
  v.lastObject = objectId;
}
function advanceVehicle(v, old, input, track, dt) {
  v.landing = null; v.sprinting = false;
  if (v.finishAt !== null) return;
  if (v.overheat > 0) {
    v.overheat = Math.max(0, v.overheat - dt);
    if (v.overheat < 1e-9) v.overheat = 0;
    v.heat = 100 * v.overheat / OVERHEAT_SEC;
    v.speed = 0;
    return;
  }
  v.heat = clamp(v.heat + (input.sprint && !v.crash ? HEAT_UP
    : input.throttle ? -HEAT_THROTTLE_COOL : -HEAT_IDLE_COOL) * dt, 0, 100);
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
      else v.speed = Math.min(v.landing === 'perfect' ? SPRINT_SPEED : cap, v.speed * (1 - NORMAL_LOSS * Math.abs(v.angle - ground.angle) / SAFE_DEG)
        + (v.landing === 'perfect' ? PERFECT_BOOST : 0));
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
      v.air = dt * Math.max(0.001, 1 - enter); v.vy = JUMP_BASE + JUMP_SPEED * v.speed;
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
  // 前車先處理,降速可以向後傳遞;影子車完全不參與。
  const ahead = [...s.vehicles].sort((a, b) => state.vehicles[b.id].x - state.vehicles[a.id].x || a.id - b.id);
  for (let i = 1; i < ahead.length; i++) {
    const rear = ahead[i];
    for (let j = 0; j < i; j++) {
      const front = ahead[j];
      if (front.finishAt !== null || front.air > 0 || rear.air > 0 || Math.abs(front.lanePos - rear.lanePos) > CAR_HALF_LANE * 2
        || front.x - rear.x >= CAR_GAP || rear.speed <= front.speed) continue;
      rear.speed = front.speed;
      rear.x = Math.max(state.vehicles[rear.id].x, front.x - CAR_GAP);
      const ground = terrainAt(rear.x, rear.lanePos, s.track);
      rear.h = ground.h; rear.angle = ground.angle;
    }
  }
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
      || !num(v.air, 0, MAX_AIR_SEC) || !num(v.h, 0, MAX_HEIGHT) || !num(v.vy, -GRAVITY * MAX_AIR_SEC, JUMP_BASE + JUMP_SPEED * SPRINT_SPEED)
      || !num(v.angle, -ANGLE_LIMIT, ANGLE_LIMIT) || !num(v.heat, 0, 100) || !num(v.overheat, 0, OVERHEAT_SEC)
      || typeof v.mud !== 'boolean' || typeof v.sprinting !== 'boolean'
      || ![null, 'perfect', 'normal', 'crash'].includes(v.landing)) return false;
    if (!near(v.lanePos, v.lane + (v.from - v.lane) * v.laneLeft / LANE_SEC) || Math.abs(v.from - v.lane) > 1
      || (!v.laneLeft && v.from !== v.lane)
      || (v.air > 0 && (v.crash || v.overheat || v.mud))
      || (v.crash > 0 && (v.speed || v.laneLeft || v.mud || v.sprinting))
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
    if (v.crash && (!last || !['barrier', 'ramp'].includes(last.kind))) return false;
    if (v.finishAt !== null && (!num(v.finishAt, TRACK_LEN / SPRINT_SPEED, s.time) || v.x !== TRACK_LEN || i === 0)) return false;
    if (v.finishAt === null && v.x === TRACK_LEN) return false;
    if (s.time === 0 && (v.x || v.speed || v.lane !== i || v.lanePos !== i || v.crash || v.air || v.laneLeft
      || v.h || v.vy || v.angle || v.heat || v.overheat || v.sprinting || v.landing !== null || v.lastObject !== null || v.seen !== null)) return false;
    return v.x <= SPRINT_SPEED * s.time + 1e-6;
  })) return false;
  if (s.mode === 'race') return Array.isArray(s.recording) && s.recording.length === 0;
  return validSamples(s.recording) && s.recording.length === Math.min(GHOST_LIMIT, Math.floor((s.time + 1e-8) / GHOST_INTERVAL) + 1)
    && s.recording.at(-1).x <= playerOf(s).x + 1e-6;
}
