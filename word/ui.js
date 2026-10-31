import { bindThemeToggle } from '../shared/theme.js?v=b19b96f';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, cloudEnabled } from '../shared/supabase-config.js?v=b19b96f';
import { parseWord, wordModel } from './word-page.js?v=b19b96f';

bindThemeToggle(document.getElementById('theme'));
const word = parseWord(location.search);
const speak = document.getElementById('speak');
let spokenWord = word;
function render(entry, unavailable = false) {
  const model = wordModel(word, entry, { unavailable });
  spokenWord = model.word;
  for (const [id, value] of [['word', model.heading], ['phonetic', model.phonetic], ['stars', model.stars], ['note', model.note]]) {
    document.getElementById(id).textContent = value;
  }
  const definitions = document.getElementById('definitions');
  definitions.replaceChildren(...model.definitions.map((text) => {
    const line = document.createElement('p'); line.textContent = text; return line;
  }));
  const link = document.getElementById('cambridge');
  link.hidden = !model.url;
  if (model.url) link.href = model.url;
}
const synth = window.speechSynthesis;
function updateVoice() {
  const voices = synth?.getVoices() ?? [];
  const voice = voices.find((v) => /^en[-_]US$/iu.test(v.lang)) ?? voices.find((v) => /^en(?:[-_]|$)/iu.test(v.lang));
  speak.hidden = !word || !voice || typeof window.SpeechSynthesisUtterance !== 'function';
  document.getElementById('speech-hint').hidden = !word || !speak.hidden;
  return voice;
}
speak.addEventListener('click', () => {
  const voice = updateVoice();
  if (speak.hidden) return;
  const utterance = new SpeechSynthesisUtterance(spokenWord);
  utterance.lang = 'en-US'; utterance.rate = 0.9; utterance.voice = voice;
  synth.cancel(); synth.speak(utterance);
});
synth?.addEventListener('voiceschanged', updateVoice);
render(null, true);
if (word && cloudEnabled) document.getElementById('note').textContent = '載入中…';
updateVoice();
if (word && cloudEnabled) {
  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/u, '')}/rest/v1/rpc/dict_word_public`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_word: word }), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Unavailable');
    render(await response.json());
  } catch { render(null, true); }
}
