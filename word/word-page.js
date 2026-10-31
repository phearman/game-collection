// Pure URL and display logic; browser APIs live in ui.js.
export function parseWord(search) {
  const params = new URLSearchParams(search);
  if (params.getAll('w').length !== 1) return null;
  const word = params.get('w').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  return word.length <= 40 && /^[a-z]+(['-][a-z]+)*( [a-z]+(['-][a-z]+)*){0,2}$/u.test(word) ? word : null;
}
export function cambridgeUrl(word) {
  return 'https://dictionary.cambridge.org/zht/' + encodeURIComponent('詞典') + '/'
    + encodeURIComponent('英語-漢語-繁體') + '/' + encodeURIComponent(word.replace(/ /gu, '-')).replace(/'/gu, '%27');
}
export function wordModel(word, entry, { unavailable = false } = {}) {
  if (!word) return { word: '', heading: '請從單字卡開啟發音頁，或在網址提供有效的英文單字。', definitions: [], stars: '', phonetic: '', note: '', url: null };
  const found = entry && typeof entry.display === 'string' && entry.display.length > 0
    && Array.isArray(entry.defs) && entry.defs.length > 0 && entry.defs.every((line) => typeof line === 'string')
    && ['word', 'phrase'].includes(entry.kind);
  return { word: found ? entry.display : word, heading: found ? entry.display : word,
    phonetic: found && typeof entry.phonetic === 'string' && entry.phonetic ? `/${entry.phonetic}/` : '',
    definitions: found ? entry.defs.slice(0, 4) : [],
    stars: found && entry.kind === 'word' && Number.isInteger(entry.stars) && entry.stars >= 1 && entry.stars <= 5
      ? '★'.repeat(entry.stars) + '☆'.repeat(5 - entry.stars) : '',
    note: found ? (entry.form && entry.label ? `${entry.form} 是 ${entry.display} 的${entry.label}` : '')
      : unavailable ? '詞典暫時無法載入，仍可使用下方發音與連結。' : entry?.status === 'invalid' ? '這個單字格式無效，請從單字卡重新開啟。' : '詞典裡找不到這個字，仍可試用下方發音與連結。',
    url: cambridgeUrl(found ? entry.display.toLowerCase() : word) };
}
