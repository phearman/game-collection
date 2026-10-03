// 2048 規則層:純函式,不碰 DOM。棋盤 = size×size 的二維陣列,0 代表空格。
// 規則正典:workbook/plans/2048.md「規則(驗收依據)」。

export const SIZE = 4;
export const TARGET = 2048;

export function emptyBoard(size = SIZE) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// 單列往左滑:先擠掉空格,再由左往右兩兩合併,每塊每回合只合併一次。
export function slideRow(row) {
  const tiles = row.filter((v) => v !== 0);
  const out = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      const merged = tiles[i] * 2;
      out.push(merged);
      gained += merged;
      i++;
    } else {
      out.push(tiles[i]);
    }
  }
  while (out.length < row.length) out.push(0);
  return { row: out, gained };
}

function transpose(board) {
  return board[0].map((_, c) => board.map((row) => row[c]));
}

function reverseRows(board) {
  return board.map((row) => row.slice().reverse());
}

// 把任一方向轉成「往左」處理,再轉回來。
const TO_LEFT = {
  left: (b) => b,
  right: reverseRows,
  up: transpose,
  down: (b) => reverseRows(transpose(b)),
};
const FROM_LEFT = {
  left: (b) => b,
  right: reverseRows,
  up: transpose,
  down: (b) => transpose(reverseRows(b)),
};

export function move(board, dir) {
  if (!TO_LEFT[dir]) throw new Error(`unknown direction: ${dir}`);
  let gained = 0;
  const slid = TO_LEFT[dir](board).map((row) => {
    const r = slideRow(row);
    gained += r.gained;
    return r.row;
  });
  const next = FROM_LEFT[dir](slid);
  const moved = next.some((row, r) => row.some((v, c) => v !== board[r][c]));
  return { board: next, gained, moved };
}

export function emptyCells(board) {
  const cells = [];
  board.forEach((row, r) => row.forEach((v, c) => { if (v === 0) cells.push([r, c]); }));
  return cells;
}

// rng 可注入,測試時傳固定序列。新方塊 90% 為 2、10% 為 4。
export function addRandomTile(board, rng = Math.random) {
  const cells = emptyCells(board);
  if (cells.length === 0) return board;
  const [r, c] = cells[Math.floor(rng() * cells.length)];
  const next = cloneBoard(board);
  next[r][c] = rng() < 0.9 ? 2 : 4;
  return next;
}

export function newBoard(rng = Math.random, size = SIZE) {
  return addRandomTile(addRandomTile(emptyBoard(size), rng), rng);
}

export function canMove(board) {
  const n = board.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = board[r][c];
      if (v === 0) return true;
      if (c + 1 < n && board[r][c + 1] === v) return true;
      if (r + 1 < n && board[r + 1][c] === v) return true;
    }
  }
  return false;
}

export function hasWon(board, target = TARGET) {
  return board.some((row) => row.some((v) => v >= target));
}

// 該顯示哪個遮罩:
//   'won'      達成 2048、尚未選擇繼續,還有路可走 → 可選「繼續玩」
//   'won-over' 達成 2048 的同一步就無路可走 → 仍算勝利,只給「新遊戲」(D10)
//   'over'     遊戲結束(含選擇繼續玩之後才卡死)
//   null       不顯示
export function overlayFor({ over, won, keepPlaying }) {
  if (won && !keepPlaying) return over ? 'won-over' : 'won';
  if (over) return 'over';
  return null;
}

// ---- 狀態轉移(IR2:從 ui.js 移入,純函式)----
// state = { board, score, prev, won, everWon, keepPlaying, over, moves, fresh }
//   prev   上一步快照 { board, score, won, keepPlaying },復原一次只退一步
//   won    遮罩用:目前盤面已達成(復原可清掉)
//   everWon 本局曾勝利(復原不清掉;結算 win/lose 依它)
//   settled 本局已結算(不存檔;結算後不可移動、不可復原)
//   moves  本局有效操作次數(§4.2 判斷「新遊戲」要不要記錄)
//   fresh  剛冒出的新方塊位置 'r,c'(畫面動畫用)

export function maxTile(board) {
  return Math.max(0, ...board.flat());
}

// kids = 小朋友模式(RS6,輔助局):復原不限步(history,上限 HISTORY_LIMIT)、顯示建議方向。一般模式維持只退一步。
export const HISTORY_LIMIT = 500;

export function initState(rng = Math.random, { kids = false } = {}) {
  const state = { board: newBoard(rng), score: 0, prev: null, won: false, everWon: false, keepPlaying: false, over: false, moves: 0, fresh: null };
  return kids ? { ...state, kids: true, history: [] } : state;
}

function findNewTile(beforeAdd, afterAdd) {
  for (let r = 0; r < afterAdd.length; r++) {
    for (let c = 0; c < afterAdd.length; c++) {
      if (beforeAdd[r][c] === 0 && afterAdd[r][c] !== 0) return `${r},${c}`;
    }
  }
  return null;
}

// 還能移動:未結算、未結束、不在「勝利遮罩未選繼續」。
export function isPlayable(state) {
  return !state.settled && !state.over && !(state.won && !state.keepPlaying);
}

// 無效移動(可玩但這個方向棋盤不變)⇒ 畫面給回饋、不新增方塊(RS4)。
export function isInvalidMove(state, dir) {
  return isPlayable(state) && !move(state.board, dir).moved;
}

// 有效移動 → 新 state;不可玩或無效移動 → 原 state(同一物件)。
export function stepState(state, dir, rng = Math.random) {
  if (!isPlayable(state)) return state;
  const r = move(state.board, dir);
  if (!r.moved) return state;
  const placed = addRandomTile(r.board, rng);
  const won = state.won || hasWon(placed);
  const snap = { board: cloneBoard(state.board), score: state.score, won: state.won, keepPlaying: state.keepPlaying };
  return {
    ...state,
    ...(state.kids ? { history: [...(state.history ?? []), snap].slice(-HISTORY_LIMIT) } : {}),
    board: placed,
    score: state.score + r.gained,
    prev: snap,
    won,
    everWon: !!state.everWon || won,
    over: !canMove(placed),
    moves: state.moves + 1,
    fresh: findNewTile(r.board, placed),
  };
}

// 復原:一般模式一次只退一步;小朋友模式可連續退到 history 用完。結算後不可復原,未結算的勝利遮罩狀態仍可(RS1 起)。
export function canUndo(state) {
  if (state.settled) return false;
  return state.kids ? (state.history?.length ?? 0) > 0 : !!state.prev;
}

export function undoState(state) {
  if (!canUndo(state)) return state;
  if (state.kids) {
    const history = state.history.slice(0, -1);
    const { board, score, won, keepPlaying } = state.history.at(-1);
    return { ...state, board: cloneBoard(board), score, won, keepPlaying, over: false, history, prev: history.at(-1) ?? null, fresh: null };
  }
  const { board, score, won, keepPlaying } = state.prev;
  return { ...state, board: cloneBoard(board), score, won, keepPlaying, over: false, prev: null, fresh: null };
}

export function continueState(state) {
  if (state.settled) return state;
  return { ...state, keepPlaying: true };
}

// 結算後鎖定(不可移動、不可復原)。
export function settleState(state) {
  return { ...state, settled: true };
}

// 頂列顯示的最佳分數:已存的最佳與本局分數取大者。
export function shownBest(best, score) {
  return Math.max(Number(best) || 0, score);
}

// 存檔(續玩):只存可序列化欄位;over 由棋盤重算。
export function toSave(state) {
  const { board, score, prev, won, everWon, keepPlaying, moves } = state;
  const saved = { board, score, prev, won, everWon, keepPlaying, moves };
  return state.kids ? { ...saved, kids: true, history: state.history ?? [] } : saved;
}

export function fromSave(saved) {
  const prev = saved.prev
    ? { board: saved.prev.board, score: saved.prev.score, won: !!saved.prev.won, keepPlaying: !!saved.prev.keepPlaying }
    : null;
  const state = {
    board: saved.board,
    score: saved.score,
    prev,
    won: !!saved.won,
    everWon: !!(saved.everWon ?? saved.won),
    keepPlaying: !!saved.keepPlaying,
    over: !canMove(saved.board),
    moves: saved.moves ?? 0,
    fresh: null,
  };
  // 小朋友模式(輔助局)標記續玩後仍在
  return saved.kids ? { ...state, kids: true, history: (saved.history ?? []).map((h) => ({ ...h, board: cloneBoard(h.board) })) } : state;
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
const isBool = (v) => typeof v === 'boolean';
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isBoard = (b) => Array.isArray(b) && b.length === SIZE
  && b.every((row) => Array.isArray(row) && row.length === SIZE && row.every(isCount));

const isSnap = (p) => !!p && typeof p === 'object' && isBoard(p.board) && isCount(p.score) && isBool(p.won) && isBool(p.keepPlaying);

export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (!isBoard(s.board) || !isCount(s.score) || !isBool(s.won) || !isBool(s.keepPlaying)) return false;
  if (s.everWon !== undefined && !isBool(s.everWon)) return false;
  if (s.moves !== undefined && !isCount(s.moves)) return false;
  if (s.kids !== undefined && !isBool(s.kids)) return false;
  if (s.history !== undefined && !(s.kids === true && Array.isArray(s.history) && s.history.length <= HISTORY_LIMIT && s.history.every(isSnap))) return false;
  if (s.prev === null || s.prev === undefined) return true;
  return isSnap(s.prev);
}

// ---- 小朋友模式的建議方向(RS6 §3.2)----

const DIRS = ['left', 'down', 'right', 'up']; // 同分時的優先序
const EMPTY_WEIGHT = 2;
const CORNER_BONUS = 8;
const DIR_NAME = { left: '左', right: '右', up: '上', down: '下' };

// 某方向上每一條線的格子座標,依滑動方向由前到後(最靠牆的在前)。
function lines(n, dir) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const line = [];
    for (let j = 0; j < n; j++) {
      if (dir === 'left') line.push([i, j]);
      if (dir === 'right') line.push([i, n - 1 - j]);
      if (dir === 'up') line.push([j, i]);
      if (dir === 'down') line.push([n - 1 - j, i]);
    }
    out.push(line);
  }
  return out;
}

// 這個方向實際會合併的方塊對 [[r,c],[r,c]];依真實規則:靠移動方向的先合、每塊每回合只合一次。
export function mergePairs(board, dir) {
  const pairs = [];
  for (const line of lines(board.length, dir)) {
    const cells = line.filter(([r, c]) => board[r][c] !== 0);
    for (let i = 0; i + 1 < cells.length; i++) {
      const [a, b] = [cells[i], cells[i + 1]];
      if (board[a[0]][a[1]] === board[b[0]][b[1]]) {
        pairs.push([a, b]);
        i++;
      }
    }
  }
  return pairs;
}

function cornerMax(board) {
  const n = board.length;
  const m = maxTile(board);
  return [[0, 0], [0, n - 1], [n - 1, 0], [n - 1, n - 1]].some(([r, c]) => board[r][c] === m);
}

// 建議方向:四個有效方向各模擬一步,評分 = 合併得分 + 空格數 × EMPTY_WEIGHT + 最大方塊在角落 CORNER_BONUS;
// 同分依 左 > 下 > 右 > 上。→ { dir, pairs, gained, reason } | null(沒有有效方向)
export function suggestMove(board) {
  let best = null;
  for (const dir of DIRS) {
    const r = move(board, dir);
    if (!r.moved) continue;
    const score = r.gained + emptyCells(r.board).length * EMPTY_WEIGHT + (cornerMax(r.board) ? CORNER_BONUS : 0);
    if (!best || score > best.score) best = { dir, score, gained: r.gained };
  }
  if (!best) return null;
  const pairs = mergePairs(board, best.dir);
  const name = DIR_NAME[best.dir];
  const reason = pairs.length ? `往${name}可以合 ${pairs.length} 組` : `往${name}走(這步沒有可以合的)`;
  return { dir: best.dir, pairs, gained: best.gained, reason };
}
