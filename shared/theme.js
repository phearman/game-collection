import { load, save } from './storage.js?v=c5addad0';
import { mountSoundToggle } from './sound.js?v=c5addad0';
import { mountSkinToggle } from './skin.js?v=c5addad0';

const root = document.documentElement;

function current() {
  const set = root.dataset.theme;
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function label(btn) {
  const dark = current() === 'dark';
  // RS7:☾ 在多數字型像字母 C ⇒ 改線條圖示(icons.css 的 gi-sun / gi-moon)
  const glyph = btn.ownerDocument.createElement('span');
  glyph.className = `gi gi-${dark ? 'sun' : 'moon'}`;
  btn.replaceChildren(glyph);
  btn.setAttribute('aria-label', dark ? '切換為淺色' : '切換為深色');
  btn.title = dark ? '切換為淺色' : '切換為深色';
}

const saved = load('theme');
if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

export function bindThemeToggle(btn) {
  mountSoundToggle(btn);
  if (btn.dataset?.skinToggle === 'on') mountSkinToggle(btn); // 只有大廳、我的紀錄有 🎨(遊戲頁頂列已滿)
  label(btn);
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    save('theme', next);
    label(btn);
  });
}
