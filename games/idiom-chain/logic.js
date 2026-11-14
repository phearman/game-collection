// G17 成語接龍:純規則,不碰 DOM、儲存或時鐘;隨機數可注入(R3)。
// R1:詞表直接沿用 G16(⛔ 另做一份、⛔ 改 G16 的檔案)。
import { WORDS } from '../idiom/words.js?v=1eaeb7ae';

export const STEPS = 10;            // R3:起手詞 + 10 步
export const CHOICES = 4;           // R4:每步 4 張卡
export const STEP_SCORE = 100;      // R7
export const ERROR_COST = 30;
export const MIN_STEP_SCORE = 10;
// 雲端 plays.difficulty 只收 normal/hard/expert(0001);本遊戲只有一種玩法,結算記 normal(R12)。
export const SETTLE_DIFFICULTY = 'normal';
// r1 L3:存檔秒數上限 7 天(超過視為壞檔)。
export const MAX_SECONDS = 604800;

const chars = (word) => [...word];
const head = (word) => chars(word)[0];
const tail = (word) => chars(word).at(-1);
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const WORD_SET = new Set(WORDS);

export function seededRng(seed) {
  let x = 2166136261;
  for (const ch of String(seed)) x = Math.imul(x ^ ch.codePointAt(0), 16777619) >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

export function shuffle(values, rng) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// R2:同字接龍=下一條第 1 字與上一條第 4 字完全相同(不做異體、繁簡、同音)。
export const links = (from, to) => typeof from === 'string' && typeof to === 'string' && tail(from) === head(to);

const BY_HEAD = new Map();
for (const word of WORDS) {
  if (!BY_HEAD.has(head(word))) BY_HEAD.set(head(word), []);
  BY_HEAD.get(head(word)).push(word);
}
export const successors = (word) => BY_HEAD.get(tail(word)) ?? [];

function reaches(word, depth, used) {
  if (depth === 0) return true;
  for (const next of successors(word)) {
    if (used.has(next)) continue;
    used.add(next);
    const ok = reaches(next, depth - 1, used);
    used.delete(next);
    if (ok) return true;
  }
  return false;
}

// 「能接滿 10 步不重複」的起手詞(依詞表順序;第一次用到才算,約 20ms)。
let starters;
export function starterWords() {
  starters ??= Object.freeze(WORDS.filter((word) => reaches(word, STEPS, new Set([word]))));
  return starters;
}

// 依 rng 打亂後繼、深度優先找第一條接滿的路;同 rng 序列 ⇒ 同一條。
function walk(path, used, rng) {
  if (path.length === STEPS + 1) return path;
  for (const next of shuffle(successors(path.at(-1)), rng)) {
    if (used.has(next)) continue;
    used.add(next);
    const found = walk([...path, next], used, rng);
    if (found) return found;
    used.delete(next);
  }
  return null;
}

// R3:起手詞 + 10 步,共 11 條不重複、每步符合 R2。
export function makeChain(rng = Math.random) {
  const pool = starterWords();
  const start = pool[Math.floor(rng() * pool.length)];
  const chain = walk([start], new Set([start]), rng);
  if (!chain) throw new Error('接龍路徑產生失敗');
  return chain;
}

// R5:干擾卡=詞表內、本局路徑以外、第 1 字 ≠ 目前尾字、彼此不重複;
// 優先挑「尾字出現在第 2~4 字」的(看起來像對、其實接錯),不夠再從全表補。
export const isDecoy = (word, current) => chars(word).slice(1).includes(tail(current));

export function distractorsFor(current, chain, rng = Math.random) {
  const end = tail(current), used = new Set(chain);
  const allowed = WORDS.filter((word) => !used.has(word) && head(word) !== end);
  const decoys = allowed.filter((word) => isDecoy(word, current));
  const picked = shuffle(decoys, rng).slice(0, CHOICES - 1);
  if (picked.length < CHOICES - 1) {
    const taken = new Set(picked);
    picked.push(...shuffle(allowed.filter((word) => !taken.has(word)), rng).slice(0, CHOICES - 1 - picked.length));
  }
  if (picked.length !== CHOICES - 1) throw new Error('干擾卡不足');
  return picked;
}

// R4:每步 4 張,恰好 1 張是路徑上的下一條。
export function makeRound(rng = Math.random) {
  const chain = makeChain(rng);
  const choices = chain.slice(0, STEPS).map((current, i) =>
    shuffle([chain[i + 1], ...distractorsFor(current, chain, rng)], rng));
  return { chain, choices };
}

// R8:接受種子,為日後每日挑戰預留(本期 UI 不開每日模式)。
export function initState({ seed, rng = seed === undefined ? Math.random : seededRng(seed) } = {}) {
  const { chain, choices } = makeRound(rng);
  return { chain, choices, index: 0, solved: false, wrong: [],
    errors: Array(STEPS).fill(0), attempts: 0, seconds: 0, status: 'ready' };
}

export const currentWord = (s) => s.chain[s.index];
export const answerOf = (s) => s.chain[s.index + 1];
export const currentChoices = (s) => s.choices[s.index];
export const hasActed = (s) => s.attempts > 0;
export const stepScore = (errors) => Math.max(MIN_STEP_SCORE, STEP_SCORE - errors * ERROR_COST);
export const stepsDone = (s) => s.index + (s.solved ? 1 : 0);
export const scoreFor = (s) => s.errors.reduce((sum, n, i) => sum + (i < stepsDone(s) ? stepScore(n) : 0), 0);
export const totalErrors = (s) => s.errors.reduce((sum, n) => sum + n, 0);
export const resultOf = (s) => s.status === 'win' ? 'win' : null;

// R6:答錯=該卡標紅、不能再按,錯誤 +1、可再選;答對=標綠,等「下一步」。
export function chooseState(s, word) {
  if (s.status === 'win' || s.solved || !currentChoices(s).includes(word) || s.wrong.includes(word)) return s;
  const correct = word === answerOf(s);
  const errors = correct ? s.errors : s.errors.map((n, i) => n + (i === s.index ? 1 : 0));
  return { ...s, solved: correct, errors, attempts: s.attempts + 1,
    wrong: correct ? s.wrong : [...s.wrong, word],
    status: correct && s.index === STEPS - 1 ? 'win' : 'playing' };
}

export function nextState(s) {
  return !s.solved || s.status === 'win' ? s : { ...s, index: s.index + 1, solved: false, wrong: [] };
}

// R7:首次選卡才開始計時(status 由 ready 轉 playing),末步答對停止。
export function tickState(s) {
  return s.status === 'playing' ? { ...s, seconds: s.seconds + 1 } : s;
}

// 卡片狀態:wrong 標紅不可按、right 標綠;答對後其餘卡也不可按。
export function cardsOf(s) {
  return currentChoices(s).map((word) => {
    const right = s.solved && word === answerOf(s), wrong = s.wrong.includes(word);
    return { word, right, wrong, disabled: wrong || s.solved || s.status === 'win' };
  });
}

export const lookupUrl = (word) => `https://dict.idioms.moe.edu.tw/idiomList.jsp?webMd=2&la=0&idiom=${encodeURIComponent(word)}`;

export const detailOf = (s) => ({ steps: stepsDone(s), errors: totalErrors(s), seconds: s.seconds });
export const settlementOf = (s, result = resultOf(s)) => ({ result, score: result === 'win' ? scoreFor(s) : 0,
  difficulty: SETTLE_DIFFICULTY, detail: detailOf(s) });
export const toSave = (s) => structuredClone(s);

// 存檔驗證:路徑、卡片、錯誤與狀態要彼此一致;⛔ 相信分數或勝利旗標。
export function isValidState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.chain) || !Array.isArray(s.choices) || !Array.isArray(s.wrong)
    || !Array.isArray(s.errors) || s.chain.length !== STEPS + 1 || s.choices.length !== STEPS || s.errors.length !== STEPS
    || !count(s.index) || s.index >= STEPS || typeof s.solved !== 'boolean'
    || !count(s.seconds) || s.seconds > MAX_SECONDS || !count(s.attempts) || !['ready', 'playing', 'win'].includes(s.status)) return false;
  if (!s.chain.every((word) => WORD_SET.has(word)) || new Set(s.chain).size !== s.chain.length) return false;
  if (!s.chain.every((word, i) => i === 0 || links(s.chain[i - 1], word))) return false;
  const used = new Set(s.chain);
  for (let i = 0; i < STEPS; i++) {
    const cards = s.choices[i];
    if (!Array.isArray(cards) || cards.length !== CHOICES || new Set(cards).size !== CHOICES
      || !cards.includes(s.chain[i + 1])) return false;
    if (!cards.every((word) => word === s.chain[i + 1]
      || (WORD_SET.has(word) && !used.has(word) && head(word) !== tail(s.chain[i])))) return false;
  }
  if (!s.errors.every((n) => count(n) && n <= CHOICES - 1) || s.errors.slice(s.index + 1).some(Boolean)) return false;
  if (s.wrong.length !== s.errors[s.index] || new Set(s.wrong).size !== s.wrong.length
    || !s.wrong.every((word) => word !== answerOf(s) && currentChoices(s).includes(word))) return false;
  if (s.attempts !== stepsDone(s) + totalErrors(s)) return false;
  if (s.status === 'ready') return s.attempts === 0 && s.seconds === 0;
  if (s.status === 'win') return s.index === STEPS - 1 && s.solved;
  return s.attempts > 0 && !(s.index === STEPS - 1 && s.solved);
}
