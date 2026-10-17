// 數獨規則與狀態轉移：純函式；亂數、時間均由呼叫端注入。
import { timerInit, timerEvent } from '../../shared/progress.js?v=ab8d031';
import { seedRng } from '../../shared/seed-rng.js?v=ab8d031';

export const SIZE = 9;
export const DIFFICULTIES = { easy: 46, normal: 40, hard: 32, expert: 26 };
const ALL = 0x3fe;
const indices = Array.from({ length: 81 }, (_, i) => i);
const rowOf = (i) => Math.floor(i / 9);
const colOf = (i) => i % 9;
const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
export const UNITS = [
  ...Array.from({ length: 9 }, (_, r) => indices.filter((i) => rowOf(i) === r)),
  ...Array.from({ length: 9 }, (_, c) => indices.filter((i) => colOf(i) === c)),
  ...Array.from({ length: 9 }, (_, b) => indices.filter((i) => boxOf(i) === b)),
];
const peers = indices.map((i) => indices.filter((j) => j !== i
  && (rowOf(i) === rowOf(j) || colOf(i) === colOf(j) || boxOf(i) === boxOf(j))));
const isBoard = (b) => Array.isArray(b) && b.length === 81
  && Array.from(b).every((v) => Number.isInteger(v) && v >= 0 && v <= 9);
const isIndex = (i) => Number.isInteger(i) && i >= 0 && i < 81;
const digits = (mask) => Array.from({ length: 9 }, (_, i) => i + 1).filter((n) => mask & (1 << n));
const bits = (mask) => { let n = 0; while (mask) { mask &= mask - 1; n++; } return n; };

function shuffle(values, rng) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 位元候選剪枝 + 最少候選格優先（MRV）；搜尋只改自己的工作副本。
function search(board, limit, rng = null, stats) {
  if (stats) Object.assign(stats, { nodes: 0, candidateChecks: 0 });
  if (!isBoard(board)) return { count: 0, solution: null };
  const work = board.slice();
  const rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0);
  for (const i of indices) {
    const v = work[i];
    if (!v) continue;
    const bit = 1 << v, r = rowOf(i), c = colOf(i), b = boxOf(i);
    if ((rows[r] | cols[c] | boxes[b]) & bit) return { count: 0, solution: null };
    rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
  }
  let count = 0, solution = null;
  function visit() {
    if (stats) stats.nodes++;
    let at = -1, mask = 0, fewest = 10;
    for (const i of indices) if (!work[i]) {
      if (stats) stats.candidateChecks++;
      const candidate = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const size = bits(candidate);
      if (!size) return;
      if (size < fewest) { at = i; mask = candidate; fewest = size; }
      if (size === 1) break;
    }
    if (at === -1) {
      count++;
      if (!solution) solution = work.slice();
      return;
    }
    const r = rowOf(at), c = colOf(at), b = boxOf(at);
    const choices = rng ? shuffle(digits(mask), rng) : digits(mask);
    for (const v of choices) {
      const bit = 1 << v;
      work[at] = v; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      visit();
      work[at] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= limit) return;
    }
  }
  visit();
  return { count, solution };
}

export function countSolutions(board, limit = 2) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('invalid solution limit');
  return search(board, limit).count;
}
// Optional counters observe search work without changing candidates or traversal.
export const solve = (board, stats) => search(board, 1, null, stats).solution;
export const generateSolution = (rng = Math.random) => search(Array(81).fill(0), 1, rng).solution;
export const clueCount = (board) => board.filter(Boolean).length;

export function candidates(board, index) {
  if (!isBoard(board) || !isIndex(index) || board[index]) return [];
  const used = new Set(peers[index].map((i) => board[i]));
  return digits(ALL).filter((n) => !used.has(n));
}

// 先排除玩家錯誤，再以固定格序／列、欄、宮順序推理。
// value 一律來自題目的正解；related 是畫面需要淡色標示的格子。
export function nextHint(state) {
  if (state.result || !isBoard(state.puzzle) || !isBoard(state.board)) return null;
  const solution = solve(state.puzzle);
  if (!solution) return null;
  const hint = (type, index, text, related = [], unit = null) => ({
    type, index, value: solution[index], text, related, unit,
  });
  for (const i of indices) {
    if (!state.puzzle[i] && state.board[i] && state.board[i] !== solution[i]) {
      return hint('wrong', i, `這格填錯了,正確答案不是 ${state.board[i]}`);
    }
  }
  const empty = indices.filter((i) => !state.board[i]);
  const options = empty.map((i) => candidates(state.board, i));
  for (let j = 0; j < empty.length; j++) {
    if (options[j].length === 1) {
      const i = empty[j], n = options[j][0];
      return hint('naked', i, `第 ${rowOf(i) + 1} 列第 ${colOf(i) + 1} 欄:同列、同欄、同宮已經出現其他 8 個數字,只剩 ${n} 能填`, peers[i]);
    }
  }
  for (let u = 0; u < UNITS.length; u++) {
    const unit = UNITS[u];
    for (const i of unit) {
      const at = empty.indexOf(i);
      if (at === -1) continue;
      for (const n of options[at]) {
        const places = empty.filter((j, k) => unit.includes(j) && options[k].includes(n));
        if (places.length !== 1) continue;
        const label = u < 9 ? `第 ${u + 1} 列` : u < 18 ? `第 ${u - 8} 欄` : '這個宮';
        return hint('hidden', i, `${label}裡,${n} 只能放在這格`, unit.slice(),
          { type: u < 9 ? 'row' : u < 18 ? 'column' : 'box', index: u % 9 });
      }
    }
  }
  if (!empty.length) return null;
  let at = 0;
  for (let j = 1; j < empty.length; j++) if (options[j].length < options[at].length) at = j;
  return hint('answer', empty[at], '這一步需要進階推理,直接告訴你一格答案');
}

export function assistState(state) {
  if (state.daily) return state;
  return state.result || state.assist ? state : { ...state, assist: true };
}

export function autoCandState(state, on) {
  if (state.daily && on) return state;
  if (state.result || typeof on !== 'boolean') return state;
  const next = on ? assistState(state) : state;
  return next.autoCand === on ? next : { ...next, autoCand: on };
}

// 舊存檔缺少輔助欄位時補 false，不改動棋盤、筆記與歷史。
export const fromSave = (state) => ({ ...state, assist: state.difficulty === 'easy' || (state.assist ?? false), autoCand: state.autoCand ?? false });

// 無法移除的格放回；走完全部格仍達不到目標時保留最接近的唯一解。
export function carvePuzzle(solution, target, rng = Math.random) {
  if (!hasWon(solution) || !Number.isInteger(target) || target < 0 || target > 81) throw new Error('invalid puzzle source');
  const puzzle = solution.slice();
  let clues = 81;
  for (const i of shuffle(indices, rng)) {
    if (clues <= target) break;
    const v = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle) === 1) clues--;
    else puzzle[i] = v;
  }
  return puzzle;
}

export function generatePuzzle(difficulty = 'normal', rng = Math.random) {
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new Error('unknown difficulty');
  const solution = generateSolution(rng);
  // 重試不同挖空順序，盡量達到提示數；每個候選題仍逐格驗唯一解。
  let puzzle = solution;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = carvePuzzle(solution, DIFFICULTIES[difficulty], rng);
    if (clueCount(candidate) < clueCount(puzzle)) puzzle = candidate;
    if (clueCount(puzzle) === DIFFICULTIES[difficulty]) break;
  }
  return puzzle;
}

export function conflicts(board) {
  const bad = new Set();
  for (const unit of UNITS) {
    const groups = new Map();
    for (const i of unit) if (board[i]) {
      const group = groups.get(board[i]) ?? [];
      group.push(i); groups.set(board[i], group);
    }
    for (const group of groups.values()) if (group.length > 1) group.forEach((i) => bad.add(i));
  }
  return [...bad].sort((a, b) => a - b);
}
export const hasWon = (board) => isBoard(board) && board.every(Boolean) && conflicts(board).length === 0;
export const secondsFor = (state) => Math.floor((state.clock?.ms ?? 0) / 1000);
export const scoreFor = (result, seconds) => result === 'win' ? Math.max(1, 10000 - seconds) : 0;
// 雲端 plays.difficulty 僅接受 normal / hard / expert。入門沿用 normal 的 XP 倍率,
// 原始難度放在 detail,assist 仍由呼叫端傳入,不影響存檔或畫面的入門選項。
export const finishDifficultyFor = (state) => state.difficulty === 'easy' ? 'normal' : state.difficulty;
export const detailFor = (state) => ({ seconds: secondsFor(state), clues: clueCount(state.puzzle),
  ...(state.difficulty === 'easy' ? { sudoku_difficulty: 'easy' } : {}) });

export function stateWithPuzzle(puzzle, difficulty = 'normal') {
  if (!Object.hasOwn(DIFFICULTIES, difficulty) || countSolutions(puzzle) !== 1) throw new Error('invalid puzzle');
  const result = hasWon(puzzle) ? 'win' : null;
  return { puzzle: puzzle.slice(), board: puzzle.slice(), notes: indices.map(() => []), history: [],
    difficulty, assist: difficulty === 'easy', autoCand: difficulty === 'easy',
    moves: 0, clock: null, result, score: scoreFor(result, 0) };
}
export const initState = (difficulty = 'normal', rng = Math.random) => stateWithPuzzle(generatePuzzle(difficulty, rng), difficulty);
export const initDailyState = ({ day, seed }) => ({ ...initState('normal', seedRng(seed)), daily: day, daily_seed: seed });

// 沿用共用活動計時規則；null 代表尚未收到第一次輸入，lastInput:null 可安全存成 JSON。
export function clockState(state, type, now, visible = true) {
  if (state.result) return state;
  let clock = state.clock;
  if (!clock) {
    if (type !== 'input') return state;
    clock = timerInit(now);
    clock.visible = visible;
  } else {
    clock = timerEvent({ ...clock, lastInput: clock.lastInput ?? -Infinity }, { t: now, type });
  }
  return { ...state, clock: { ...clock, lastInput: Number.isFinite(clock.lastInput) ? clock.lastInput : null } };
}
export function resumeState(state, now, visible = true) {
  return state.clock ? { ...state, clock: { ...state.clock, lastT: now, lastInput: visible ? now : null, visible } } : state;
}

const snapshot = (s) => ({ board: s.board.slice(), notes: s.notes.map((n) => n.slice()) });
export function stepState(state, index, value, noteMode = false) {
  if (state.result || !isIndex(index) || !Number.isInteger(value) || value < 0 || value > 9 || state.puzzle[index]) return state;
  const next = snapshot(state);
  if (value === 0) {
    if (!next.board[index] && !next.notes[index].length) return state;
    next.board[index] = 0; next.notes[index] = [];
  } else if (noteMode) {
    if (next.board[index]) return state;
    const notes = next.notes[index];
    next.notes[index] = notes.includes(value) ? notes.filter((n) => n !== value) : [...notes, value].sort((a, b) => a - b);
  } else {
    if (next.board[index] === value) return state;
    next.board[index] = value; next.notes[index] = [];
    for (const i of peers[index]) next.notes[i] = next.notes[i].filter((n) => n !== value);
  }
  const result = hasWon(next.board) ? 'win' : null;
  return { ...state, ...next, history: [...state.history, snapshot(state)], moves: state.moves + 1,
    result, score: scoreFor(result, secondsFor(state)) };
}

export function undoState(state) {
  if (state.result || !state.history.length) return state;
  const prev = state.history.at(-1);
  // 不回退活動秒數／有效操作數，避免全部復原後逃過 quit 紀錄。
  return { ...state, board: prev.board.slice(), notes: prev.notes.map((n) => n.slice()), history: state.history.slice(0, -1) };
}

export function cursorMove(index, direction) {
  const r = rowOf(index), c = colOf(index);
  if (direction === 'ArrowLeft') return r * 9 + Math.max(0, c - 1);
  if (direction === 'ArrowRight') return r * 9 + Math.min(8, c + 1);
  if (direction === 'ArrowUp') return Math.max(0, r - 1) * 9 + c;
  if (direction === 'ArrowDown') return Math.min(8, r + 1) * 9 + c;
  return index;
}

const count = (v) => Number.isSafeInteger(v) && v >= 0;
function validSnapshot(s, puzzle) {
  return s && isBoard(s.board) && puzzle.every((v, i) => !v || s.board[i] === v)
    && Array.isArray(s.notes) && s.notes.length === 81 && Array.from(s.notes).every((n, i) => Array.isArray(n)
      && (!s.board[i] || !n.length) && Array.from(n).every((v, j) => Number.isInteger(v) && v >= 1 && v <= 9 && (j === 0 || n[j - 1] < v)));
}
// 提示數區間:下限 = 該難度提示數,上限 = 低一級難度的提示數(不含);入門難度無上限。
export function inClueRange(clues, difficulty) {
  const min = DIFFICULTIES[difficulty];
  const easier = Object.values(DIFFICULTIES).filter((n) => n > min);
  return clues >= min && (!easier.length || clues < Math.min(...easier));
}

export function isValidState(s) {
  if (s?.daily !== undefined && (typeof s.daily !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.daily)
    || !/^[0-9a-f]{16}$/.test(s.daily_seed) || s.difficulty !== 'normal' || s.assist || s.autoCand)) return false;
  if (!s || !Object.hasOwn(DIFFICULTIES, s.difficulty) || !isBoard(s.puzzle)
    || clueCount(s.puzzle) < DIFFICULTIES[s.difficulty] || !validSnapshot(s, s.puzzle) || !count(s.moves)) return false;
  if ((s.assist !== undefined && typeof s.assist !== 'boolean')
    || (s.autoCand !== undefined && typeof s.autoCand !== 'boolean')
    || (s.difficulty === 'easy' && s.assist !== true)
    || (s.autoCand === true && s.assist !== true)) return false;
  if (!Array.isArray(s.history) || s.history.length > s.moves
    || !Array.from(s.history).every((p) => validSnapshot(p, s.puzzle) && !hasWon(p.board))) return false;
  if (s.clock !== null && (!s.clock || !Number.isFinite(s.clock.ms) || s.clock.ms < 0
    || !count(s.clock.lastT) || !(s.clock.lastInput === null || count(s.clock.lastInput))
    || typeof s.clock.visible !== 'boolean' || (s.clock.lastInput !== null && s.clock.lastInput > s.clock.lastT))) return false;
  const result = hasWon(s.board) ? 'win' : null;
  if (s.result !== result || s.score !== scoreFor(result, secondsFor(s))) return false;
  if (s.moves === 0 && (s.history.length || s.board.some((v, i) => v !== s.puzzle[i]) || s.notes.some((n) => n.length))) return false;
  // IR10:歷史為空 ⇒ 盤面等於題目;有操作(歷史非空或盤面≠題目)⇒ 已開始計時;提示數落在該難度區間(不落在較低難度的區間)
  const touched = s.board.some((v, i) => v !== s.puzzle[i]);
  if (!s.history.length && touched) return false;
  if ((s.history.length || touched) && s.clock === null) return false;
  if (!inClueRange(clueCount(s.puzzle), s.difficulty)) return false;
  return countSolutions(s.puzzle) === 1;
}

export function demoSteps() {
  const solution = Array.from({ length: 81 }, (_, i) => (rowOf(i) * 3 + Math.floor(rowOf(i) / 3) + colOf(i)) % 9 + 1);
  const puzzle = solution.slice(); puzzle[0] = 0;
  const start = stateWithPuzzle(puzzle);
  const bad = stepState(start, 0, 2);
  const hint = nextHint(start);
  return [
    { before: start.board, after: stepState(start, 1, 8).board, caption: '題目給定格不能改，盤面保持原樣。' },
    { before: start.board, after: bad.board, caption: '填入重複的 2，衝突格標紅，仍可修改。' },
    { before: start.board, after: { board: start.board, hint }, caption: '按 💡 提示，先看推理理由，不會自動填入。', result: hint.text, hint },
    { before: bad.board, after: stepState(bad, 0, 1).board, caption: '改成 1，填滿且沒有衝突，完成數獨。' },
  ];
}
