// Wordle 規則層:純函式,不碰 DOM。單字一律小寫。
// 規則正典:workbook/plans/wordle.md「規則(驗收依據)」。
import { ANSWERS, ALLOWED } from './words.js';

export const WORD_LEN = 5;
export const MAX_GUESSES = 6;
export const DIFFICULTIES = ['normal', 'hard'];
export const RECENT_LIMIT = 10;

const ALLOWED_SET = new Set(ALLOWED);
const isWordShape = (w) => typeof w === 'string' && /^[a-z]{5}$/.test(w);

export function isWord(word, allowed = ALLOWED_SET) {
  return isWordShape(word) && allowed.has(word);
}

// 著色:先標綠,再依答案中該字母剩餘數量由左至右標黃,超過數量的標灰。
// → 長度 5 的陣列,值為 'correct'(綠)/ 'present'(黃)/ 'absent'(灰)。
export function evaluate(guess, answer) {
  const out = Array(WORD_LEN).fill('absent');
  const left = {};
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === answer[i]) out[i] = 'correct';
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (out[i] === 'correct') continue;
    if (left[guess[i]] > 0) {
      out[i] = 'present';
      left[guess[i]]--;
    }
  }
  return out;
}

// 困難模式:已得到的綠字必須留在原位、黃字(及綠字)必須出現在之後的猜測中(數量也要夠)。
// → null(合法)| { kind: 'green', letter, pos }(pos 從 1 起算)| { kind: 'yellow', letter }
export function hardModeError(guesses, answer, guess) {
  const need = {};
  for (const g of guesses) {
    const marks = evaluate(g, answer);
    for (let i = 0; i < WORD_LEN; i++) {
      if (marks[i] === 'correct' && guess[i] !== g[i]) return { kind: 'green', letter: g[i], pos: i + 1 };
    }
    const count = {};
    marks.forEach((m, i) => { if (m !== 'absent') count[g[i]] = (count[g[i]] ?? 0) + 1; });
    for (const [ch, n] of Object.entries(count)) need[ch] = Math.max(need[ch] ?? 0, n);
  }
  for (const [ch, n] of Object.entries(need)) {
    if ([...guess].filter((x) => x === ch).length < n) return { kind: 'yellow', letter: ch };
  }
  return null;
}

// 出題:避開最近 RECENT_LIMIT 局的答案;全被避開時退回整份(rng 可注入)。
export function pickAnswer(rng = Math.random, recent = [], answers = ANSWERS) {
  const avoid = new Set(recent.slice(0, RECENT_LIMIT));
  const pool = answers.filter((w) => !avoid.has(w));
  const list = pool.length ? pool : answers;
  return list[Math.floor(rng() * list.length)];
}

// ---- 狀態轉移(純函式,UI 只呼叫)----
// state = { answer, guesses, current, difficulty, over, won }
//   guesses 已送出的猜測(皆為合法單字)
//   current 輸入中的字母(未送出,不存檔)

export function initState(rng = Math.random, difficulty = 'normal', recent = []) {
  return {
    answer: pickAnswer(rng, recent),
    guesses: [],
    current: '',
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    over: false,
    won: false,
  };
}

// 輸入字母 / 刪除:結束後或已滿 5 字 ⇒ 原 state。
export function typeState(state, ch) {
  if (state.over || state.current.length >= WORD_LEN || !/^[a-z]$/.test(ch)) return state;
  return { ...state, current: state.current + ch };
}

export function eraseState(state) {
  if (state.over || state.current.length === 0) return state;
  return { ...state, current: state.current.slice(0, -1) };
}

// 送出前檢查:null = 可送出;否則 { code: 'over' | 'short' | 'notword' | 'hard', ... }。不合法不算一次。
export function guessError(state, allowed = ALLOWED_SET) {
  if (state.over) return { code: 'over' };
  if (state.current.length < WORD_LEN) return { code: 'short' };
  if (!isWord(state.current, allowed)) return { code: 'notword' };
  if (state.difficulty === 'hard') {
    const e = hardModeError(state.guesses, state.answer, state.current);
    if (e) return { code: 'hard', ...e };
  }
  return null;
}

// 送出:不合法 ⇒ 原 state(同一物件)。
export function submitState(state, allowed = ALLOWED_SET) {
  if (guessError(state, allowed)) return state;
  const guesses = [...state.guesses, state.current];
  const won = state.current === state.answer;
  return { ...state, guesses, current: '', won, over: won || guesses.length >= MAX_GUESSES };
}

// 畫面鍵盤:每個字母目前最佳狀態(綠 > 黃 > 灰)。
const RANK = { absent: 1, present: 2, correct: 3 };
export function keyStates({ guesses, answer }) {
  const keys = {};
  for (const g of guesses) {
    evaluate(g, answer).forEach((m, i) => {
      if (!keys[g[i]] || RANK[m] > RANK[keys[g[i]]]) keys[g[i]] = m;
    });
  }
  return keys;
}

// 分數:猜中 (7 − 次數) × 100(1 次 600 … 6 次 100),失敗 0。
export function scoreFor({ won, guesses }) {
  return won ? (MAX_GUESSES + 1 - guesses.length) * 100 : 0;
}

// 結束遮罩:'won' / 'lost' / null。
export function overlayFor({ over, won }) {
  if (won) return 'won';
  if (over) return 'lost';
  return null;
}

// ---- 存檔(續玩)----

export function toSave({ answer, guesses, difficulty }) {
  return { answer, guesses, difficulty };
}

export function fromSave(saved) {
  return { answer: saved.answer, guesses: [...saved.guesses], current: '', difficulty: saved.difficulty, over: false, won: false };
}

// 存檔 state 格式檢查:只存「進行中」的局(結束就結算並刪檔)。
//   答案 ∈ ANSWERS;每個猜測 ∈ ALLOWED;猜測 < 6 次且都沒猜中(猜中或滿 6 次就該結算);
//   困難模式時每個猜測都符合當時的限制(與實際送出時的規則一致)。
const ANSWER_SET = new Set(ANSWERS);

export function isValidState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const { answer, guesses, difficulty } = s;
  if (!isWordShape(answer) || !ANSWER_SET.has(answer) || !DIFFICULTIES.includes(difficulty)) return false;
  if (!Array.isArray(guesses) || guesses.length >= MAX_GUESSES) return false;
  if (!guesses.every((g) => isWord(g) && g !== answer)) return false;
  if (difficulty === 'hard') {
    return guesses.every((g, i) => hardModeError(guesses.slice(0, i), answer, g) === null);
  }
  return true;
}

// ---- 輸入對應(實體鍵盤)----
// key = KeyboardEvent.key;onControl = 焦點在按鈕/連結上。
// → { action: 'enter' | 'back' | 字母 | 'control' | null, refocus }
//   'control':焦點在按鈕上按 Enter ⇒ 交給該按鈕(例如用鍵盤按「新遊戲」);
//   refocus:輸入字母/刪除時焦點還在按鈕上 ⇒ 先把焦點移回遊戲區,之後的 Enter 才會送出猜測(W2)。
export function routeKey(key, { onControl = false } = {}) {
  if (key === 'Enter') return { action: onControl ? 'control' : 'enter', refocus: false };
  if (key === 'Backspace') return { action: 'back', refocus: onControl };
  if (/^[a-zA-Z]$/.test(key)) return { action: key.toLowerCase(), refocus: onControl };
  return { action: null, refocus: false };
}
