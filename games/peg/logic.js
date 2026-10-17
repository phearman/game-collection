// 孔明棋(英式 33 孔)規則與狀態轉移;純函式,不碰 DOM。
export const SIZE = 7;
export const OFF = -1;
export const EMPTY = 0;
export const PEG = 1;
export const CENTER = 24;
export const TOTAL_HOLES = 33;
export const START_PEGS = 32;

const rowOf = (i) => Math.floor(i / SIZE);
const colOf = (i) => i % SIZE;
const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE && (r >= 2 && r <= 4 || c >= 2 && c <= 4);
// 盤面內的 33 個格號(由小到大)。
export const HOLES = Array.from({ length: SIZE * SIZE }, (_, i) => i).filter((i) => inBoard(rowOf(i), colOf(i)));
const HOLE_SET = new Set(HOLES);
export const isHole = (i) => HOLE_SET.has(i);

// 所有可能的跳法 [起點, 被跳, 落點](只有上下左右)。
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const JUMPS = HOLES.flatMap((from) => DIRS.flatMap(([dr, dc]) => {
  const r = rowOf(from), c = colOf(from);
  if (!inBoard(r + dr, c + dc) || !inBoard(r + 2 * dr, c + 2 * dc)) return [];
  return [[from, (r + dr) * SIZE + c + dc, (r + 2 * dr) * SIZE + c + 2 * dc]];
}));
const JUMPS_FROM = new Map(HOLES.map((i) => [i, JUMPS.filter(([from]) => from === i)]));

export function openingBoard() {
  const board = Array.from({ length: SIZE * SIZE }, (_, i) => (isHole(i) ? PEG : OFF));
  board[CENTER] = EMPTY;
  return board;
}

export function initState() {
  return { board: openingBoard(), history: [], selected: null, over: false, hintUsed: false, moves: 0, undos: 0 };
}

export const pegCount = (board) => board.reduce((n, v) => n + (v === PEG ? 1 : 0), 0);

// board 上某格出發的合法跳法。
export function jumpsFrom(board, from) {
  if (board[from] !== PEG) return [];
  return (JUMPS_FROM.get(from) ?? []).filter(([, over, to]) => board[over] === PEG && board[to] === EMPTY).map((j) => j.slice());
}
export function legalMoves(board) {
  return JUMPS.filter(([from, over, to]) => board[from] === PEG && board[over] === PEG && board[to] === EMPTY).map((j) => j.slice());
}
export const hasMoves = (board) => JUMPS.some(([from, over, to]) => board[from] === PEG && board[over] === PEG && board[to] === EMPTY);
// 從 from 跳到 to 的跳法;不合法回 null。
export function findJump(board, from, to) {
  return jumpsFrom(board, from).find((j) => j[2] === to) ?? null;
}

function applyJump(board, [from, over, to]) {
  const next = board.slice();
  next[from] = EMPTY; next[over] = EMPTY; next[to] = PEG;
  return next;
}

// 點選棋子:選取 / 再點取消 / 點另一顆改選。非棋子或已結束不變。
export function selectState(state, index) {
  if (state.over || state.board[index] !== PEG) return state;
  return { ...state, selected: state.selected === index ? null : index };
}

// 從 from 跳到 to;不合法(含斜跳、跳空孔、跳出盤面)回傳原 state。
export function jumpState(state, from, to) {
  if (state.over) return state;
  const jump = findJump(state.board, from, to);
  if (!jump) return state;
  const board = applyJump(state.board, jump);
  return { ...state, board, history: [...state.history, jump], selected: null, over: !hasMoves(board), moves: state.history.length + 1 };
}

// 一次點擊:有選取且點到可落點就跳,否則交給選取。
export function tapState(state, index) {
  if (state.over) return state;
  if (state.selected !== null && state.board[index] === EMPTY) return jumpState(state, state.selected, index);
  return selectState(state, index);
}

// 結束即結算,結束後不可復原。
export const canUndo = (state) => !state.over && state.history.length > 0;
// 復原一步;步數(moves)隨盤面扣回,復原次數另記 undos。
export function undoState(state) {
  if (!canUndo(state)) return state;
  const [from, over, to] = state.history.at(-1);
  const board = state.board.slice();
  board[from] = PEG; board[over] = PEG; board[to] = EMPTY;
  return { ...state, board, history: state.history.slice(0, -1), selected: null, moves: state.history.length - 1, undos: state.undos + 1 };
}

export const hintState = (state) => (state.hintUsed ? state : { ...state, hintUsed: true });

// ---- 結果、評等、分數 ----
export function resultFor(state) {
  if (!state.over) return null;
  return pegCount(state.board) === 1 ? 'win' : 'lose';
}
export const isPerfect = (board) => pegCount(board) === 1 && board[CENTER] === PEG;
export function gradeFor(board) {
  const n = pegCount(board);
  if (n === 1) return board[CENTER] === PEG ? '天才' : '優秀';
  return n === 2 ? '很棒' : n === 3 ? '不錯' : '再接再厲';
}
export const scoreFor = (state) => TOTAL_HOLES - pegCount(state.board) + (isPerfect(state.board) ? 5 : 0);
export function detailFor(state) {
  return {
    pegs_left: pegCount(state.board), center: isPerfect(state.board), moves: state.moves,
    undos: state.undos, hint_used: state.hintUsed,
  };
}
// 開新局時本局要記的結果:已結束 ⇒ win/lose;有走過(含走過再復原)但未結束 ⇒ quit;沒操作 ⇒ 不記。
export function newGameResult(state) {
  if (state.over) return resultFor(state);
  return state.history.length > 0 || state.undos > 0 ? 'quit' : null;
}

// ---- 提示:深度優先搜尋 + 盤面記憶化 ----
// 33 孔對應 0..32 的位元;盤面鍵 = Σ 2^bit(< 2^33,double 可精確表示)。
// 8 種旋轉/鏡射的鍵同步增量更新,取最小者當記憶化鍵,對稱盤面只算一次。
const BIT = new Map(HOLES.map((cell, bit) => [cell, bit]));
const SYMMETRIES = [
  (r, c) => [r, c], (r, c) => [c, 6 - r], (r, c) => [6 - r, 6 - c], (r, c) => [6 - c, r],
  (r, c) => [r, 6 - c], (r, c) => [6 - r, c], (r, c) => [c, r], (r, c) => [6 - c, 6 - r],
];
// SYM_POW[t][bit] = 對稱 t 下該位元對應的 2 的次方。
const SYM_POW = SYMMETRIES.map((f) => HOLES.map((cell) => {
  const [r, c] = f(rowOf(cell), colOf(cell));
  return 2 ** BIT.get(r * SIZE + c);
}));
const JUMP_BITS = JUMPS.map(([a, b, c]) => [BIT.get(a), BIT.get(b), BIT.get(c)]);
// 位置類別:以 (r+c) mod 3 與 (r−c) mod 3 兩組斜線上棋數的奇偶為簽章,跳一步只會整組翻轉;
// 只有簽章相同的孔才可能是最後剩下的那一顆。
const SIG_BITS = HOLES.map((cell) => {
  const r = rowOf(cell), c = colOf(cell);
  return (1 << ((r + c) % 3)) | (1 << (3 + ((r - c + 6) % 3)));
});
// 跳一步會讓同一組三條斜線的奇偶同時翻轉,所以每組 3 位元與其補數視為同類。
const normalize = (sig) => [0, 3].reduce((n, shift) => ((n >> shift) & 1 ? n ^ (7 << shift) : n), sig);
const signature = (bits) => normalize(bits.reduce((sig, v, bit) => (v ? sig ^ SIG_BITS[bit] : sig), 0));
// Pagoda 函數:對每一種跳法都滿足 p(起點)+p(被跳) ≥ p(落點),所以盤面權重和只會變小或不變。
// 若對每個可能的最後一孔 h 都有某個 p 使「目前權重和 < p(h)」,就不可能剩一顆,直接剪枝。
// 以下 6 組(依 HOLES 順序)以線性規劃離線找出,再展開 8 種對稱;正確性由測試逐條驗證。
const PAGODA_BASE = [
  [-3, 0, -3, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 3, -3, 0, -3],
  [-3, 3, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, -1, 1, 0],
  [-3, 0, -3, 3, 3, 3, -1, 1, 0, 1, 0, 1, -1, 1, 2, 3, 3, 3, 1, 3, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, -3, 0, -3],
  [-1, 1, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 3, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 1, 3, 0, -1, 3, 0],
  [-3, 1, -2, 3, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 3, 3, 2, -3, 3, -2],
  [-3, 0, -3, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 0, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 3, -3, 0, -3],
];
const SYM_BIT = SYMMETRIES.map((f) => HOLES.map((cell) => {
  const [r, c] = f(rowOf(cell), colOf(cell));
  return BIT.get(r * SIZE + c);
}));
export const PAGODAS = [...new Map(PAGODA_BASE.flatMap((base) => SYM_BIT.map((map) => {
  const p = Array(HOLES.length).fill(0);
  base.forEach((v, bit) => { p[map[bit]] = v; });
  return p;
})).map((p) => [p.join(','), p])).values()];
// 以格號表示的 pagoda(測試用)。
export const PAGODA_CELLS = PAGODAS.map((p) => Object.fromEntries(HOLES.map((cell, bit) => [cell, p[bit]])));

// 已知無法剩一顆的盤面(對稱正規化的鍵)與已知可解的盤面(原盤面的鍵 → 下一步跳法編號),
// 跨呼叫共用,上限避免記憶體無限成長。
const DEAD = new Set();
const DEAD_LIMIT = 1_000_000;
const LIVE = new Map();
const LIVE_LIMIT = 200_000;
// 被時間打斷的搜尋進度(依盤面,保留最近幾盤);同一盤再按提示時接著算,不從頭來。
const SUSPENDED = new Map();
const SUSPENDED_LIMIT = 4;
// 單次提示的時間預算:含冷快取最多 300ms,預留結果處理與畫面時間。
export const HINT_BUDGET_MS = 200;
// 每走訪這麼多個盤面看一次時鐘(含快取命中),慢機器上也能準時停。
const CLOCK_EVERY = 64;
const clock = () => globalThis.performance?.now() ?? Date.now();
// 搜尋順序:先動外圈(起點與被跳者離中央遠、落點靠中央),冷快取下節點數大幅減少。
const dist = (i) => Math.abs(rowOf(i) - 3) + Math.abs(colOf(i) - 3);
const outward = ([a, b, c]) => dist(a) + dist(b) - dist(c);
const JUMP_ORDER = JUMPS.map((_, j) => j).sort((x, y) => outward(JUMPS[y]) - outward(JUMPS[x]) || x - y);
const JUMP_INDEX = new Map(JUMPS.map(([a, , c], j) => [`${a},${c}`, j]));
const boardKey = (board) => HOLES.reduce((k, cell, bit) => k + (board[cell] === PEG ? 2 ** bit : 0), 0);
// 內建一組由開局走到剩 1 顆的完整解(本程式搜尋算出);8 種旋轉/鏡射都登記,沿這條路走的提示不必搜尋。
const KNOWN_SOLUTION = [[10, 24], [15, 17], [2, 16], [4, 2], [17, 15], [14, 16], [18, 4], [20, 18], [23, 9], [2, 16],
  [21, 23], [23, 9], [25, 11], [4, 18], [27, 25], [25, 11], [37, 23], [28, 30], [30, 16], [9, 23], [23, 25], [32, 18],
  [11, 25], [34, 32], [31, 33], [46, 32], [25, 39], [44, 46], [46, 32], [33, 31], [31, 45]];
function seedKnown() {
  for (const f of SYMMETRIES) {
    const map = (i) => { const [r, c] = f(rowOf(i), colOf(i)); return r * SIZE + c; };
    let board = openingBoard();
    for (const [a, c] of KNOWN_SOLUTION) {
      const j = JUMP_INDEX.get(`${map(a)},${map(c)}`);
      LIVE.set(boardKey(board), j);
      board = applyJump(board, JUMPS[j]);
    }
  }
}
seedKnown();
function remember(key, j) {
  if (LIVE.size >= LIVE_LIMIT) { LIVE.clear(); seedKnown(); }
  LIVE.set(key, j);
}
// 測試用:清空快取與暫存進度,模擬第一次開頁(冷快取)。
export function resetHintCache() { DEAD.clear(); LIVE.clear(); SUSPENDED.clear(); seedKnown(); }

function prunable(vals, targets) {
  for (const checks of targets) {
    if (!checks.some(([k, need]) => vals[k] < need)) return false;
  }
  return true;
}
function move(bits, keys, vals, [a, b, c], dir) {
  bits[a] = dir < 0 ? 1 : 0; bits[b] = bits[a]; bits[c] = 1 - bits[a];
  for (let t = 0; t < 8; t++) keys[t] += dir * (SYM_POW[t][c] - SYM_POW[t][a] - SYM_POW[t][b]);
  for (let k = 0; k < PAGODAS.length; k++) vals[k] += dir * (PAGODAS[k][c] - PAGODAS[k][a] - PAGODAS[k][b]);
}
const minKey = (keys) => { let key = keys[0]; for (let t = 1; t < 8; t++) if (keys[t] < key) key = keys[t]; return key; };

// 深度優先搜尋,以顯式堆疊進行,隨時可停、下次接著算。
// 每層 frame = { here: 原盤面鍵, dead: 正規化鍵, jump: 進到這層的跳法, next: JUMP_ORDER 的下一個位置,
// open: 是否已展開, known: 是否命中已知死局 }。
// 回傳 'move'(job.found = root 的可解步)/ 'none' / 'stop'(時間或節點用完,進度留在 job)。
function runSearch(job, ctx) {
  const { bits, keys, vals, frames, targets } = job;
  for (;;) {
    const frame = frames.at(-1);
    const depth = frames.length - 1;
    if (!frame.open) {
      if (++ctx.ticks % CLOCK_EVERY === 0 && ctx.now() > ctx.deadline) return 'stop';
      if (ctx.onTick) ctx.onTick();
      if (depth > 0 && (job.pegs === 1 || LIVE.has(frame.here))) {
        // 找到一條到剩 1 顆的路:沿路登記可解盤面與下一步。
        for (let i = 1; i < frames.length; i++) remember(frames[i - 1].here, frames[i].jump);
        job.found = frames[1].jump;
        return 'move';
      }
      frame.dead = minKey(keys);
      if (depth > 0 && DEAD.has(frame.dead)) { frame.next = JUMP_ORDER.length; frame.known = true; }
      else {
        if (++ctx.nodes > ctx.limit) return 'stop';
        if (prunable(vals, targets)) frame.next = JUMP_ORDER.length;
      }
      frame.open = true;
    }
    let child = -1;
    while (frame.next < JUMP_ORDER.length) {
      const j = JUMP_ORDER[frame.next++];
      const [a, b, c] = JUMP_BITS[j];
      if (bits[a] && bits[b] && !bits[c]) { child = j; break; }
    }
    if (child >= 0) {
      move(bits, keys, vals, JUMP_BITS[child], 1);
      job.pegs--;
      frames.push({ here: keys[0], dead: 0, jump: child, next: 0, open: false, known: false });
      continue;
    }
    // 這層所有跳法都試過:無法剩一顆。
    if (!frame.known) {
      if (DEAD.size >= DEAD_LIMIT) DEAD.clear();
      DEAD.add(frame.dead);
    }
    if (depth === 0) return 'none';
    frames.pop();
    move(bits, keys, vals, JUMP_BITS[frame.jump], -1);
    job.pegs++;
  }
}

// 找一個仍能走到剩 1 顆的下一步。
// 回傳 { status: 'move', move: [起點, 被跳, 落點] } / { status: 'none' }(已無法剩一顆)/
// { status: 'unknown' }(超過時間預算或節點上限,不下結論;同一盤再呼叫會接著算)。stats.nodes 記本次展開的節點數。
// onTick:測試用,每走訪一個盤面呼叫一次(模擬慢機器)。
export function findHint(board, { budgetMs = HINT_BUDGET_MS, limit = Infinity, now = clock, stats, onTick } = {}) {
  const ctx = { nodes: 0, ticks: 0, limit, now, onTick, deadline: now() + budgetMs };
  const done = (out) => { if (stats) stats.nodes = ctx.nodes; return out; };
  const pegs = pegCount(board);
  if (pegs <= 1 || !hasMoves(board)) return done({ status: 'none' });
  const bits = HOLES.map((cell) => (board[cell] === PEG ? 1 : 0));
  const rootKey = boardKey(board);
  const known = LIVE.get(rootKey);
  if (known !== undefined) { SUSPENDED.delete(rootKey); return done({ status: 'move', move: JUMPS[known].slice() }); }
  let job = SUSPENDED.get(rootKey);
  SUSPENDED.delete(rootKey);
  if (!job) {
    const sig = signature(bits);
    // 每個可能的最後一孔 h:[pagoda 編號, p(h)] 清單。簽章在搜尋中不變,所以只算一次。
    const targets = HOLES.flatMap((cell, bit) => (normalize(SIG_BITS[bit]) === sig ? [PAGODAS.map((p, k) => [k, p[bit]])] : []));
    if (!targets.length) return done({ status: 'none' });
    job = {
      bits, pegs, targets,
      keys: SYM_POW.map((pow) => bits.reduce((k, v, bit) => k + (v ? pow[bit] : 0), 0)),
      vals: PAGODAS.map((p) => bits.reduce((k, v, bit) => k + (v ? p[bit] : 0), 0)),
      frames: [{ here: rootKey, dead: 0, jump: -1, next: 0, open: false, known: false }],
    };
  }
  const out = runSearch(job, ctx);
  if (out === 'stop') {
    if (SUSPENDED.size >= SUSPENDED_LIMIT) SUSPENDED.delete(SUSPENDED.keys().next().value);
    SUSPENDED.set(rootKey, job);
    return done({ status: 'unknown' });
  }
  if (out === 'move') return done({ status: 'move', move: JUMPS[job.found].slice() });
  return done({ status: 'none' });
}

// ---- 鍵盤游標:往方向找下一個盤面格,沒有就停住 ----
export function cursorMove(index, key) {
  const delta = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key];
  if (!delta) return index;
  let r = rowOf(index) + delta[0], c = colOf(index) + delta[1];
  while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
    if (inBoard(r, c)) return r * SIZE + c;
    r += delta[0]; c += delta[1];
  }
  return index;
}

// ---- 存檔驗證:非盤面固定、棋數 1~32、history 由開局重播得到目前盤面、over 與無合法步一致 ----
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
export function isValidState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.board) || s.board.length !== SIZE * SIZE) return false;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = s.board[i];
    if (isHole(i) ? v !== EMPTY && v !== PEG : v !== OFF) return false;
  }
  const pegs = pegCount(s.board);
  if (pegs < 1 || pegs > START_PEGS) return false;
  if (!Array.isArray(s.history) || s.history.length !== START_PEGS - pegs) return false;
  if (typeof s.over !== 'boolean' || typeof s.hintUsed !== 'boolean' || !isCount(s.moves) || !isCount(s.undos)) return false;
  if (s.moves !== s.history.length) return false;
  if (s.over !== !hasMoves(s.board)) return false;
  if (!(s.selected === null || Number.isInteger(s.selected) && s.board[s.selected] === PEG && !s.over)) return false;
  let board = openingBoard();
  for (const step of s.history) {
    if (!Array.isArray(step) || step.length !== 3) return false;
    const jump = findJump(board, step[0], step[2]);
    if (!jump || jump[1] !== step[1]) return false;
    board = applyJump(board, jump);
  }
  return board.every((v, i) => v === s.board[i]);
}

// ---- 說明與示範 ----
export const HELP_RULES = [
  '先點棋子再點淡點：沿上下左右跳過相鄰一顆，落到後面空孔，被跳過的拿走。',
  '不能斜跳、不能跳過空孔；同一顆可接著再跳。',
  '沒有棋子能跳就結束；可無限復原。用 💡 提示算輔助局。',
  '方向鍵移動，Enter 選取／落子。',
  '剩 1 顆就贏，在中央最完美。分數＝33 減剩下棋數，中央剩 1 顆再加 5；最佳為單局最高。',
];

// 依序選第一個合法步直到無步可走,得到一個實算殘局。
export function stuckGame() {
  let state = initState();
  let prev = state;
  while (!state.over) {
    const [from, , to] = legalMoves(state.board)[0];
    prev = state;
    state = jumpState(state, from, to);
  }
  return { before: prev, after: state };
}

export function demoSteps() {
  const opening = initState();
  const first = jumpState(opening, 10, 24);
  const invalid = jumpState(first, 3, 17); // 3 → 17 要跳過的 10 已空
  const { before, after } = stuckGame();
  const left = pegCount(after.board);
  return [
    { before: opening.board, after: first.board, kind: 'ok', caption: '上方第二排中間的棋子往下跳過一顆，落進中央空孔，被跳過的棋子拿走。' },
    { before: first.board, after: invalid.board, kind: 'fail', caption: '最上排中間的棋子想往下跳，但中間隔的是空孔，不能跳，盤面不變。' },
    { before: before.board, after: after.board, caption: `再走一步後沒有棋子能跳了，遊戲結束：剩 ${left} 顆，評等「${gradeFor(after.board)}」。` },
  ];
}
