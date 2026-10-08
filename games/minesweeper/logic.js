// 踩地雷規則層:純函式,不碰 DOM。棋盤以一維陣列存,格子編號 i = r × cols + c。
// 規則正典:workbook/plans/minesweeper.md「規則(驗收依據)」。

export const DIFFICULTIES = {
  normal: { rows: 9, cols: 9, mines: 10 },
  hard: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 30, cols: 16, mines: 99 }, // 直式:16 欄 × 30 列
};

export const MAX_SCORE = 10000;
const STATUSES = ['ready', 'playing', 'win', 'lose'];

// ---- 棋盤幾何 ----

export function neighbors(rows, cols, i) {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
    }
  }
  return out;
}

// 佈雷:避開 safe 格與其 8 鄰格(第一下必安全)。rng 可注入,測試時傳固定序列。
export function placeMines(rows, cols, count, safe, rng = Math.random) {
  const banned = new Set([safe, ...neighbors(rows, cols, safe)]);
  const pool = [];
  for (let i = 0; i < rows * cols; i++) if (!banned.has(i)) pool.push(i);
  if (count > pool.length) throw new Error(`too many mines: ${count}`);
  // 部分 Fisher–Yates:只洗前 count 個。
  for (let k = 0; k < count; k++) {
    const j = k + Math.floor(rng() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  const mines = Array(rows * cols).fill(false);
  for (let k = 0; k < count; k++) mines[pool[k]] = true;
  return mines;
}

// 周圍地雷數。
export function adjacentMines(state, i) {
  return neighbors(state.rows, state.cols, i).filter((n) => state.mines[n]).length;
}

// ---- 狀態 ----
// state = { difficulty, rows, cols, mineCount, mines, open, flags, status, exploded, moves, seconds }
//   mines    null(第一下前尚未佈雷)或 boolean[]
//   open     已翻開;flags 已插旗(兩者互斥)
//   status   'ready' 尚未翻第一格 / 'playing' / 'win' / 'lose'
//   exploded 踩到的那顆雷(lose 時)
//   moves    本局有效操作次數(§4.2 判斷「新遊戲」要不要記錄)
//   seconds  計時秒數(第一下開始,由 tickState 累加)

export function initState(difficulty = 'normal') {
  const d = DIFFICULTIES[difficulty];
  if (!d) throw new Error(`unknown difficulty: ${difficulty}`);
  const n = d.rows * d.cols;
  return {
    difficulty,
    rows: d.rows,
    cols: d.cols,
    mineCount: d.mines,
    mines: null,
    open: Array(n).fill(false),
    flags: Array(n).fill(false),
    status: 'ready',
    exploded: null,
    moves: 0,
    seconds: 0,
  };
}

// 指定地雷位置的進行中盤面(示範與測試用;佈雷規則仍以 placeMines 為準)。
export function stateWithMines(rows, cols, mineIndexes, difficulty = 'normal') {
  const mines = Array(rows * cols).fill(false);
  for (const i of mineIndexes) mines[i] = true;
  return {
    ...initState(difficulty), rows, cols, mineCount: mineIndexes.length, mines,
    open: Array(rows * cols).fill(false), flags: Array(rows * cols).fill(false), status: 'playing',
  };
}

export const isOver = (state) => state.status === 'win' || state.status === 'lose';

// 點選確認是輸入偏好,不放入遊戲存檔、不改變計分或輔助局。
export function confirmModeFor(difficulty, coarsePointer, preference = null) {
  if (typeof preference === 'boolean') return preference;
  return coarsePointer && (difficulty === 'hard' || difficulty === 'expert');
}

// 只決定選取或交給既有翻開/插旗規則;第一下選取不算遊戲操作。
export function cellTapAction(state, i, { confirm = false, selected = null, flagMode = false } = {}) {
  if (isOver(state) || !Number.isInteger(i) || i < 0 || i >= state.open.length) {
    return { selected: null, action: null };
  }
  if (confirm && selected !== i) return { selected: i, action: null };
  return { selected: null, action: flagMode && !state.open[i] ? 'flag' : 'reveal' };
}

const flagCount = (state) => state.flags.filter(Boolean).length;

// 剩餘雷數 = 總雷數 − 旗數(可為負)。
export function remainingMines(state) {
  return state.mineCount - flagCount(state);
}

function isCleared(state, open) {
  return open.every((o, i) => o || state.mines[i]);
}

// 翻開 starts 中的格子;翻到 0 連鎖展開(插旗格不翻)。任一顆是雷 ⇒ lose。
function openCells(state, starts) {
  const open = state.open.slice();
  let hit = null;
  const stack = [];
  for (const i of starts) {
    if (open[i] || state.flags[i]) continue;
    if (state.mines[i]) hit ??= i;
    else stack.push(i);
  }
  while (stack.length) {
    const i = stack.pop();
    if (open[i]) continue;
    open[i] = true;
    if (adjacentMines(state, i) === 0) {
      for (const n of neighbors(state.rows, state.cols, i)) {
        if (!open[n] && !state.flags[n] && !state.mines[n]) stack.push(n);
      }
    }
  }
  const next = { ...state, open, moves: state.moves + 1 };
  if (hit !== null) return { ...next, status: 'lose', exploded: hit };
  // 勝利:所有非雷格都翻開,未插旗的雷自動補旗。
  if (isCleared(state, open)) return { ...next, status: 'win', flags: state.mines.slice() };
  return next;
}

// 快速翻開(chord):已翻開的數字格,周圍旗數 = 該數字 ⇒ 翻開其餘鄰格(可能踩雷)。
// 不成立 → 原 state(同一物件)。
export function chordState(state, i) {
  if (state.status !== 'playing' || !state.open[i]) return state;
  const around = neighbors(state.rows, state.cols, i);
  const n = adjacentMines(state, i);
  if (n === 0 || around.filter((x) => state.flags[x]).length !== n) return state;
  const targets = around.filter((x) => !state.open[x] && !state.flags[x]);
  if (targets.length === 0) return state;
  return openCells(state, targets);
}

// 點一格:第一下才佈雷;插旗格不可翻;點已翻開的格 ⇒ chord。
// 有效 → 新 state;無效(已結束、插旗格、chord 不成立)→ 原 state(同一物件)。
export function revealState(state, i, rng = Math.random) {
  if (isOver(state) || i < 0 || i >= state.open.length) return state;
  if (state.flags[i]) return state;
  if (state.open[i]) return chordState(state, i);
  let s = state;
  if (s.status === 'ready') {
    s = { ...s, mines: placeMines(s.rows, s.cols, s.mineCount, i, rng), status: 'playing' };
  }
  return openCells(s, [i]);
}

// 插旗 / 取消插旗:只能插在未翻開的格;結束後不可插。
// 第一下之前也可插旗(PM 裁定):不佈雷、不開始計時,插旗格之後照常可能有雷。
export function flagState(state, i) {
  if (isOver(state) || state.open[i] || i < 0 || i >= state.open.length) return state;
  const flags = state.flags.slice();
  flags[i] = !flags[i];
  return { ...state, flags, moves: state.moves + 1 };
}

// 計時:進行中每秒 +1;未開始或已結束不動。
export function tickState(state) {
  return state.status === 'playing' ? { ...state, seconds: state.seconds + 1 } : state;
}

// 分數:勝利 = max(1, 10000 − 秒數),失敗 = 0。
export function scoreFor(result, seconds) {
  return result === 'win' ? Math.max(1, MAX_SCORE - seconds) : 0;
}

// 遊戲判定結束的結果;未結束 → null。
export function resultOf(state) {
  return isOver(state) ? state.status : null;
}

// 一格該怎麼顯示:'hidden' | 'flag' | 'mine' | 'exploded' | 'wrong'(插錯的旗)| '0'~'8'。
// 踩雷後顯示所有雷並標出插錯的旗。
export function cellView(state, i) {
  if (state.open[i]) return String(adjacentMines(state, i));
  if (state.status === 'lose') {
    if (i === state.exploded) return 'exploded';
    if (state.flags[i]) return state.mines[i] ? 'flag' : 'wrong';
    if (state.mines[i]) return 'mine';
  }
  return state.flags[i] ? 'flag' : 'hidden';
}

// ---- 存檔 ----

// state 本身即可序列化。
export function toSave(state) {
  const { difficulty, rows, cols, mineCount, mines, open, flags, status, exploded, moves, seconds } = state;
  return { difficulty, rows, cols, mineCount, mines, open, flags, status, exploded, moves, seconds };
}

export function fromSave(saved) {
  return { ...toSave(saved), mines: saved.mines ? saved.mines.slice() : null, open: saved.open.slice(), flags: saved.flags.slice() };
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isBoolArr = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => typeof v === 'boolean');

export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const d = Object.hasOwn(DIFFICULTIES, s.difficulty) ? DIFFICULTIES[s.difficulty] : null;
  if (!d || s.rows !== d.rows || s.cols !== d.cols || s.mineCount !== d.mines) return false;
  const n = d.rows * d.cols;
  if (!STATUSES.includes(s.status) || !isCount(s.moves) || !isCount(s.seconds)) return false;
  if (!isBoolArr(s.open, n) || !isBoolArr(s.flags, n)) return false;
  if (s.open.some((o, i) => o && s.flags[i])) return false;
  // ready:尚未佈雷、未翻開任何格(可已插旗)。
  if (s.status === 'ready') return s.mines === null && s.exploded === null && !s.open.some(Boolean);
  // 佈雷後:雷數正確、翻開的格不是雷、至少翻開過第一下。
  if (!isBoolArr(s.mines, n) || s.mines.filter(Boolean).length !== d.mines) return false;
  if (s.open.some((o, i) => o && s.mines[i]) || !s.open.some(Boolean)) return false;
  const cleared = s.open.every((o, i) => o || s.mines[i]);
  // 勝負須與盤面一致:
  //   win     所有非雷格已翻開,且雷全部補旗
  //   playing 尚有非雷格未翻開
  //   lose    踩到的那格是雷(且不是插旗格)
  if (s.status === 'win') return cleared && s.exploded === null && s.flags.every((f, i) => f === s.mines[i]);
  if (s.status === 'playing') return !cleared && s.exploded === null;
  return isCount(s.exploded) && s.exploded < n && s.mines[s.exploded] && !s.flags[s.exploded];
}
