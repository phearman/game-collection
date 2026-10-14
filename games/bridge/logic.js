// 小人過橋規則：座標與時間皆與畫面縮放無關；亂數來源可注入。
export const FIELD_W = 400;
export const FIELD_H = 440;
export const PILLAR_H = 160;
export const DT = 1 / 60;
export const FALL_SECONDS = 0.3;
export const DROP_SECONDS = 0.5;
export const WALK_SPEED = 200;
export const DIFFICULTIES = ['normal', 'hard', 'expert'];
export const PARAMS = {
  normal: { gap: [40, 160], width: [40, 80], speed: 240, perfect: 10, floor: 12 },
  hard: { gap: [60, 190], width: [26, 60], speed: 300, perfect: 8, floor: 10 },
  expert: { gap: [80, 220], width: [16, 44], speed: 360, perfect: 6, floor: 8 },
};
export const PHASES = ['ready', 'growing', 'falling', 'walking', 'dropping', 'over'];
const EPS = 1e-9;
const uint = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
const natural = (n) => Number.isSafeInteger(n) && n >= 0;

export function widthRange(difficulty, pillars = 0) {
  const p = PARAMS[difficulty];
  const shrink = Math.floor(pillars / 10) * 2;
  return p.width.map((n) => Math.max(p.floor, n - shrink));
}

export function nextRandom(seed) {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [next / 4294967296, next];
}

const integer = (range, rng) => range[0] + Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, rng())) * (range[1] - range[0] + 1));
export function generatePillar(difficulty, pillars, rng) {
  return { gap: integer(PARAMS[difficulty].gap, rng), width: integer(widthRange(difficulty, pillars), rng) };
}

function nextPillar(s, rng) {
  let seed = s.rngState;
  const random = () => {
    const [value, next] = nextRandom(seed);
    seed = next;
    return rng ? rng() : value;
  };
  const p = generatePillar(s.difficulty, s.pillars, random);
  return { ...s, rngState: seed, generated: s.generated + 1,
    next: { ...p, x: s.current.x + s.current.width + p.gap, index: s.pillars + 1 } };
}

export function initState({ difficulty = 'normal', seed = 1 } = {}, rng) {
  difficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
  seed = uint(seed) ? seed : 1;
  return nextPillar({ difficulty, seed, rngState: seed, generated: 0,
    phase: 'ready', paused: false, bridgeCommitted: false, bridgeLength: 0, elapsed: 0, walk: 0,
    landing: null, score: 0, combo: 0, pillars: 0, perfects: 0, best_combo: 0, moves: 0,
    current: { x: 0, width: PARAMS[difficulty].width[1], index: 0 } }, rng);
}

export function perfectZone(s) {
  const middle = s.next.gap + s.next.width / 2;
  const half = PARAMS[s.difficulty].perfect / 2;
  return [middle - half, middle + half];
}

export function landingFor(s, length = s.bridgeLength) {
  if (length < s.next.gap || length > s.next.gap + s.next.width) return 'fail';
  const [left, right] = perfectZone(s);
  return length >= left && length <= right ? 'perfect' : 'success';
}

export function stepState(state, input = {}, dt = DT, rng) {
  if (state.paused || state.phase === 'over' || !Number.isFinite(dt) || dt < 0) return state;
  let s = state;
  if (s.phase === 'ready') {
    if (!input.press) return s;
    s = { ...s, phase: 'growing', moves: s.moves + 1 };
  }
  if (s.phase === 'growing') {
    if (input.release) return { ...s, phase: 'falling', bridgeCommitted: true, elapsed: 0 };
    const bridgeLength = Math.min(FIELD_W, s.bridgeLength + PARAMS[s.difficulty].speed * dt);
    return { ...s, bridgeLength, bridgeCommitted: bridgeLength === FIELD_W,
      phase: bridgeLength === FIELD_W ? 'falling' : 'growing', elapsed: 0 };
  }
  if (s.phase === 'falling') {
    const elapsed = Math.min(FALL_SECONDS, s.elapsed + dt);
    if (elapsed + EPS < FALL_SECONDS) return { ...s, elapsed };
    const landing = landingFor(s);
    return { ...s, phase: 'walking', elapsed: 0, landing, combo: landing === 'perfect' ? s.combo : 0 };
  }
  if (s.phase === 'walking') {
    const target = s.landing === 'fail' ? s.bridgeLength : s.next.gap + s.next.width;
    const walk = Math.min(target, s.walk + WALK_SPEED * dt);
    if (walk + EPS < target) return { ...s, walk };
    if (s.landing === 'fail') return { ...s, phase: 'dropping', walk: target, elapsed: 0 };
    const combo = s.landing === 'perfect' ? s.combo + 1 : 0;
    return nextPillar({ ...s, phase: 'ready', bridgeCommitted: false, bridgeLength: 0, elapsed: 0, walk: 0, landing: null,
      score: s.score + 1 + Math.min(combo, 5), combo, pillars: s.pillars + 1,
      perfects: s.perfects + (combo > 0 ? 1 : 0), best_combo: Math.max(s.best_combo, combo), current: s.next }, rng);
  }
  if (s.phase === 'dropping') {
    const elapsed = Math.min(DROP_SECONDS, s.elapsed + dt);
    return { ...s, elapsed, phase: elapsed + EPS >= DROP_SECONDS ? 'over' : 'dropping' };
  }
  return s;
}

export function pauseState(s, cancelGrowing = false) {
  if (s.phase === 'over' || (s.paused && !(s.phase === 'growing' && cancelGrowing))) return s;
  return { ...s, paused: true, ...(s.phase === 'growing' && cancelGrowing
    ? { phase: 'ready', bridgeLength: 0, elapsed: 0, walk: 0, landing: null } : {}) };
}
export function resumeState(s) { return s.phase === 'over' || !s.paused ? s : { ...s, paused: false }; }
export const canPress = (s) => !s.paused && s.phase === 'ready';
export const isAnimating = (s) => !s.paused && !['ready', 'over'].includes(s.phase);
export function statusText(s) {
  if (s.phase === 'over' && s.failureReason === 'left-after-release') return '已出手後離開,本橋判失敗';
  if (s.paused) return '已暫停，按繼續接著玩';
  if (s.phase === 'ready') return '按住搭橋 · 放開過橋';
  if (s.phase === 'growing') return `橋長 ${Math.round(s.bridgeLength)} · 放開讓橋倒下`;
  if (s.phase === 'falling') return '橋正在倒下…';
  if (s.landing === 'fail') return s.bridgeLength < s.next.gap ? '橋太短了！' : '橋太長了！';
  return s.landing === 'perfect' ? `完美 ×${s.combo + 1}` : '搭上了，向前走！';
}
export const comboText = (s) => s.landing === 'perfect' ? `完美 ×${s.combo + 1}` : s.combo > 0 ? `完美 ×${s.combo}` : '';
export const finishInfo = (s, quit = false) => ({ result: quit ? (s.moves > 0 ? 'quit' : null) : (s.phase === 'over' ? 'lose' : null),
  score: s.score, difficulty: s.difficulty, detail: { pillars: s.pillars, perfects: s.perfects, best_combo: s.best_combo } });

// 按下保存 ready 檢查點；開始倒下標記已出手，成功過橋才清除。
export function checkpointFor(before, after) {
  if (before.phase === 'ready' && after.phase === 'growing') return toSave({ ...before, moves: after.moves });
  if (before.phase === 'growing' && after.phase === 'falling') return toSave({ ...after,
    phase: 'ready', bridgeCommitted: true, bridgeLength: 0, elapsed: 0, walk: 0, landing: null });
  return after.phase === 'ready' && after.moves > 0 ? toSave(after) : null;
}
export function toSave(s) { return s.phase === 'ready' ? structuredClone({ ...s, paused: false }) : null; }
export function fromSave(s) {
  if (!isValidState(s)) return null;
  return structuredClone({ ...s, bridgeCommitted: s.bridgeCommitted ?? false,
    ...(s.bridgeCommitted ? { phase: 'over', paused: false, landing: 'fail', failureReason: 'left-after-release' } : { paused: true }) });
}

// 存檔場面只接受 ready；已出手旗標載入後直接失敗，不能重試這一橋。
export function isValidState(s) {
  if (!s || typeof s !== 'object' || !DIFFICULTIES.includes(s.difficulty) || s.phase !== 'ready'
    || (s.bridgeCommitted !== undefined && typeof s.bridgeCommitted !== 'boolean')
    || (s.bridgeCommitted === true && s.moves <= s.pillars)
    || typeof s.paused !== 'boolean' || s.bridgeLength !== 0 || s.elapsed !== 0 || s.walk !== 0 || s.landing !== null) return false;
  if (!['score', 'combo', 'pillars', 'perfects', 'best_combo', 'moves', 'generated'].every((k) => natural(s[k]))
    || !uint(s.seed) || !uint(s.rngState) || s.generated !== s.pillars + 1 || s.moves < s.pillars
    || s.perfects > s.pillars || s.combo > s.best_combo || s.best_combo > s.perfects
    || (s.perfects > 0 && s.best_combo === 0) || s.score < s.pillars + s.perfects || s.score > s.pillars + s.perfects * 5) return false;
  const ramp = s.best_combo <= 5 ? s.best_combo * (s.best_combo + 1) / 2 : 15 + (s.best_combo - 5) * 5;
  const remaining = s.perfects - s.best_combo;
  if (s.score < s.pillars + ramp + remaining || s.score > s.pillars + ramp + remaining * Math.min(s.best_combo, 5)) return false;
  const inRange = (n, r) => natural(n) && n >= r[0] && n <= r[1];
  const c = s.current, n = s.next;
  if (!c || !n || !natural(c.x) || !natural(n.x) || c.index !== s.pillars || n.index !== s.pillars + 1
    || !inRange(c.width, widthRange(s.difficulty, Math.max(0, s.pillars - 1)))
    || !inRange(n.width, widthRange(s.difficulty, s.pillars)) || !inRange(n.gap, PARAMS[s.difficulty].gap)
    || n.x !== c.x + c.width + n.gap) return false;
  if (s.pillars === 0 && (c.x !== 0 || c.width !== PARAMS[s.difficulty].width[1])) return false;
  return true;
}

export const HELP_RULES = [
  '在場景按住手指、滑鼠左鍵或空白鍵，讓橋伸長；放開讓橋倒下。',
  '橋的末端搭在下一根柱子上就能過橋，太短或太長都會掉下去。',
  '中央紅線是完美區；連續完美另加 1、2、3、4、5 分，之後每次最多加 5 分。',
  '伸長中忽略 P 與暫停鈕；切走分頁或開玩法會取消伸長；出手後重整判失敗。',
  '只有一條命，掉下去就結束；每過一根得 1 分，完美另加連擊分，比最高分。',
];

function growTo(s, length) {
  s = stepState(s, { press: true }, 0);
  while (s.bridgeLength + EPS < length) s = stepState(s, {}, Math.min(DT, (length - s.bridgeLength) / PARAMS[s.difficulty].speed));
  return s;
}
function complete(s) {
  s = stepState(s, { release: true }, 0);
  for (let i = 0; i < 300 && !['ready', 'over'].includes(s.phase); i++) s = stepState(s);
  return s;
}
export function demoSteps() {
  const first = initState({ seed: 13 });
  const grown = growTo(first, first.next.gap);
  const success = complete(grown);
  const centered = growTo(success, success.next.gap + success.next.width / 2);
  const perfect = complete(centered);
  const short = growTo(perfect, perfect.next.gap - 12);
  const failed = complete(short);
  return [
    { before: first, after: grown, caption: '按住，橋會逐漸變長。', result: `橋長 ${grown.bridgeLength}，放開即可倒下。` },
    { before: grown, after: success, caption: '放開，讓橋剛好搭到柱子。', result: `成功過橋，得到 ${success.score - first.score} 分。`, kind: 'ok' },
    { before: centered, after: perfect, caption: '讓橋末端落在中央紅線。', result: `完美！過橋加 1 分，另加 ${perfect.score - success.score - 1} 分。`, kind: 'ok' },
    { before: short, after: failed, caption: '橋太短，碰不到下一根柱子。', result: '掉下去，本局結束。', kind: 'fail' },
  ];
}
