// 美術主題(RS19):與深淺色(theme.js)分開的另一個軸,以 <html data-skin="…"> 切換。
// 樣式在 shared/skins.css(每個主題都有深淺兩套);Canvas 遊戲另用 skinChange 事件重讀色票。
export const SKINS = Object.freeze([
  Object.freeze({ id: 'classic', label: '經典', note: '目前的樣子(預設)' }),
  Object.freeze({ id: 'storybook', label: '繪本', note: '暖色、粗描邊、童書插畫' }),
  Object.freeze({ id: 'neon', label: '霓虹街機', note: '發光邊框、復古電玩' }),
  Object.freeze({ id: 'paper', label: '清新紙片', note: '粉彩、剪紙層次、圓潤大按鈕' }),
]);
export const DEFAULT_SKIN = 'classic';
export const SKIN_KEY = 'gc:skin';
// 第一期:大廳顯示「主題樣板比較」區塊;使用者挑定後改 false(此時只有選了非 classic 才顯示)。
export const SKIN_COMPARE_PHASE = true;
export const SKIN_EVENT = 'gc:skinchange';

// 值域外(含 null、非字串、原型屬性名)一律回退 classic。
export function normalizeSkin(value) {
  return SKINS.some((skin) => skin.id === value) ? value : DEFAULT_SKIN;
}

// localStorage 不可用或拋錯時不報錯,視為 classic / 只改本頁。
export function readSkin(env = globalThis) {
  try { return normalizeSkin(env.localStorage?.getItem(SKIN_KEY)); } catch { return DEFAULT_SKIN; }
}

// 目前是否深色:明確的 data-theme 優先,否則看系統偏好。
export function isDark(env = globalThis) {
  const set = env.document?.documentElement?.dataset?.theme;
  if (set) return set === 'dark';
  try { return Boolean(env.matchMedia?.('(prefers-color-scheme: dark)').matches); } catch { return false; }
}

export function applySkin(root, id) {
  if (root) root.dataset.skin = normalizeSkin(id);
}

export function currentSkin(env = globalThis) {
  const set = env.document?.documentElement?.dataset?.skin;
  return set ? normalizeSkin(set) : readSkin(env);
}

// 切換:寫入 localStorage(失敗仍套用本頁)、套到 <html>、通知畫面層(Canvas 重讀色票)。
// persist=false 用於「別的分頁已經寫好了」的同步:只套用本頁,⛔ 不回寫,否則兩頁會互相來回觸發 storage 事件。
export function setSkin(value, env = globalThis, { persist = true } = {}) {
  const id = normalizeSkin(value);
  if (persist) {
    try { env.localStorage?.setItem(SKIN_KEY, id); } catch { /* 儲存不可用:只改本頁 */ }
  }
  applySkin(env.document?.documentElement, id);
  try { env.document?.dispatchEvent(new env.CustomEvent(SKIN_EVENT, { detail: { skin: id } })); } catch { /* 無事件環境 */ }
  return id;
}

// 載入即套用(沒有 DOM 的環境,例如 node 測試,略過)。
if (typeof document !== 'undefined') {
  applySkin(document.documentElement, readSkin());
  addEventListener('storage', onSkinStorage);
}

// 跨分頁同步:只套用,不回寫(見 setSkin persist)。key 為 null = 另一頁清空了全部儲存。
export function onSkinStorage(event, env = globalThis) {
  if (event.key !== SKIN_KEY && event.key !== null) return;
  setSkin(event.key === null ? DEFAULT_SKIN : event.newValue, env, { persist: false });
}

// 頂列 🎨 鈕:只掛在大廳與「我的紀錄」(#theme 帶 data-skin-toggle="on",見 theme.js);遊戲頁頂列已滿,只套用主題、不放切換鈕。
// 放在音效鈕與深淺色鈕之間(同一個 .topbar-toggles 群組),點開小選單。
export function mountSkinToggle(themeButton) {
  const doc = themeButton.ownerDocument;
  if (doc.getElementById('skin')) return;
  const button = doc.createElement('button');
  button.id = 'skin'; button.type = 'button'; button.className = 'btn';
  button.textContent = '🎨';
  button.title = '美術主題'; button.setAttribute('aria-label', '美術主題');
  button.setAttribute('aria-haspopup', 'true'); button.setAttribute('aria-expanded', 'false');
  const menu = doc.createElement('div');
  menu.className = 'skin-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '美術主題'); menu.hidden = true;
  const items = SKINS.map((skin) => {
    const item = doc.createElement('button');
    item.type = 'button'; item.className = 'skin-item'; item.dataset.skin = skin.id;
    item.setAttribute('role', 'menuitemradio');
    const name = doc.createElement('strong'); name.textContent = skin.label;
    const note = doc.createElement('span'); note.textContent = skin.note;
    item.append(name, note);
    item.addEventListener('click', () => { setSkin(skin.id); close(); button.focus(); });
    return item;
  });
  menu.append(...items);
  const sync = () => items.forEach((item) => item.setAttribute('aria-checked', String(item.dataset.skin === currentSkin())));
  function close() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) { sync(); items.find((item) => item.getAttribute('aria-checked') === 'true')?.focus(); }
  });
  doc.addEventListener('click', (event) => { if (!menu.hidden && event.target !== button && !menu.contains(event.target)) close(); });
  doc.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) { close(); button.focus(); } });
  doc.addEventListener(SKIN_EVENT, sync);
  themeButton.before(button);
  themeButton.parentElement?.append(menu);
}
