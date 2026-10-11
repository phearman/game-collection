// 越野機車規則:純函式。x = 車道座標(0~3),y = 從起點向前的距離。
export const W = 9;
export const H = 16;
export const DT = 1 / 60;
export const TRACK_LEN = 2400;
export const LANES = 4;
export const COUNTDOWN = 3;
export const MAX_SPEED = 42;
export const ACCEL = 14;
export const BRAKE = 36;
export const COAST = 3;
export const LANE_SEC = 0.2;
export const CRASH_SEC = 1.2;
export const AIR_SEC = 0.8;
export const AIR_SPEED_ADJUST = 0.12;
export const MUD_CAP = 0.5;
export const SEGMENT = 80;
export const FIRST_OBJECT = 140;
export const OBJECT_LENGTHS = { mud: 22, barrier: 5, ramp: 7 };
export const CAR_GAP = 8;
export const CAR_HALF_LANE = 0.38;
export const ROAD_LEFT = 1.1;
export const LANE_WIDTH = 1.7;
export const DIST_SCALE = 0.05;
export const RIDER_Y = 12;
export const GHOST_INTERVAL = 0.1;
export const GHOST_LIMIT = 2000;
export const GHOST_MAX_LANE_DELTA = 1; // 0.1 秒內換道加上摔車回正,最多一條車道。
export const TIME_SEEDS = { normal: 9001, hard: 9002, expert: 9003 };
export const DIFFICULTIES = ['normal', 'hard', 'expert'];
export const MODES = ['race', 'time'];
export const LEVELS = {
  normal: { density: 0.38, target: 33, accuracy: 0.62, reaction: 28 },
  hard: { density: 0.58, target: 37, accuracy: 0.82, reaction: 40 },
  expert: { density: 0.78, target: 41, accuracy: 0.96, reaction: 54 },
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
  for (let y = FIRST_OBJECT; y < TRACK_LEN - SEGMENT; y += SEGMENT) {
    safe = clamp(safe + Math.floor(random() * 3) - 1, 0, LANES - 1);
    for (let lane = 0; lane < LANES; lane++) {
      if (lane === safe || random() >= LEVELS[difficulty].density) continue;
      const r = random();
      const kind = r < 0.35 ? 'mud' : r < 0.8 ? 'barrier' : 'ramp';
      track.push({ id: track.length, lane, y, kind, length: OBJECT_LENGTHS[kind] });
    }
  }
  return track;
}

const vehicle = (id, lane) => ({
  id, lane, x: lane, from: lane, laneLeft: 0, y: 0, speed: 0,
  crash: 0, air: 0, airDuration: 0, mud: false, lastObject: null, seen: null, finishAt: null,
});

export function initState(rng = Math.random, difficulty = 'normal', mode = 'race') {
  difficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
  mode = MODES.includes(mode) ? mode : 'race';
  const seed = mode === 'time' ? TIME_SEEDS[difficulty] : Math.floor(rng() * 4294967296) >>> 0;
  return {
    difficulty, mode, seed, rngSeed: seed, track: generateTrack(seed, difficulty),
    vehicles: Array.from({ length: mode === 'race' ? 4 : 1 }, (_, i) => vehicle(i, i)),
    countdown: COUNTDOWN, time: 0, ticks: 0, moves: 0, paused: true, over: false,
    recording: mode === 'time' ? [{ x: 0, y: 0 }] : [],
  };
}

export const pauseState = (s) => s.over || s.paused ? s : { ...s, paused: true };
export const resumeState = (s) => s.over || !s.paused ? s : { ...s, paused: false };
export const overlayFor = (s) => s.over ? 'over' : s.paused ? (s.ticks ? 'paused' : 'ready') : null;
export const playerOf = (s) => s.vehicles[0];

function changeLane(v, dir) {
  if (!dir || v.air > 0 || v.crash > 0 || v.laneLeft > 0) return;
  const lane = clamp(v.lane + Math.sign(dir), 0, LANES - 1);
  if (lane === v.lane) return;
  v.from = v.x;
  v.lane = lane;
  v.laneLeft = LANE_SEC;
}

function aiInput(v, s, random) {
  const level = LEVELS[s.difficulty];
  const obstacle = s.track.find((o) => o.kind !== 'ramp' && o.lane === v.lane
    && o.y >= v.y && o.y - v.y <= level.reaction && o.id !== v.seen);
  if (obstacle && !v.air && !v.crash && !v.laneLeft) {
    v.seen = obstacle.id; // 每個障礙只作一次反應,不因 fps 重抽機率。
    if (random() < level.accuracy) {
      const safe = [-1, 1].filter((d) => v.lane + d >= 0 && v.lane + d < LANES
        && !s.track.some((o) => o.kind !== 'ramp' && o.lane === v.lane + d
          && o.y + o.length >= v.y && o.y <= v.y + level.reaction));
      if (safe.length) changeLane(v, safe[Math.floor(random() * safe.length)]);
    }
  }
  const target = level.target + AI_SPEED_OFFSETS[v.id - 1];
  return { throttle: v.speed < target, brake: v.speed > target + 1 };
}

function advanceVehicle(v, old, input, track, dt) {
  if (v.finishAt !== null) return;
  if (v.crash > 0) {
    v.crash = Math.max(0, v.crash - dt);
    v.speed = 0;
    return;
  }
  changeLane(v, input.dir);
  v.laneLeft = Math.max(0, v.laneLeft - dt);
  v.x = v.laneLeft > 0 ? v.lane + (v.from - v.lane) * v.laneLeft / LANE_SEC : v.lane;
  if (!v.laneLeft) v.from = v.lane;
  v.air = Math.max(0, v.air - dt);
  v.mud = v.air === 0 && track.some((o) => o.kind === 'mud' && Math.abs(v.x - o.lane) <= CAR_HALF_LANE
    && v.y >= o.y && v.y <= o.y + o.length);
  const cap = MAX_SPEED * (v.mud ? MUD_CAP : 1);
  v.speed = clamp(v.speed + (input.brake ? -BRAKE : input.throttle ? ACCEL : -COAST) * dt, 0, cap);
  v.y += v.speed * dt;
  // 整步軌跡與物件矩形求交,包含從側面換入中段/末端與步內落地。
  for (const o of track) {
    if (v.y < o.y || old.y > o.y + o.length || o.id === v.lastObject) continue;
    let enter = Math.max(0, old.air / dt), leave = 1;
    for (const [start, end, lo, hi] of [
      [old.y, v.y, o.y, o.y + o.length],
      [old.x, v.x, o.lane - CAR_HALF_LANE, o.lane + CAR_HALF_LANE],
    ]) {
      if (end === start) {
        if (start < lo || start > hi) leave = -1;
      } else {
        const a = (lo - start) / (end - start), b = (hi - start) / (end - start);
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter > leave || v.air > 0) continue;
    const t = enter;
    if (o.kind === 'mud') {
      v.mud = true;
      v.speed = Math.min(v.speed, MAX_SPEED * MUD_CAP);
    } else if (o.kind === 'ramp') {
      v.airDuration = AIR_SEC + AIR_SPEED_ADJUST * (v.speed / MAX_SPEED - 0.5);
      v.air = Math.max(0, v.airDuration - dt * (1 - t));
      v.mud = false;
      v.lastObject = o.id;
    } else {
      v.y = old.y + (v.y - old.y) * t;
      v.speed = 0;
      v.crash = CRASH_SEC;
      v.air = 0;
      v.mud = false;
      v.laneLeft = 0;
      v.lane = o.lane;
      v.x = v.lane;
      v.from = v.lane;
      v.lastObject = o.id;
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
    return b.y - a.y || a.id - b.id;
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
  if (input.throttle || input.brake || input.dir) s.moves++;
  s.vehicles.forEach((v, i) => {
    const controls = i === 0 ? input : aiInput(v, s, random);
    advanceVehicle(v, state.vehicles[i], controls, s.track, dt);
  });
  // 前車先處理,降速可以向後傳遞;影子車完全不參與。
  const ahead = [...s.vehicles].sort((a, b) => state.vehicles[b.id].y - state.vehicles[a.id].y || a.id - b.id);
  for (let i = 1; i < ahead.length; i++) {
    const rear = ahead[i];
    for (let j = 0; j < i; j++) {
      const front = ahead[j];
      if (front.finishAt !== null || front.air > 0 || rear.air > 0 || Math.abs(front.x - rear.x) > CAR_HALF_LANE * 2
        || front.y - rear.y >= CAR_GAP || rear.speed <= front.speed) continue;
      rear.speed = front.speed;
      rear.y = Math.max(state.vehicles[rear.id].y, front.y - CAR_GAP);
    }
  }
  s.time += dt;
  for (const v of s.vehicles) {
    if (v.finishAt === null && v.y >= TRACK_LEN) {
      const old = state.vehicles[v.id];
      const fraction = clamp((TRACK_LEN - old.y) / (v.y - old.y), 0, 1);
      v.finishAt = state.time + dt * fraction;
      v.y = TRACK_LEN;
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
      const oldY = state.vehicles[v.id].y;
      const endY = v.finishAt !== null ? oldY + (TRACK_LEN - oldY) * dt / (v.finishAt - state.time) : v.y;
      v.finishAt = null;
      v.y = oldY + (endY - oldY) * fraction;
    }
  }
  if (s.mode === 'time') {
    s.recording = [...state.recording];
    while (s.recording.length < GHOST_LIMIT && s.recording.length * GHOST_INTERVAL <= s.time + 1e-9) {
      const fraction = clamp((s.recording.length * GHOST_INTERVAL - state.time) / dt, 0, 1);
      const old = playerOf(state);
      s.recording.push({ x: old.x + (player.x - old.x) * fraction, y: old.y + (player.y - old.y) * fraction });
    }
  }
  return s;
}

const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const uint = (v) => Number.isInteger(v) && num(v, 0, 0xffffffff);
const sample = (p) => obj(p) && num(p.x, 0, 3) && num(p.y, 0, TRACK_LEN);
function validSamples(list) {
  return Array.isArray(list) && list.length > 0 && list.length <= GHOST_LIMIT
    && list.every((p, i) => sample(p) && (i === 0 ? p.y === 0 : p.y >= list[i - 1].y
      && p.y - list[i - 1].y <= MAX_SPEED * GHOST_INTERVAL + 1e-6
      && Math.abs(p.x - list[i - 1].x) <= GHOST_MAX_LANE_DELTA + 1e-6));
}
export function isValidGhost(g) {
  // ms 四捨五入後可能剛好落在採樣邊界;允許半毫秒內的兩種筆數。
  const countAt = (seconds) => Math.min(GHOST_LIMIT, Math.floor((seconds + 1e-9) / GHOST_INTERVAL) + 1);
  return obj(g) && num(g.ms, TRACK_LEN / MAX_SPEED * 1000, 1e10) && Number.isInteger(g.ms)
    && validSamples(g.samples) && g.samples.length >= countAt(g.ms / 1000 - 0.0005)
    && g.samples.length <= countAt(g.ms / 1000 + 0.0005)
    && TRACK_LEN - g.samples.at(-1).y <= MAX_SPEED
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
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
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
    || !s.track.every((o, i) => obj(o) && ['id', 'lane', 'y', 'kind', 'length'].every((k) => o[k] === expected[i][k]))) return false;
  if (!Array.isArray(s.vehicles) || s.vehicles.length !== (s.mode === 'time' ? 1 : 4)) return false;
  if (!s.vehicles.every((v, i) => {
    if (!obj(v) || v.id !== i || !Number.isInteger(v.lane) || !num(v.lane, 0, 3) || !num(v.x, 0, 3) || !num(v.from, 0, 3)
      || !num(v.y, 0, TRACK_LEN) || !num(v.speed, 0, MAX_SPEED) || !num(v.laneLeft, 0, LANE_SEC)
      || !num(v.crash, 0, CRASH_SEC) || !num(v.airDuration, 0, AIR_SEC + AIR_SPEED_ADJUST / 2)
      || !num(v.air, 0, v.airDuration) || typeof v.mud !== 'boolean') return false;
    if (!near(v.x, v.lane + (v.from - v.lane) * v.laneLeft / LANE_SEC) || Math.abs(v.from - v.lane) > 1
      || (v.laneLeft === 0 && v.from !== v.lane) || (v.air > 0 && (v.crash > 0 || v.mud))
      || (v.crash > 0 && (v.speed !== 0 || v.laneLeft > 0 || v.mud)) || (v.mud && v.speed > MAX_SPEED * MUD_CAP)) return false;
    for (const k of ['lastObject', 'seen']) {
      if (v[k] !== null && (!Number.isInteger(v[k]) || !s.track.some((o) => o.id === v[k]))) return false;
    }
    const last = s.track.find((o) => o.id === v.lastObject);
    if (last && last.y > v.y + 1e-6) return false;
    if (v.crash > 0 && (!last || last.kind !== 'barrier' || v.lane !== last.lane
      || v.y > last.y + last.length + 1e-6)) return false;
    // 側向起跳可發生在跳台任一處;空中最多延續起跳前的一次換道。
    if (v.air > 0 && (!last || last.kind !== 'ramp' || v.airDuration < AIR_SEC - AIR_SPEED_ADJUST / 2
      || v.y - last.y > last.length + MAX_SPEED * v.airDuration + 1e-6
      || Math.abs(v.x - last.lane) > CAR_HALF_LANE
        + Math.min(1, (v.airDuration - v.air) / LANE_SEC) + 1e-6
      || (v.laneLeft > 0 && (last.lane < Math.min(v.from, v.lane) - CAR_HALF_LANE - 1e-6
        || last.lane > Math.max(v.from, v.lane) + CAR_HALF_LANE + 1e-6)))) return false;
    if (v.finishAt !== null && (!num(v.finishAt, TRACK_LEN / MAX_SPEED, s.time) || v.y !== TRACK_LEN || i === 0)) return false;
    if (v.finishAt === null && v.y === TRACK_LEN) return false;
    if (s.time === 0 && (v.y !== 0 || v.speed !== 0 || v.lane !== i || v.x !== i || v.crash || v.air || v.laneLeft)) return false;
    return v.y <= MAX_SPEED * s.time + 1e-6;
  })) return false;
  if (s.mode === 'race') return Array.isArray(s.recording) && s.recording.length === 0;
  return validSamples(s.recording) && s.recording.length === Math.min(GHOST_LIMIT, Math.floor((s.time + 1e-8) / GHOST_INTERVAL) + 1)
    && s.recording.at(-1).y <= playerOf(s).y + 1e-6;
}
