// 翻翻樂規則層:純函式,不碰 DOM。牌以一維陣列存,牌號 i = r × cols + c。
// 規則正典:workbook/plans/memory-match.md「規則(驗收依據)」。

export const DIFFICULTIES = {
  normal: { cols: 4, rows: 4 }, // 8 對
  hard: { cols: 4, rows: 6 }, // 12 對
  expert: { cols: 6, rows: 6 }, // 18 對
};

// 固定 18 種圖案,依難度取前 N 種;彼此外形差異大,不只靠顏色區分。
export const SYMBOLS = ['🍎', '🐶', '🚗', '⭐', '🌙', '⚽', '🎸', '🌵', '🐟', '🍄', '🔑', '⏰', '🎈', '🦋', '🍩', '🚀', '☂️', '🐢'];

export const MISS_PENALTY = 20;
export const PAIR_POINTS = 100;
export const MIN_SCORE = 10;
export const HIDE_MS = 800; // 配對失敗後停留多久再蓋回(UI 用)
const STATUSES = ['ready', 'playing', 'win'];

export const pairsOf = (difficulty) => {
  const d = DIFFICULTIES[difficulty];
  return (d.cols * d.rows) / 2;
};

// 發牌:每種圖案(以 SYMBOLS 索引表示)恰好 2 張,Fisher–Yates 洗牌。rng 可注入。
export function dealDeck(pairs, rng = Math.random) {
  const deck = [];
  for (let k = 0; k < pairs; k++) deck.push(k, k);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ---- 狀態 ----
// state = { difficulty, cols, rows, deck, matched, open, moves, misses, seconds, status }
//   deck     每張牌的圖案(SYMBOLS 索引)
//   matched  已配對(永久朝上)
//   open     翻開但未配對的牌號,0~2 個;2 個時必為不同圖案(等待蓋回)
//   moves    翻開第 2 張的次數;misses 其中配對失敗的次數
//   status   'ready' 尚未翻牌 / 'playing' / 'win'(本款沒有失敗)

export function initState(difficulty = 'normal', rng = Math.random) {
  const d = DIFFICULTIES[difficulty];
  if (!d) throw new Error(`unknown difficulty: ${difficulty}`);
  return stateWithDeck(difficulty, dealDeck(pairsOf(difficulty), rng));
}

// 指定牌序的新局(示範與測試用;發牌規則仍以 dealDeck 為準)。
export function stateWithDeck(difficulty, deck) {
  const d = DIFFICULTIES[difficulty];
  return {
    difficulty, cols: d.cols, rows: d.rows, deck: deck.slice(),
    matched: Array(deck.length).fill(false), open: [], moves: 0, misses: 0, seconds: 0, status: 'ready',
  };
}

export const isOver = (state) => state.status === 'win';

// 等待蓋回:open 有 2 張(配對成功的牌會立刻移出 open,所以 2 張必為不同圖案)。
export const isWaiting = (state) => state.open.length === 2;

// 蓋回等待中的兩張;沒在等待 → 原 state(同一物件)。UI 在 HIDE_MS 後呼叫。
export function hideState(state) {
  return isWaiting(state) ? { ...state, open: [] } : state;
}

// 翻一張牌。無效(已結束、超出範圍、已配對、已翻開含同張連點)→ 原 state(同一物件)。
// 等待蓋回時翻第 3 張:先蓋回那兩張,再翻開第 3 張(任何時刻 open ≤ 2)。
export function flip(state, i) {
  if (isOver(state) || !Number.isInteger(i) || i < 0 || i >= state.deck.length) return state;
  if (state.matched[i] || state.open.includes(i)) return state;
  const open = [...hideState(state).open, i];
  const next = { ...state, open, status: 'playing' };
  if (open.length < 2) return next;
  const [a, b] = open;
  if (state.deck[a] !== state.deck[b]) return { ...next, moves: state.moves + 1, misses: state.misses + 1 };
  const matched = state.matched.slice();
  matched[a] = true;
  matched[b] = true;
  return {
    ...next, open: [], matched, moves: state.moves + 1,
    status: matched.every(Boolean) ? 'win' : 'playing',
  };
}

// 計時:第一次翻牌後每秒 +1;未開始或已結束不動。
export function tickState(state) {
  return state.status === 'playing' ? { ...state, seconds: state.seconds + 1 } : state;
}

// 剩餘對數。
export function remainingPairs(state) {
  return (state.deck.length - state.matched.filter(Boolean).length) / 2;
}

// 分數(勝利才有):max(10, 對數 × 100 − 失誤 × 20);其他 = 0。
export function scoreFor(result, pairs, misses) {
  return result === 'win' ? Math.max(MIN_SCORE, pairs * PAIR_POINTS - misses * MISS_PENALTY) : 0;
}

export function resultOf(state) {
  return isOver(state) ? 'win' : null;
}

// 有沒有操作過(切換難度/新遊戲時判斷要不要記 quit):翻過任何一張牌就算。
export function hasActed(state) {
  return state.status !== 'ready';
}

// 一張牌該怎麼顯示:'matched' | 'open' | 'hidden'。
export function cardView(state, i) {
  if (state.matched[i]) return 'matched';
  return state.open.includes(i) ? 'open' : 'hidden';
}

export const symbolOf = (state, i) => SYMBOLS[state.deck[i]];

export function detailOf(state) {
  return { moves: state.moves, misses: state.misses, seconds: state.seconds, pairs: state.deck.length / 2 };
}

// ---- 示範 ----

// 固定種子的亂數(示範與測試用,同種子同序列)。
export function seededRng(seed) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

// 從一副牌挑出示範用的牌號:first/match 是同圖案的一對;missA/missB 是另外兩張不同圖案的牌。
export function demoPlan(state) {
  const first = 0;
  const match = state.deck.indexOf(state.deck[first], 1);
  const rest = state.deck.map((_, i) => i).filter((i) => i !== first && i !== match);
  const missA = rest[0];
  const missB = rest.find((i) => state.deck[i] !== state.deck[missA]);
  return { first, match, missA, missB };
}

// ---- 存檔 ----

export function toSave(state) {
  const { difficulty, cols, rows, deck, matched, open, moves, misses, seconds, status } = state;
  return { difficulty, cols, rows, deck: deck.slice(), matched: matched.slice(), open: open.slice(), moves, misses, seconds, status };
}

// 載入:等待蓋回中的兩張一律蓋回(⛔ 靠重新整理偷看)。
export function fromSave(saved) {
  return hideState(toSave(saved));
}

// 存檔 state 格式檢查(匯入驗證與載入防呆;不合格的存檔不還原)。
const isCount = (v) => Number.isInteger(v) && v >= 0;

export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const d = Object.hasOwn(DIFFICULTIES, s.difficulty) ? DIFFICULTIES[s.difficulty] : null;
  if (!d || s.cols !== d.cols || s.rows !== d.rows) return false;
  const n = d.cols * d.rows;
  const pairs = n / 2;
  if (!STATUSES.includes(s.status) || !isCount(s.moves) || !isCount(s.misses) || !isCount(s.seconds)) return false;
  if (s.misses > s.moves) return false;
  // 圖案成對:每種 0..pairs-1 恰好 2 張。
  if (!Array.isArray(s.deck) || s.deck.length !== n) return false;
  const count = Array(pairs).fill(0);
  for (const v of s.deck) {
    if (!Number.isInteger(v) || v < 0 || v >= pairs) return false;
    count[v]++;
  }
  if (count.some((c) => c !== 2)) return false;
  // matched 成對且圖案相同:同圖案的兩張要嘛都已配對、要嘛都沒有。
  if (!Array.isArray(s.matched) || s.matched.length !== n || !s.matched.every((m) => typeof m === 'boolean')) return false;
  const pairState = Array(pairs).fill(null);
  for (let i = 0; i < n; i++) {
    const v = s.deck[i];
    if (pairState[v] === null) pairState[v] = s.matched[i];
    else if (pairState[v] !== s.matched[i]) return false;
  }
  const matchedPairs = s.matched.filter(Boolean).length / 2;
  // open:0~2 張、不重複、未配對;2 張時必為不同圖案。
  if (!Array.isArray(s.open) || s.open.length > 2) return false;
  if (!s.open.every((i) => Number.isInteger(i) && i >= 0 && i < n && !s.matched[i])) return false;
  if (new Set(s.open).size !== s.open.length) return false;
  if (s.open.length === 2 && s.deck[s.open[0]] === s.deck[s.open[1]]) return false;
  // 每一步不是配成一對就是一次失誤;兩張不同的牌等待蓋回 ⇒ 第二張翻開時已記 1 次失誤。
  if (s.moves !== matchedPairs + s.misses) return false;
  if (s.open.length === 2 && s.misses < 1) return false;
  // 勝負與盤面一致。
  if (s.status === 'ready') return s.moves === 0 && s.seconds === 0 && s.open.length === 0;
  if (s.status === 'win') return matchedPairs === pairs && s.open.length === 0;
  return matchedPairs < pairs && (s.moves > 0 || s.open.length > 0);
}
