// G18 古詩動畫〈過故人莊〉(DV27)。驗收依據 workbook/plans/rq10-poem-animation.md R1~R12。
// 純資料與純函式:⛔ DOM、⛔ 儲存、⛔ 時鐘;亂數一律可注入。

export const POEM = Object.freeze({
  title: '過故人莊', dynasty: '唐', author: '孟浩然',
  lines: Object.freeze(['故人具雞黍', '邀我至田家', '綠樹村邊合', '青山郭外斜', '開軒面場圃', '把酒話桑麻', '待到重陽日', '還來就菊花']),
});
export const LINE_COUNT = POEM.lines.length;
export const SECTIONS = Object.freeze(['story', 'cards', 'pictures', 'quiz']);
export const SECTION_LABELS = Object.freeze({ story: '① 故事', cards: '② 詞卡', pictures: '③ 四圖四句', quiz: '④ 看圖填空' });

// R3 故事 8 幕(幕 0 封面);lines=該幕對應的詩句序號(高亮用)。art=ui.js 的畫面代碼。
export const SCENES = Object.freeze([
  { art: 'cover', caption: '〈過故人莊〉 唐・孟浩然', lines: [0, 1, 2, 3, 4, 5, 6, 7] },
  { art: 'letter', caption: '爺爺的老朋友陳爺爺來信:「我殺了雞、煮好黃米飯,快來吃飯!」', lines: [0] },
  { art: 'path', caption: '我們走呀走,來到鄉下陳爺爺的家。', lines: [1] },
  { art: 'village', caption: '村子四周都是綠樹,像一道綠色的牆把村子圍起來。', lines: [2] },
  { art: 'hills', caption: '抬頭一看,城牆外的青山斜斜地靠在天邊。', lines: [3] },
  { art: 'window', caption: '陳爺爺打開窗戶,窗外就是曬穀場和菜園。', lines: [4] },
  { art: 'toast', caption: '兩位爺爺一邊喝酒,一邊聊今年的桑樹和麻長得好不好。', lines: [5] },
  { art: 'farewell', caption: '要回家了,爺爺說:「等到重陽節,我還要來看你的菊花!」', lines: [6, 7] },
].map((scene) => Object.freeze({ ...scene, lines: Object.freeze(scene.lines) })));

// R6 四圖串四句:每張圖對一聯(兩句),畫面取自分鏡的幕。
export const PICTURES = Object.freeze([
  { scenes: [1, 2], lines: [0, 1] },
  { scenes: [3, 4], lines: [2, 3] },
  { scenes: [5, 6], lines: [4, 5] },
  { scenes: [7], lines: [6, 7] },
].map((p) => Object.freeze({ scenes: Object.freeze(p.scenes), lines: Object.freeze(p.lines) })));

// R5 詞卡 13 張:注音與意思自寫(⛔ 照抄辭典釋義)。line=出現在第幾句。
export const CARDS = Object.freeze([
  { word: '故人', zhuyin: 'ㄍㄨˋ ㄖㄣˊ', meaning: '老朋友。', icon: '👴', line: 0 },
  { word: '具', zhuyin: 'ㄐㄩˋ', meaning: '準備好。', icon: '🍳', line: 0 },
  { word: '雞黍', zhuyin: 'ㄐㄧ ㄕㄨˇ', meaning: '雞肉和黃米飯,是招待客人的好菜。', icon: '🍗', line: 0 },
  { word: '田家', zhuyin: 'ㄊㄧㄢˊ ㄐㄧㄚ', meaning: '鄉下種田的人家。', icon: '🏡', line: 1 },
  { word: '合', zhuyin: 'ㄏㄜˊ', meaning: '圍繞起來。', icon: '🌳', line: 2 },
  { word: '郭', zhuyin: 'ㄍㄨㄛ', meaning: '城外面再圍起來的一道城牆。', icon: '🧱', line: 3 },
  { word: '斜', zhuyin: 'ㄒㄧㄝˊ', meaning: '斜斜地延伸過去。', icon: '⛰️', line: 3,
    note: '古時候念 ㄒㄧㄚˊ,跟「家、麻、花」押韻。' },
  { word: '軒', zhuyin: 'ㄒㄩㄢ', meaning: '窗戶。', icon: '🪟', line: 4 },
  { word: '場圃', zhuyin: 'ㄔㄤˊ ㄆㄨˇ', meaning: '曬穀子的空地和種菜的園子。', icon: '🌾', line: 4 },
  { word: '把酒', zhuyin: 'ㄅㄚˇ ㄐㄧㄡˇ', meaning: '拿起酒杯。', icon: '🍶', line: 5 },
  { word: '桑麻', zhuyin: 'ㄙㄤ ㄇㄚˊ', meaning: '桑樹和麻,用來說種田的大小事。', icon: '🌱', line: 5 },
  { word: '重陽', zhuyin: 'ㄔㄨㄥˊ ㄧㄤˊ', meaning: '農曆九月九日,有賞菊花的習俗。', icon: '🗓️', line: 6 },
  { word: '就', zhuyin: 'ㄐㄧㄡˋ', meaning: '靠近,這裡是去看的意思。', icon: '🌼', line: 7 },
].map((card) => Object.freeze(card)));

// R7 每句挖空的字。
export const BLANKS = Object.freeze(['黍', '田', '合', '郭', '軒', '桑', '陽', '菊']);
export const CHOICE_COUNT = 4;

/** 第 i 句對應的故事幕(看圖填空用):第一個 lines 含它的非封面幕。 */
export function sceneForLine(line) {
  return SCENES.findIndex((scene, i) => i > 0 && scene.lines.includes(line));
}
/** 詩中某個字所屬的詞卡(四圖頁點字用):同句、詞包含該字;沒有就 null。 */
export function cardForChar(line, ch) {
  const index = CARDS.findIndex((card) => card.line === line && [...card.word].includes(ch));
  return index < 0 ? null : index;
}

export function seededRng(seed) {
  let x = 2166136261;
  for (const ch of String(seed)) x = Math.imul(x ^ ch.codePointAt(0), 16777619) >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
export function shuffle(values, rng = Math.random) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 干擾字=本詩其他句的字(⛔ 正解、⛔ 同句已出現的字),不重複。
export function distractorsFor(line) {
  const own = new Set(POEM.lines[line]);
  return [...new Set(POEM.lines.join(''))].filter((ch) => !own.has(ch) && ch !== BLANKS[line]);
}

export function makeQuestion(line, rng = Math.random) {
  const text = POEM.lines[line];
  const answer = BLANKS[line];
  const blank = [...text].indexOf(answer);
  const choices = shuffle([answer, ...shuffle(distractorsFor(line), rng).slice(0, CHOICE_COUNT - 1)], rng);
  return { line, blank, answer, choices, scene: sceneForLine(line) };
}

/** R7:8 題、題序與選項順序用注入的亂數。 */
export function initQuiz(rng = Math.random) {
  const order = shuffle([...Array(LINE_COUNT).keys()], rng);
  return { questions: order.map((line) => makeQuestion(line, rng)), index: 0, wrong: order.map(() => []), solved: order.map(() => false) };
}
export const currentQuestion = (s) => s.questions[s.index];
export const quizDone = (s) => s.solved.every(Boolean);
/** 第一次就選對 = solved 且沒有選錯過。 */
export const firstTry = (s, i) => s.solved[i] && s.wrong[i].length === 0;
/** R8:分數 = 第一次就選對的題數(0~8)。 */
export const scoreOf = (s) => s.questions.reduce((n, _, i) => n + (firstTry(s, i) ? 1 : 0), 0);

/** 選一個字:答錯標紅可再選(同一個錯字重按不變);答對就鎖住這題。 */
export function answerQuiz(s, ch) {
  const i = s.index;
  const q = s.questions[i];
  if (s.solved[i] || !q.choices.includes(ch) || s.wrong[i].includes(ch)) return s;
  if (ch === q.answer) return { ...s, solved: s.solved.map((v, j) => j === i || v) };
  return { ...s, wrong: s.wrong.map((w, j) => j === i ? [...w, ch] : w) };
}
export function nextQuestion(s) {
  if (!s.solved[s.index] || s.index >= s.questions.length - 1) return s;
  return { ...s, index: s.index + 1 };
}
/** 句子挖空後的樣子(答對後補回)。 */
export function blankedLine(q, solved = false) {
  return [...POEM.lines[q.line]].map((ch, i) => i === q.blank && !solved ? '〇' : ch).join('');
}
/** 錯題回看:第一次沒選對的題目。 */
export const missedQuestions = (s) => s.questions.filter((_, i) => !firstTry(s, i));
export const settlementOf = (s) => ({ result: 'win', score: scoreOf(s), difficulty: 'normal',
  detail: { correct: scoreOf(s), total: s.questions.length, mistakes: s.wrong.reduce((n, w) => n + w.length, 0) } });

/** R2:本機記住上次看到哪一段;不認得的值一律從 ① 開始。 */
export const sectionFrom = (value) => SECTIONS.includes(value) ? value : 'story';
export const clampScene = (n) => Math.max(0, Math.min(SCENES.length - 1, Number.isInteger(n) ? n : 0));
export const clampCard = (n) => (Number.isInteger(n) ? ((n % CARDS.length) + CARDS.length) % CARDS.length : 0);
