// 數獨規則與狀態轉移：純函式；亂數、時間均由呼叫端注入。
import { timerInit, timerEvent } from '../../shared/progress.js';

export const SIZE = 9;
export const DIFFICULTIES = { normal: 40, hard: 32, expert: 26 };
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
function search(board, limit, rng = null) {
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
    let at = -1, mask = 0, fewest = 10;
    for (const i of indices) if (!work[i]) {
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
export const solve = (board) => search(board, 1).solution;
export const generateSolution = (rng = Math.random) => search(Array(81).fill(0), 1, rng).solution;
export const clueCount = (board) => board.filter(Boolean).length;

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
export const detailFor = (state) => ({ seconds: secondsFor(state), clues: clueCount(state.puzzle) });

export function stateWithPuzzle(puzzle, difficulty = 'normal') {
  if (!Object.hasOwn(DIFFICULTIES, difficulty) || countSolutions(puzzle) !== 1) throw new Error('invalid puzzle');
  const result = hasWon(puzzle) ? 'win' : null;
  return { puzzle: puzzle.slice(), board: puzzle.slice(), notes: indices.map(() => []), history: [],
    difficulty, moves: 0, clock: null, result, score: scoreFor(result, 0) };
}
export const initState = (difficulty = 'normal', rng = Math.random) => stateWithPuzzle(generatePuzzle(difficulty, rng), difficulty);

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
export function isValidState(s) {
  if (!s || !Object.hasOwn(DIFFICULTIES, s.difficulty) || !isBoard(s.puzzle)
    || clueCount(s.puzzle) < DIFFICULTIES[s.difficulty] || !validSnapshot(s, s.puzzle) || !count(s.moves)) return false;
  if (!Array.isArray(s.history) || s.history.length > s.moves
    || !Array.from(s.history).every((p) => validSnapshot(p, s.puzzle) && !hasWon(p.board))) return false;
  if (s.clock !== null && (!s.clock || !Number.isFinite(s.clock.ms) || s.clock.ms < 0
    || !count(s.clock.lastT) || !(s.clock.lastInput === null || count(s.clock.lastInput))
    || typeof s.clock.visible !== 'boolean' || (s.clock.lastInput !== null && s.clock.lastInput > s.clock.lastT))) return false;
  const result = hasWon(s.board) ? 'win' : null;
  if (s.result !== result || s.score !== scoreFor(result, secondsFor(s))) return false;
  if (s.moves === 0 && (s.history.length || s.board.some((v, i) => v !== s.puzzle[i]) || s.notes.some((n) => n.length))) return false;
  return countSolutions(s.puzzle) === 1;
}

export function demoSteps() {
  const solution = Array.from({ length: 81 }, (_, i) => (rowOf(i) * 3 + Math.floor(rowOf(i) / 3) + colOf(i)) % 9 + 1);
  const puzzle = solution.slice(); puzzle[0] = 0;
  const start = stateWithPuzzle(puzzle);
  const bad = stepState(start, 0, 2);
  return [
    { before: start.board, after: stepState(start, 1, 8).board, caption: '題目給定格不能改，盤面保持原樣。' },
    { before: start.board, after: bad.board, caption: '填入重複的 2，衝突格標紅，仍可修改。' },
    { before: bad.board, after: stepState(bad, 0, 1).board, caption: '改成 1，填滿且沒有衝突，完成數獨。' },
  ];
}
