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
//   moves  本局有效操作次數(§4.2 判斷「新遊戲」要不要記錄)
//   fresh  剛冒出的新方塊位置 'r,c'(畫面動畫用)

export function maxTile(board) {
  return Math.max(0, ...board.flat());
}

export function initState(rng = Math.random) {
  return { board: newBoard(rng), score: 0, prev: null, won: false, everWon: false, keepPlaying: false, over: false, moves: 0, fresh: null };
}

function findNewTile(beforeAdd, afterAdd) {
  for (let r = 0; r < afterAdd.length; r++) {
    for (let c = 0; c < afterAdd.length; c++) {
      if (beforeAdd[r][c] === 0 && afterAdd[r][c] !== 0) return `${r},${c}`;
    }
  }
  return null;
}

// 有效移動 → 新 state;遊戲已結束、勝利遮罩未選繼續、或無效移動 → 原 state(同一物件)。
export function stepState(state, dir, rng = Math.random) {
  if (state.over || (state.won && !state.keepPlaying)) return state;
  const r = move(state.board, dir);
  if (!r.moved) return state;
  const placed = addRandomTile(r.board, rng);
  const won = state.won || hasWon(placed);
  return {
    ...state,
    board: placed,
    score: state.score + r.gained,
    prev: { board: cloneBoard(state.board), score: state.score, won: state.won, keepPlaying: state.keepPlaying },
    won,
    everWon: !!state.everWon || won,
    over: !canMove(placed),
    moves: state.moves + 1,
    fresh: findNewTile(r.board, placed),
  };
}

export function undoState(state) {
  if (!state.prev) return state;
  const { board, score, won, keepPlaying } = state.prev;
  return { ...state, board: cloneBoard(board), score, won, keepPlaying, over: false, prev: null, fresh: null };
}

export function continueState(state) {
  return { ...state, keepPlaying: true };
}

// 存檔(續玩):只存可序列化欄位;over 由棋盤重算。
export function toSave(state) {
  const { board, score, prev, won, everWon, keepPlaying, moves } = state;
  return { board, score, prev, won, everWon, keepPlaying, moves };
}

export function fromSave(saved) {
  const prev = saved.prev
    ? { board: saved.prev.board, score: saved.prev.score, won: !!saved.prev.won, keepPlaying: !!saved.prev.keepPlaying }
    : null;
  return {
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
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
const isBool = (v) => typeof v === 'boolean';
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isBoard = (b) => Array.isArray(b) && b.length === SIZE
  && b.every((row) => Array.isArray(row) && row.length === SIZE && row.every(isCount));

export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (!isBoard(s.board) || !isCount(s.score) || !isBool(s.won) || !isBool(s.keepPlaying)) return false;
  if (s.everWon !== undefined && !isBool(s.everWon)) return false;
  if (s.moves !== undefined && !isCount(s.moves)) return false;
  if (s.prev === null || s.prev === undefined) return true;
  const p = s.prev;
  return typeof p === 'object' && isBoard(p.board) && isCount(p.score) && isBool(p.won) && isBool(p.keepPlaying);
}
