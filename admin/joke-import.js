// Pure import validation; no network or DOM. Hash normalization mirrors migration 0009.
export const JOKE_CATEGORIES = Object.freeze(['物品', '動物', '校園', '諧音', '生活', '益智', '食物', '自然', '語文', '急轉彎']);
const length = (value) => Array.from(value).length;
const forbiddenCharacters = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u202a-\u202e\u2066-\u2069\ufeff]/u;
export function creditValid(value) {
  if (value == null) return true;
  if (typeof value !== 'string' || length(value) > 100) return false;
  const text = value.normalize('NFKC');
  if (forbiddenCharacters.test(text) || /(?:javascript|data|mailto|tel):/iu.test(text)) return false;
  if (!/(?:www\.|[a-z][a-z0-9+.-]*:\/\/)/iu.test(text)) return !/(?:[a-z0-9-]+\.)+[a-z]{2,63}($|[^a-z0-9-])/iu.test(text);
  if (!text.includes('https://')) return false;
  const rest = text.replace(/https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9_~!$&()*+,;=%.:/-]*)?/gu, '');
  return !/(?:www\.|[a-z][a-z0-9+.-]*:\/\/|[?#@\\]|(?:[a-z0-9-]+\.)+[a-z]{2,63}($|[^a-z0-9-]))/iu.test(rest);
}
export const JOKE_IGNORED_CHARACTERS = '\u0009\u000A\u000B\u000C\u000D\u0020\u0085\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\u200B\u200C\u200D\u200E\u200F\u2060\uFEFF\u00AD\u034F\u180E\u2061\u2062\u2063\u2064\uFE00\uFE01\uFE02\uFE03\uFE04\uFE05\uFE06\uFE07\uFE08\uFE09\uFE0A\uFE0B\uFE0C\uFE0D\uFE0E\uFE0F\u3164\uFFA0\u1160!"#$%&\u0027()*+,-./:;<=>?@[\u005C]^_`{|}~，。！？、；：「」『』（）【】《》〈〉〔〕〖〗〘〙〚〛…‥—–―～〜·・‧“”‘’﹏';
const ignoredCharacters = new Set(JOKE_IGNORED_CHARACTERS);
export function normalizeJokeBody(body) {
  return Array.from(body.normalize('NFKC')).filter((character) => !ignoredCharacters.has(character)).join('');
}

export function jokeFieldsError({ category, body, answer = null, credit = null }) {
  if (!JOKE_CATEGORIES.includes(category)) return '分類無效';
  if (typeof body !== 'string' || length(body) < 10 || length(body) > 200 ||
      length(body.normalize('NFKC')) < 10 || length(body.normalize('NFKC')) > 200 || !normalizeJokeBody(body)) return '題目需 10～200 字';
  if (category === '急轉彎') {
    if (typeof answer !== 'string' || length(answer.trim()) < 1 || length(answer.trim()) > 60) return '急轉彎答案需 1～60 字';
  } else if (answer != null && answer !== '') return '只有急轉彎可填答案';
  if (typeof answer === 'string' && forbiddenCharacters.test(answer.normalize('NFKC'))) return '答案不可含控制、方向控制或零寬字元';
  if (!creditValid(credit)) return '出處最多 100 字，不可含控制、方向控制或零寬字元，網址須 HTTPS 且不含查詢參數或 fragment';
  return null;
}
function csvRows(text) {
  const rows = []; let row = []; let field = ''; let quoted = false; let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === ',' || char === '\n') {
      row.push(field); field = ''; closed = false;
      if (char === '\n') { rows.push(row); row = []; }
    } else if (char === '"') {
      if (field || closed) throw new Error('CSV 引號格式錯誤');
      quoted = true;
    } else {
      if (closed) throw new Error('CSV 引號後只能接逗號或換行');
      field += char;
    }
  }
  if (quoted) throw new Error('CSV 引號未結束');
  row.push(field); rows.push(row); return rows;
}
export function parseJokeImport(input) {
  const errors = []; const rows = [];
  if (typeof input !== 'string') return { rows, errors: ['請貼上匯入文字'], valid: false };
  const text = input.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  let values;
  try {
    const first = text.split('\n').find((line) => line.trim()) ?? '';
    const pipe = first.includes('|') && !first.startsWith('"') && (!first.includes(',') || first.indexOf('|') < first.indexOf(','));
    values = (pipe ? text.split('\n').map((line) => line.split('|')) : csvRows(text)).filter((row) => row.some((field) => field.trim()));
    if (values[0]?.map((field) => field.trim()).join(',') === '分類,題目,答案,出處') values.shift();
  } catch (error) { return { rows, errors: [error.message], valid: false }; }
  if (!values.length || values.length > 200) errors.push('單次需 1～200 則');
  const seen = new Set();
  values.forEach((fields, index) => {
    if (fields.length !== 4) { errors.push(`第 ${index + 1} 則：需四欄（分類、題目、答案、出處）`); return; }
    const [category, body] = fields.map((field) => field.trim());
    const [, , rawAnswer, rawCredit] = fields;
    const row = { category, body, answer: rawAnswer.trim() || null, credit: rawCredit.trim() || null };
    rows.push(row);
    // Validate before trimming so boundary control/zero-width characters cannot disappear.
    const error = jokeFieldsError({ ...row, answer: rawAnswer || null, credit: rawCredit || null });
    if (error) errors.push(`第 ${index + 1} 則：${error}`);
    const key = normalizeJokeBody(body);
    if (seen.has(key)) errors.push(`第 ${index + 1} 則：檔內題目重複`);
    seen.add(key);
  });
  return { rows, errors, valid: errors.length === 0 };
}
