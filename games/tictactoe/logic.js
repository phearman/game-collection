// 井字棋規則與狀態轉移；純函式，亂數由呼叫端注入。
export const PLAYER = 'X';
export const AI = 'O';
export const DIFFICULTIES = ['normal', 'hard'];
export const ORDERS = ['player', 'ai', 'alternate', 'random'];
const FIRSTS = ['player', 'ai'];

export function chooseFirst(order = 'player', previousFirst = null, rng = Math.random) {
  if (!ORDERS.includes(order)) throw new Error('unknown order');
  if (order === 'alternate') return previousFirst === 'player' ? 'ai' : 'player';
  if (order === 'random') return rng() < 0.5 ? 'player' : 'ai';
  return order;
}
export const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];

export function legalMoves(board) {
  return board.flatMap((cell, i) => cell === null ? [i] : []);
}

export function winningLine(board) {
  return WIN_LINES.find(([a, b, c]) => board[a] !== null && board[a] === board[b] && board[b] === board[c]) ?? null;
}

export function resultFor(board) {
  const line = winningLine(board);
  if (line) return board[line[0]] === PLAYER ? 'win' : 'lose';
  return legalMoves(board).length === 0 ? 'draw' : null;
}

export function scoreFor(result) {
  return result === 'win' ? 3 : result === 'draw' ? 1 : 0;
}

function placed(board, index, mark) {
  return board.map((cell, i) => i === index ? mark : cell);
}

function minimax(board, turn) {
  const result = resultFor(board);
  if (result) return result === 'lose' ? 1 : result === 'win' ? -1 : 0;
  const values = legalMoves(board).map((i) => minimax(placed(board, i, turn), turn === AI ? PLAYER : AI));
  return turn === AI ? Math.max(...values) : Math.min(...values);
}

export function bestMove(board) {
  if (resultFor(board)) return null;
  const legal = legalMoves(board);
  // 陣列依格號遞增，同優先序／同分只取第一格。
  for (const mark of [AI, PLAYER]) {
    const immediate = legal.find((i) => winningLine(placed(board, i, mark)));
    if (immediate !== undefined) return immediate;
  }
  let best = null;
  let value = -Infinity;
  for (const i of legal) {
    const candidate = minimax(placed(board, i, AI), PLAYER);
    if (candidate > value) { value = candidate; best = i; }
  }
  return best;
}

export function chooseAiMove(board, difficulty = 'normal', rng = Math.random) {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('unknown difficulty');
  if (resultFor(board)) return null;
  if (difficulty === 'normal' && rng() < 0.5) {
    const legal = legalMoves(board);
    return legal[Math.floor(rng() * legal.length)];
  }
  return bestMove(board);
}

export function initState(difficulty = 'normal', order = 'player', previousFirst = null, rng = Math.random) {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('unknown difficulty');
  const first = chooseFirst(order, previousFirst, rng);
  return { board: Array(9).fill(null), turn: first === 'player' ? PLAYER : AI, first, order, result: null, score: 0, difficulty, moves: 0, prev: null };
}

export function newGameState(state, difficulty = state.difficulty, order = state.order, rng = Math.random) {
  return initState(difficulty, order, state.first, rng);
}

function afterMove(state, board, nextTurn) {
  const result = resultFor(board);
  return { ...state, board, result, score: scoreFor(result), turn: result ? null : nextTurn };
}

export function stepState(state, index) {
  if (state.result || state.turn !== PLAYER || !Number.isInteger(index) || index < 0 || index > 8 || state.board[index] !== null) return state;
  return afterMove({ ...state, prev: { board: state.board.slice() }, moves: state.moves + 1 }, placed(state.board, index, PLAYER), AI);
}

export function aiStepState(state, rng = Math.random) {
  if (state.result || state.turn !== AI) return state;
  return afterMove(state, placed(state.board, chooseAiMove(state.board, state.difficulty, rng), AI), PLAYER);
}

export function undoState(state) {
  if (state.result || !state.prev) return state;
  // moves 保留有效操作累計，避免下子再復原後被視為零操作局。
  return { ...state, board: state.prev.board.slice(), turn: PLAYER, result: null, score: 0, prev: null };
}

export function cursorMove(index, direction) {
  const row = Math.floor(index / 3);
  const col = index % 3;
  if (direction === 'ArrowLeft') return row * 3 + Math.max(0, col - 1);
  if (direction === 'ArrowRight') return row * 3 + Math.min(2, col + 1);
  if (direction === 'ArrowUp') return Math.max(0, row - 1) * 3 + col;
  if (direction === 'ArrowDown') return Math.min(2, row + 1) * 3 + col;
  return index;
}

const isBoard = (b) => Array.isArray(b) && b.length === 9 && Array.from(b).every((v) => v === null || v === PLAYER || v === AI);
const count = (b, mark) => b.filter((v) => v === mark).length;

function validBoard(board, first) {
  if (!isBoard(board)) return false;
  const x = count(board, PLAYER);
  const o = count(board, AI);
  const starter = first === 'player' ? PLAYER : AI;
  const leading = first === 'player' ? x : o;
  const following = first === 'player' ? o : x;
  if (leading !== following && leading !== following + 1) return false;
  const winners = [PLAYER, AI].filter((mark) => WIN_LINES.some((line) => line.every((i) => board[i] === mark)));
  if (winners.length > 1) return false;
  if (winners.length) {
    const mark = winners[0];
    if (mark === starter ? leading !== following + 1 : leading !== following) return false;
    // 最後一子之前不可已結束。
    return board.some((cell, i) => cell === mark && !resultFor(placed(board, i, null)));
  }
  return true;
}

export function isValidState(s) {
  if (!s || typeof s !== 'object' || !FIRSTS.includes(s.first) || !ORDERS.includes(s.order)
    || !validBoard(s.board, s.first) || !DIFFICULTIES.includes(s.difficulty)) return false;
  if (FIRSTS.includes(s.order) && s.order !== s.first) return false;
  if (!Number.isInteger(s.moves) || s.moves < count(s.board, PLAYER)) return false;
  const result = resultFor(s.board);
  const equal = count(s.board, PLAYER) === count(s.board, AI);
  const turn = result ? null : (equal === (s.first === 'player') ? PLAYER : AI);
  if (s.result !== result || s.score !== scoreFor(result) || s.turn !== turn) return false;
  if (s.prev === null) return true;
  if (!s.prev || !validBoard(s.prev.board, s.first) || resultFor(s.prev.board)) return false;
  const before = s.prev.board;
  if (count(before, AI) !== count(before, PLAYER) + (s.first === 'ai' ? 1 : 0)
    || count(s.board, PLAYER) !== count(before, PLAYER) + 1) return false;
  if (count(s.board, AI) - count(before, AI) < 0 || count(s.board, AI) - count(before, AI) > 1) return false;
  return before.every((cell, i) => cell === null || s.board[i] === cell);
}

// 說明盤面由實際狀態轉移計算：一次無效落子與玩家連線成功。
export function demoSteps() {
  const first = stepState(initState(), 0);
  const second = aiStepState(first, () => 0); // AI 下格 1
  const third = stepState(second, 3);
  const fourth = aiStepState(third, () => 0); // AI 下格 2
  return [
    { before: second.board, after: stepState(second, 0).board, caption: '已占格不能再下，棋盤保持原樣。' },
    { before: second.board, after: third.board, caption: '輪到玩家，在左側中格下 ✕。' },
    { before: fourth.board, after: stepState(fourth, 6).board, caption: '左側三個 ✕ 連線，玩家勝利得 3 分。' },
  ];
}
