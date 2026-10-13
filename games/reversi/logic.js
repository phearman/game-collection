// 黑白棋規則與狀態轉移；不依賴 DOM，亂數與 AI 可由呼叫端注入。
export const BLACK = 1;
export const WHITE = 2;
export const DIFFICULTIES = ['normal', 'hard', 'expert'];
export const ORDERS = ['player', 'ai', 'alternate', 'random'];
export const AI_DELAY = 300;
export const PASS_DELAY = 1000;
const other = (color) => 3 - color;
const corners = [0, 7, 56, 63];
const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const rays = Array.from({ length: 64 }, (_, i) => directions.map(([dr, dc]) => {
  const ray = [];
  for (let r = (i >> 3) + dr, c = i % 8 + dc; r >= 0 && r < 8 && c >= 0 && c < 8; r += dr, c += dc) ray.push(r * 8 + c);
  return ray;
}));

export function flipsFor(board, index, color) {
  if (!Number.isInteger(index) || index < 0 || index >= 64 || board[index] !== 0) return [];
  const flips = [];
  for (const ray of rays[index]) {
    const line = [];
    for (const i of ray) {
      if (board[i] === other(color)) line.push(i);
      else { if (board[i] === color && line.length) flips.push(...line); break; }
    }
  }
  return flips;
}

export function legalMoves(state, color = state.turn) {
  const moves = [];
  const opponent = other(color);
  squares: for (let i = 0; i < 64; i++) {
    if (state.board[i] !== 0) continue;
    // 搜尋只需判斷可下，不建立每個空格的翻子陣列。
    for (const ray of rays[i]) {
      let opponents = 0;
      for (const j of ray) {
        if (state.board[j] === opponent) opponents++;
        else {
          if (opponents > 0 && state.board[j] === color) { moves.push(i); continue squares; }
          break;
        }
      }
    }
  }
  return moves;
}
export const playerColor = (state) => state.first === 'player' ? BLACK : WHITE;
export const isPlayerTurn = (state) => !state.over && state.turn === playerColor(state);
export const counts = (state) => ({ black: state.board.filter((v) => v === BLACK).length, white: state.board.filter((v) => v === WHITE).length });
export function detailFor(state) {
  const discs = state.board.filter((v) => v === playerColor(state)).length;
  const opp_discs = state.board.filter((v) => v === other(playerColor(state))).length;
  return { discs, opp_discs, moves: state.moves, first: state.first };
}
export function resultFor(state) {
  if (!state.over) return null;
  const { discs, opp_discs } = detailFor(state);
  return discs > opp_discs ? 'win' : discs < opp_discs ? 'lose' : 'draw';
}
export function scoreFor(state) {
  return ['win', 'draw'].includes(resultFor(state)) ? detailFor(state).discs : 0;
}

export function chooseFirst(order = 'player', previousFirst = null, rng = Math.random) {
  if (!ORDERS.includes(order)) throw new Error('unknown order');
  if (order === 'alternate') return previousFirst === 'player' ? 'ai' : 'player';
  if (order === 'random') return rng() < 0.5 ? 'player' : 'ai';
  return order;
}
export function initState(difficulty = 'normal', order = 'player', previousFirst = null, rng = Math.random) {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('unknown difficulty');
  const board = Array(64).fill(0);
  board[27] = board[36] = WHITE;
  board[28] = board[35] = BLACK;
  return { board, turn: BLACK, first: chooseFirst(order, previousFirst, rng), order, difficulty, prev: null, moves: 0, over: false, passed: 0, last: null, flipped: [] };
}
export const newGameState = (state, difficulty = state.difficulty, order = state.order, rng = Math.random) => initState(difficulty, order, state.first, rng);

// 每次轉移都處理無步可下，存檔不會停在需要人工 pass 的狀態。
export function resolveTurn(state) {
  if (legalMoves(state).length) return { ...state, over: false, passed: 0 };
  if (legalMoves(state, other(state.turn)).length) return { ...state, turn: other(state.turn), passed: state.turn, over: false };
  return { ...state, over: true, passed: 0 };
}
function placed(board, index, color, flips = flipsFor(board, index, color)) {
  const next = board.slice();
  next[index] = color;
  for (const i of flips) next[i] = color;
  return next;
}
export function moveState(state, index) {
  if (state.over) return state;
  const flipped = flipsFor(state.board, index, state.turn);
  if (!flipped.length) return state;
  const player = isPlayerTurn(state);
  const prev = player ? { board: state.board.slice(), turn: state.turn, last: state.last } : state.prev;
  return resolveTurn({ ...state, board: placed(state.board, index, state.turn, flipped), turn: other(state.turn), moves: state.moves + Number(player), prev, last: index, flipped });
}
export const stepState = (state, index) => isPlayerTurn(state) ? moveState(state, index) : state;
export function aiStepState(state, rng = Math.random, choose = ai) {
  return state.over || isPlayerTurn(state) ? state : moveState(state, choose(state, state.difficulty, rng));
}
export const canUndo = (state) => !state.over && state.prev !== null;
export function undoState(state) {
  if (!canUndo(state)) return state;
  return { ...state, board: state.prev.board.slice(), turn: state.prev.turn, last: state.prev.last, prev: null, passed: 0, flipped: [], over: false };
}
export function cursorMove(index, key) {
  const row = index >> 3, col = index % 8;
  if (key === 'ArrowLeft') return row * 8 + Math.max(0, col - 1);
  if (key === 'ArrowRight') return row * 8 + Math.min(7, col + 1);
  if (key === 'ArrowUp') return Math.max(0, row - 1) * 8 + col;
  if (key === 'ArrowDown') return Math.min(7, row + 1) * 8 + col;
  return index;
}

// 對稱位置表：角穩定、未取得角時的相鄰格危險，行動力每步值 10。
export const WEIGHTS = [
  120, -25, 20, 5, 5, 20, -25, 120,
  -25, -45, -5, -5, -5, -5, -45, -25,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -25, -45, -5, -5, -5, -5, -45, -25,
  120, -25, 20, 5, 5, 20, -25, 120,
];
function positionValue(board, color) {
  let value = 0;
  for (let i = 0; i < 64; i++) value += board[i] === color ? WEIGHTS[i] : board[i] === other(color) ? -WEIGHTS[i] : 0;
  return value;
}
export function evaluate(board, color) {
  return positionValue(board, color) + 10 * (legalMoves({ board, turn: color }).length - legalMoves({ board, turn: other(color) }).length);
}
function search(board, turn, color, depth, alpha, beta) {
  const legal = legalMoves({ board, turn });
  if (!legal.length) {
    if (!legalMoves({ board, turn: other(turn) }).length) {
      const diff = board.filter((v) => v === color).length - board.filter((v) => v === other(color)).length;
      return Math.sign(diff) * 100000 + diff;
    }
    return search(board, other(turn), color, depth, alpha, beta);
  }
  if (depth === 0) {
    const oppositeMoves = legalMoves({ board, turn: other(turn) }).length;
    const mobility = legal.length - oppositeMoves;
    return positionValue(board, color) + 10 * (turn === color ? mobility : -mobility);
  }
  let value = turn === color ? -Infinity : Infinity;
  for (const index of legal) {
    const next = search(placed(board, index, turn), other(turn), color, depth - 1, alpha, beta);
    if (turn === color) { value = Math.max(value, next); alpha = Math.max(alpha, value); }
    else { value = Math.min(value, next); beta = Math.min(beta, value); }
    if (alpha >= beta) break;
  }
  return value;
}
export function ai(state, level = state.difficulty, rng = Math.random) {
  if (!DIFFICULTIES.includes(level)) throw new Error('unknown difficulty');
  if (state.over) return null;
  const legal = legalMoves(state);
  if (!legal.length) return null;
  if (level === 'normal') return legal[Math.min(legal.length - 1, Math.max(0, Math.floor(rng() * legal.length)))];
  if (level === 'hard') {
    const corner = legal.find((i) => corners.includes(i));
    if (corner !== undefined) return corner;
    return legal.reduce((best, i) => flipsFor(state.board, i, state.turn).length > flipsFor(state.board, best, state.turn).length ? i : best);
  }
  let best = legal[0], value = -Infinity;
  for (const index of legal) {
    const candidate = search(placed(state.board, index, state.turn), other(state.turn), state.turn, 2, value, Infinity);
    if (candidate > value) { value = candidate; best = index; }
  }
  return best;
}

function validBoard(board) {
  return Array.isArray(board) && board.length === 64 && Array.from(board).every((v) => [0, BLACK, WHITE].includes(v))
    && board.filter(Boolean).length >= 4 && [27, 28, 35, 36].every((i) => board[i] !== 0);
}
const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < 64;
export function isValidState(s) {
  if (!s || !validBoard(s.board) || ![BLACK, WHITE].includes(s.turn) || !['player', 'ai'].includes(s.first)
    || !ORDERS.includes(s.order) || !DIFFICULTIES.includes(s.difficulty) || !Number.isSafeInteger(s.moves) || s.moves < 0
    || typeof s.over !== 'boolean' || ![0, BLACK, WHITE].includes(s.passed)
    || !(s.last === null || validIndex(s.last) && s.board[s.last] !== 0)
    || !Array.isArray(s.flipped) || !Array.from(s.flipped).every((i) => validIndex(i) && s.board[i] !== 0)
    || new Set(s.flipped).size !== s.flipped.length) return false;
  if (['player', 'ai'].includes(s.order) && s.first !== s.order) return false;
  const legal = legalMoves(s), opposite = legalMoves(s, other(s.turn));
  if (s.over !== (!legal.length && !opposite.length) || !s.over && !legal.length) return false;
  if (s.passed && (s.over || s.passed !== other(s.turn) || opposite.length)) return false;
  if (s.prev === null) return true;
  const p = s.prev;
  return !!p && validBoard(p.board) && p.turn === playerColor(s) && legalMoves(p).length > 0 && s.moves > 0
    && (p.last === null || validIndex(p.last) && p.board[p.last] !== 0)
    && p.board.filter(Boolean).length < s.board.filter(Boolean).length
    && p.board.every((v, i) => !v || s.board[i] !== 0);
}

export const HELP_RULES = [
  '黑棋先下，先手執黑；可選我先、AI 先、輪流或隨機。',
  '點空格，夾住對方棋子就全部翻色；淡點提示可下位置，可關閉。',
  '方向鍵選格，Enter／空白鍵落子；無法夾子不能下。',
  '無處可下自動跳過；雙方都無步可下時結束。',
  '復原退回自己上一步，含 AI 回應；結束後不能復原。',
  '子多者勝，相同平手；勝或平手得自己的終局子數，敗得零分；最佳為單局最高。',
];
export function demoSteps() {
  const opening = initState(), black = stepState(opening, 19), white = aiStepState(black, () => 0);
  const passBoard = Array(64).fill(WHITE);
  passBoard[0] = 0; passBoard[1] = BLACK;
  const beforePass = { ...opening, board: passBoard };
  const afterPass = resolveTurn(beforePass);
  return [
    { before: opening.board, after: black.board, kind: 'ok', caption: '黑棋下在第三列第四格，夾住的白棋翻黑。' },
    { before: black.board, after: white.board, kind: 'ok', caption: '接著白棋落子，夾住的黑棋翻白。' },
    { before: white.board, after: stepState(white, 0).board, kind: 'fail', caption: '黑棋點左上空格，夾不到白棋，盤面不變。' },
    { before: beforePass.board, after: afterPass.board, caption: '黑棋無處可下，跳過後輪到白棋下左上角。', passed: afterPass.passed, turn: afterPass.turn },
  ];
}
