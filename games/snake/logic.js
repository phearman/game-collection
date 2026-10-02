// 貪食蛇規則層:純函式,不碰 DOM。座標 = [row, col],row 0 在最上方。
// 規則正典:workbook/plans/snake.md「規則(驗收依據)」。

export const SIZE = 15;
export const START_LENGTH = 3;
export const FOOD_SCORE = 10;
export const DIFFICULTIES = ['normal', 'hard', 'expert'];
export const TICK_MS = { normal: 160, hard: 110, expert: 75 };

export const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const inside = ([r, c], size = SIZE) => r >= 0 && r < size && c >= 0 && c < size;
const has = (cells, cell) => cells.some((x) => same(x, cell));

export function emptyCells(snake, size = SIZE) {
  const cells = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (!has(snake, [r, c])) cells.push([r, c]);
  }
  return cells;
}

// rng 可注入,測試時傳固定序列。沒有空格 ⇒ null。
export function placeFood(snake, rng = Math.random, size = SIZE) {
  const cells = emptyCells(snake, size);
  if (cells.length === 0) return null;
  return cells[Math.floor(rng() * cells.length)];
}

// ---- 狀態轉移(純函式,UI 只呼叫)----
// state = { snake, dir, pending, food, score, steps, difficulty, paused, over, won }
//   snake   蛇身座標陣列,[0] 是蛇頭
//   dir     目前前進方向
//   pending 本 tick 已收下的轉向(下一 tick 生效;同一 tick 只收第一個)
//   steps   本局已前進的格數(§4.2 判斷「新遊戲」要不要記錄)
//   paused  暫停中(開局、續玩還原後都是暫停)

export function initState(rng = Math.random, difficulty = 'normal') {
  const mid = Math.floor(SIZE / 2);
  const snake = Array.from({ length: START_LENGTH }, (_, i) => [mid, mid - i]);
  return {
    snake,
    dir: 'right',
    pending: null,
    food: placeFood(snake, rng),
    score: 0,
    steps: 0,
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    paused: true,
    over: false,
    won: false,
  };
}

// 轉向:反向、同向、本 tick 已轉過、或已結束 ⇒ 原 state(同一物件)。
export function turnState(state, dir) {
  if (!DIRS[dir] || state.over || state.pending) return state;
  if (dir === state.dir || dir === OPPOSITE[state.dir]) return state;
  return { ...state, pending: dir };
}

export function pauseState(state) {
  if (state.paused || state.over) return state;
  return { ...state, paused: true };
}

export function resumeState(state) {
  if (!state.paused || state.over) return state;
  return { ...state, paused: false };
}

// 前進一格。暫停或已結束 ⇒ 原 state。
export function tickState(state, rng = Math.random) {
  if (state.paused || state.over) return state;
  const dir = state.pending ?? state.dir;
  const [dr, dc] = DIRS[dir];
  const head = [state.snake[0][0] + dr, state.snake[0][1] + dc];
  const base = { ...state, dir, pending: null };
  if (!inside(head)) return { ...base, over: true };
  const eat = state.food !== null && same(head, state.food);
  // 沒吃到食物時尾巴同一步移開,蛇頭進入原尾巴位置合法。
  const body = eat ? state.snake : state.snake.slice(0, -1);
  if (has(body, head)) return { ...base, over: true };
  const snake = [head, ...body];
  const next = { ...base, snake, steps: state.steps + 1 };
  if (!eat) return next;
  const food = placeFood(snake, rng);
  return { ...next, score: state.score + FOOD_SCORE, food, won: food === null, over: food === null };
}

// 結束遮罩:'ready' 開局未動 / 'paused' / 'won' / 'over' / null。
export function overlayFor({ paused, over, won, steps }) {
  if (won) return 'won';
  if (over) return 'over';
  if (paused) return steps === 0 ? 'ready' : 'paused';
  return null;
}

// ---- 存檔(續玩)----

export function toSave({ snake, dir, food, score, steps, difficulty }) {
  return { snake, dir, food, score, steps, difficulty };
}

// 還原後處於暫停狀態。
export function fromSave(saved) {
  return {
    snake: saved.snake.map(([r, c]) => [r, c]),
    dir: saved.dir,
    pending: null,
    food: [saved.food[0], saved.food[1]],
    score: saved.score,
    steps: saved.steps,
    difficulty: saved.difficulty,
    paused: true,
    over: false,
    won: false,
  };
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isCell = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && inside(v);

export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const { snake, dir, food, score, steps, difficulty } = s;
  if (!Array.isArray(snake) || snake.length < START_LENGTH || snake.length >= SIZE * SIZE) return false;
  if (!snake.every(isCell)) return false;
  if (new Set(snake.map(([r, c]) => r * SIZE + c)).size !== snake.length) return false;
  // 蛇身逐節相鄰;蛇頸在前進方向的反方向(不會一開始就是反向)。
  for (let i = 1; i < snake.length; i++) {
    if (Math.abs(snake[i][0] - snake[i - 1][0]) + Math.abs(snake[i][1] - snake[i - 1][1]) !== 1) return false;
  }
  if (!Object.hasOwn(DIRS, dir)) return false;
  const [dr, dc] = DIRS[dir];
  if (!same(snake[1], [snake[0][0] - dr, snake[0][1] - dc])) return false;
  if (!isCell(food) || has(snake, food)) return false;
  if (!isCount(score) || score !== (snake.length - START_LENGTH) * FOOD_SCORE) return false;
  if (!isCount(steps) || !DIFFICULTIES.includes(difficulty)) return false;
  return true;
}
