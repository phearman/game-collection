import { load, save } from './storage.js';

const root = document.documentElement;

function current() {
  const set = root.dataset.theme;
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function label(btn) {
  const dark = current() === 'dark';
  btn.textContent = dark ? '☀' : '☾';
  btn.setAttribute('aria-label', dark ? '切換為淺色' : '切換為深色');
  btn.title = dark ? '切換為淺色' : '切換為深色';
}

const saved = load('theme');
if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

export function bindThemeToggle(btn) {
  label(btn);
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    save('theme', next);
    label(btn);
  });
}
