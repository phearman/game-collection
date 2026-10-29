// Pure game rules; no DOM, storage or clock reads. All randomness is injectable.
import { WORDS, AMBIGUITY_LEXICON } from './words.js?v=678a533';

export const ROUND_SIZE = 10;
export const DIFFICULTIES = Object.freeze({
  easy: { label: '入門', count: 400, blanks: 1 },
  normal: { label: '一般', count: 1000, blanks: 1 },
  expert: { label: '挑戰', count: WORDS.length, blanks: 2 },
});
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const chars = (word) => [...word];

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

export const poolFor = (difficulty) => {
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new Error('未知難度');
  return WORDS.slice(0, DIFFICULTIES[difficulty].count);
};

// Reject letters that could form ANY alternative word matching the visible cells.
// This also excludes alternatives requiring changes in both challenge blanks.
// Alternatives come from `ambiguity` (by default also the curated-out valid headwords, e.g. 順水行舟).
export function distractorsFor(word, blanks, position, lexicon = WORDS, ambiguity = lexicon === WORDS ? AMBIGUITY_LEXICON : lexicon) {
  const answer = chars(word);
  const alternatives = ambiguity.filter((other) => other !== word && chars(other).every((ch, i) => blanks.includes(i) || ch === answer[i]));
  const forbidden = new Set([answer[position], ...alternatives.map((other) => chars(other)[position])]);
  return [...new Set(lexicon.filter((other) => other !== word).map((other) => chars(other)[position]))].filter((ch) => !forbidden.has(ch));
}

export function makeQuestion(word, blanks, rng = Math.random, lexicon = WORDS) {
  const positions = blanks.slice().sort((a, b) => a - b);
  const choices = positions.map((position) => {
    const distractors = shuffle(distractorsFor(word, positions, position, lexicon), rng).slice(0, 5);
    if (distractors.length !== 5) throw new Error('同位置干擾字不足');
    return shuffle([chars(word)[position], ...distractors], rng);
  });
  return { word, blanks: positions, choices };
}

export function generateQuestions(difficulty = 'easy', { seed, rng = seed === undefined ? Math.random : seededRng(seed) } = {}) {
  return shuffle(poolFor(difficulty), rng).slice(0, ROUND_SIZE).map((word) =>
    makeQuestion(word, shuffle([0, 1, 2, 3], rng).slice(0, DIFFICULTIES[difficulty].blanks), rng));
}

export function initState(difficulty = 'easy', options = {}) {
  return { difficulty, questions: generateQuestions(difficulty, options), index: 0, filled: 0,
    errors: Array(ROUND_SIZE).fill(0), attempts: 0, wrong: null, seconds: 0, status: 'ready' };
}

export const currentQuestion = (s) => s.questions[s.index];
export const questionDone = (s) => s.filled === currentQuestion(s).blanks.length;
export const hasActed = (s) => s.attempts > 0;
export const questionScore = (errors) => Math.max(10, 100 - errors * 30);
export const scoreFor = (s) => s.questions.reduce((sum, _, i) => sum + (i < s.index || (i === s.index && questionDone(s)) ? questionScore(s.errors[i]) : 0), 0);
export const totalErrors = (s) => s.errors.reduce((sum, n) => sum + n, 0);
export const resultOf = (s) => s.status === 'win' ? 'win' : null;

export function answerState(s, letter) {
  const q = currentQuestion(s);
  // 重按剛標紅的錯字不再扣分(手機誤觸兩下)
  if (s.status === 'win' || questionDone(s) || !q.choices[s.filled].includes(letter) || letter === s.wrong) return s;
  const correct = letter === chars(q.word)[q.blanks[s.filled]];
  const errors = s.errors.map((n, i) => n + (i === s.index && !correct ? 1 : 0));
  const filled = s.filled + (correct ? 1 : 0);
  return { ...s, filled, errors, attempts: s.attempts + 1, wrong: correct ? null : letter,
    status: s.index === ROUND_SIZE - 1 && filled === q.blanks.length ? 'win' : 'playing' };
}

export function nextState(s) {
  return !questionDone(s) || s.status === 'win' ? s : { ...s, index: s.index + 1, filled: 0, wrong: null };
}

export function tickState(s) {
  return s.status === 'playing' ? { ...s, seconds: s.seconds + 1 } : s;
}

export function cellsOf(s) {
  const q = currentQuestion(s);
  return chars(q.word).map((ch, i) => {
    const blank = q.blanks.indexOf(i);
    return { text: blank < 0 || blank < s.filled ? ch : blank === s.filled && s.wrong ? s.wrong : '＿',
      active: !questionDone(s) && blank === s.filled, wrong: blank === s.filled && s.wrong !== null };
  });
}

export const lookupUrl = (word) => `https://dict.idioms.moe.edu.tw/idiomList.jsp?webMd=2&la=0&idiom=${encodeURIComponent(word)}`;

const validComicSlug = (slug) => typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug);
export const isComicList = (comics) => Array.isArray(comics);

export function comicFor(comics, word) {
  if (typeof word !== 'string' || !isComicList(comics)) return null;
  return comics.find((comic) => comic !== null && typeof comic === 'object' && !Array.isArray(comic)
    && typeof comic.word === 'string' && comic.ready === true && validComicSlug(comic.slug)
    && comic.word === word)?.slug ?? null;
}

export const comicUrl = (slug) => validComicSlug(slug)
  ? `https://phearman.github.io/classical-chinese-kids-site/idioms/comic.html?id=${encodeURIComponent(slug)}` : null;

export const detailOf = (s) => ({ questions: s.index + (questionDone(s) ? 1 : 0), errors: totalErrors(s), seconds: s.seconds });
export const settlementOf = (s, result = resultOf(s)) => ({ result, score: result === 'win' ? scoreFor(s) : 0, difficulty: s.difficulty, detail: detailOf(s) });
export const toSave = (s) => structuredClone(s);

// Reject inconsistent saves; never trust candidate letters, score or win flags.
export function isValidState(s) {
  if (!s || !Object.hasOwn(DIFFICULTIES, s.difficulty) || !Array.isArray(s.questions) || s.questions.length !== ROUND_SIZE
    || !count(s.index) || s.index >= ROUND_SIZE || !count(s.filled) || !count(s.seconds) || !count(s.attempts)
    || !Array.isArray(s.errors) || s.errors.length !== ROUND_SIZE || !s.errors.every(count)
    || !['ready', 'playing', 'win'].includes(s.status)) return false;
  const pool = new Set(poolFor(s.difficulty));
  if (new Set(s.questions.map((q) => q?.word)).size !== ROUND_SIZE) return false;
  for (const q of s.questions) {
    if (!q || !pool.has(q.word) || !Array.isArray(q.blanks) || q.blanks.length !== DIFFICULTIES[s.difficulty].blanks
      || !q.blanks.every((i, j) => count(i) && i < 4 && (j === 0 || i > q.blanks[j - 1]))
      || !Array.isArray(q.choices) || q.choices.length !== q.blanks.length) return false;
    for (let k = 0; k < q.blanks.length; k++) {
      const choices = q.choices[k], answer = chars(q.word)[q.blanks[k]];
      if (!Array.isArray(choices) || choices.length !== 6 || new Set(choices).size !== 6 || !choices.includes(answer)) return false;
      const safe = new Set(distractorsFor(q.word, q.blanks, q.blanks[k]));
      if (!choices.every((ch) => ch === answer || safe.has(ch))) return false;
    }
  }
  const q = currentQuestion(s);
  if (s.filled > q.blanks.length || s.errors.slice(s.index + 1).some(Boolean)) return false;
  const done = questionDone(s), errors = totalErrors(s);
  if (s.attempts !== s.index * DIFFICULTIES[s.difficulty].blanks + s.filled + errors) return false;
  if (s.wrong !== null && (done || !s.errors[s.index] || !q.choices[s.filled].includes(s.wrong)
    || s.wrong === chars(q.word)[q.blanks[s.filled]])) return false;
  if (s.status === 'ready') return !s.attempts && !s.seconds && s.wrong === null;
  if (s.status === 'win') return s.index === ROUND_SIZE - 1 && done && s.wrong === null;
  return s.attempts > 0 && !(s.index === ROUND_SIZE - 1 && done);
}
