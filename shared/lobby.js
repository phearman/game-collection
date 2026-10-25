// 大廳釘選、精選、分類與排序(RS38 第一期,純前端)。規則見 workbook/plans/rs38-lobby-pin.md §2。
// 動態內容一律 textContent/屬性;偏好與釘選只存本機(R15;雲端同步列第二期)。
import { CHANGELOG } from './changelog.js?v=3baa66c';

export const CATEGORIES = [
  { id: 'puzzle', label: '益智' },
  { id: 'word', label: '文字' },
  { id: 'board', label: '棋類' },
  { id: 'action', label: '動作' },
  { id: 'sport', label: '運動競速' },
];
export const SORTS = [
  { id: 'recent', label: '最近玩過' },
  { id: 'plays', label: '最常玩' },
  { id: 'updated', label: '最近更新' },
  { id: 'name', label: '名稱' },
];
export const PIN_LIMIT = 6;
export const FEATURED_LIMIT = 3;
export const PIN_LIMIT_NOTICE = `最多釘選 ${PIN_LIMIT} 款,先取消一款再釘`;
export const PIN_HINT = '點卡片右上角 📌 可以把常玩的放到最上面';
const VIEW_KEY = 'gc:lobby-view';
const PINS_KEY = 'gc:lobby-pins';

// Codex #182:取 localStorage 的 getter 本身可能拋 SecurityError(封鎖網站資料),一律在保護內取,失敗當作沒有儲存。
export function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function read(storage, key) {
  try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* 寫不進去仍照常顯示 */ }
}
const playable = (games) => new Set(games.filter((g) => g.status === 'active').map((g) => g.id));

// R5:只留現存且可玩、不重複,最多 PIN_LIMIT 款。
export function cleanPins(ids, games) {
  const ok = playable(games);
  return [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => typeof id === 'string' && ok.has(id)).slice(0, PIN_LIMIT);
}
export const loadPins = (games, storage = defaultStorage()) => cleanPins(read(storage, PINS_KEY), games);
export const savePins = (ids, storage = defaultStorage()) => write(storage, PINS_KEY, ids);

export function loadView(storage = defaultStorage()) {
  const v = read(storage, VIEW_KEY) ?? {};
  return {
    category: CATEGORIES.some((c) => c.id === v.category) ? v.category : 'all',
    sort: SORTS.some((s) => s.id === v.sort) ? v.sort : 'recent',
    hintClosed: v.hintClosed === true,
  };
}
export const saveView = (view, storage = defaultStorage()) => write(storage, VIEW_KEY, view);

// 釘選切換:→ { pins, full }。已滿時不動、回 full=true(R3,⛔ 自動擠掉舊的)。
export function togglePin(pins, id) {
  if (pins.includes(id)) return { pins: pins.filter((p) => p !== id), full: false };
  if (pins.length >= PIN_LIMIT) return { pins, full: true };
  return { pins: [...pins, id], full: false };
}

// ⑥ 最近更新:更新紀錄裡該遊戲代號最近一筆的日期(scope 為 G{n})。
export function latestUpdates(changelog = CHANGELOG) {
  const map = new Map();
  for (const entry of changelog) for (const item of entry.items ?? []) {
    if (/^G\d+$/.test(item.scope ?? '') && !(map.get(item.scope) >= entry.date)) map.set(item.scope, entry.date);
  }
  return map;
}

// R12 四種排序。recent = 現行 recentOrder 的 id 順序;stats = summary 的各遊戲統計;同分一律退回 recent 順序(穩定)。
export function sortGames(list, mode, { recent = [], updates = latestUpdates(), order = [] } = {}) {
  const rank = new Map(recent.map((id, i) => [id, i]));
  const base = new Map(order.map((id, i) => [id, i]));
  const byRecent = (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || (base.get(a.id) ?? 0) - (base.get(b.id) ?? 0);
  const sorted = [...list];
  if (mode === 'plays') sorted.sort((a, b) => (b.stats?.plays_count ?? 0) - (a.stats?.plays_count ?? 0) || byRecent(a, b));
  else if (mode === 'updated') sorted.sort((a, b) => (updates.get(b.code) ?? '').localeCompare(updates.get(a.code) ?? '')
    || (base.get(a.id) ?? 0) - (base.get(b.id) ?? 0));
  else if (mode === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant') || byRecent(a, b));
  else sorted.sort(byRecent);
  return sorted;
}

// R6 精選:games.js 的 featured = { order, note };最多 3 款,依 order。
export const featuredGames = (games) => games.filter((g) => g.status === 'active' && g.featured)
  .sort((a, b) => (a.featured.order ?? 0) - (b.featured.order ?? 0)).slice(0, FEATURED_LIMIT);

// 大廳卡片區。games = summary.games(含 stats);recent = summary.recent;saves = 有存檔的 id。
export function mountLobby({ doc, games, recent, saves = new Set(), storage = defaultStorage(), catalog = games,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout }) {
  const $ = (id) => doc.getElementById(id);
  const order = catalog.map((g) => g.id);
  const updates = latestUpdates();
  let view = loadView(storage);
  let pins = loadPins(catalog, storage);
  const node = (tag, cls, text) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const card = (g, { note, pinned } = {}) => {
    const active = g.status === 'active';
    const wrap = node('div', 'card-wrap');
    const link = node('a', `card${active ? ' is-active' : ''}`);
    link.href = `games/${g.id}/`;
    const head = node('div', 'card-head');
    const icon = node('span', 'card-icon', g.icon);
    icon.setAttribute('aria-hidden', 'true');
    const tags = node('span', 'card-tags');
    if (saves.has(g.id)) tags.append(node('span', 'tag is-resume', '繼續'));
    if (note && pinned) tags.append(node('span', 'tag is-pinned', '已釘選'));
    tags.append(node('span', `tag${active ? ' is-active' : ''}`, active ? '開發中' : '規劃中'));
    head.append(icon, tags);
    const title = node('p', 'card-title');
    if (g.code) title.append(node('span', 'card-code', `${g.code}${g.version ? ` v${g.version}` : ''}`));
    title.append(doc.createTextNode(g.title));
    link.append(head, title);
    if (note) link.append(node('p', 'card-note', note));
    link.append(node('p', 'card-desc', g.desc));
    const best = g.stats?.best_score ?? 0;
    if (best) link.append(node('p', 'card-meta', `最佳 ${best.toLocaleString()}`));
    wrap.append(link);
    // R1/R18:📌 鈕是卡片連結的兄弟元素,⛔ 放進 <a>。
    if (active) {
      const pin = node('button', 'pin-btn', '📌');
      pin.type = 'button';
      pin.dataset.game = g.id;
      const on = pins.includes(g.id);
      pin.setAttribute('aria-pressed', String(on));
      pin.setAttribute('aria-label', `${on ? '取消釘選' : '釘選'} ${g.title}`);
      pin.title = on ? '取消釘選' : '釘選到最上面';
      pin.addEventListener('click', (event) => { event.preventDefault?.(); event.stopPropagation?.(); toggle(g.id, pin); });
      wrap.append(pin);
    }
    return wrap;
  };
  const byId = new Map(games.map((g) => [g.id, g]));
  const tabs = () => {
    const box = $('category-tabs');
    const all = games.filter((g) => !pins.includes(g.id));
    const buttons = [{ id: 'all', label: '全部' }, ...CATEGORIES].map((c, i, list) => {
      const count = c.id === 'all' ? all.length : all.filter((g) => g.category === c.id).length;
      const b = node('button', 'btn category-btn', `${c.label} ${count}`);
      b.type = 'button'; b.dataset.category = c.id;
      b.setAttribute('aria-pressed', String(view.category === c.id));
      b.addEventListener('click', () => { view = { ...view, category: c.id }; saveView(view, storage); render(); $('category-tabs').children[i]?.focus?.(); });
      b.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        event.preventDefault?.();
        const next = (i + step + list.length) % list.length;
        view = { ...view, category: list[next].id }; saveView(view, storage); render();
        $('category-tabs').children[next]?.focus?.();
      });
      return b;
    });
    box.replaceChildren(...buttons);
  };
  function render() {
    const featured = featuredGames(catalog).map((g) => byId.get(g.id) ?? g);
    $('featured').hidden = !featured.length;
    $('featured-cards').replaceChildren(...featured.map((g) => card(g, { note: g.featured.note, pinned: pins.includes(g.id) })));
    const opts = { recent, updates, order };
    const pinned = sortGames(pins.map((id) => byId.get(id)).filter(Boolean), view.sort, opts);
    $('pinned').hidden = !pinned.length;
    $('pinned-cards').replaceChildren(...pinned.map((g) => card(g)));
    $('pin-hint').hidden = Boolean(pinned.length) || view.hintClosed;
    const rest = games.filter((g) => !pins.includes(g.id) && (view.category === 'all' || g.category === view.category));
    $('cards').replaceChildren(...sortGames(rest, view.sort, opts).map((g) => card(g)));
    $('sort').value = view.sort;
    tabs();
  }
  // Codex #182:滿額提示改為視窗內浮動提示(仍是 aria-live),點哪一區的 📌 都看得到;幾秒後自動收起。
  let msgTimer = null;
  // 底部已有的提示(儲存空間不足、離線結算,皆在 bottom:16px 置中):滿額提示往上錯開到它們之上(Codex #182 複審)。
  const BOTTOM_NOTES = ['storage-warning', 'cloud-offline-finish'];
  const liftAbove = (msg) => {
    if (!msg.style) return;
    const lift = BOTTOM_NOTES.map((id) => doc.querySelector?.(`#${id}`)).filter(Boolean)
      .reduce((max, note) => Math.max(max, note.getBoundingClientRect?.().height || 40), 0);
    msg.style.bottom = lift ? `${16 + Math.ceil(lift) + 8}px` : '';
  };
  const notify = (text) => {
    const msg = $('pin-msg');
    msg.textContent = text;
    if (text) liftAbove(msg);
    if (msgTimer) clearTimer(msgTimer);
    msgTimer = text ? setTimer(() => { msg.textContent = ''; msgTimer = null; }, 4000) : null;
  };
  // Codex #182:重畫後焦點回到同一款遊戲的新 📌(優先原本那一區,再釘選區、精選區、全部遊戲);
  // 被分類篩掉時移到目前選中的分類籤,⛔ 讓焦點掉回頁首。
  const refocus = (id, origin) => {
    const sections = [origin, 'pinned-cards', 'featured-cards', 'cards'].filter(Boolean);
    for (const section of new Set(sections)) {
      const wrap = [...($(section).children ?? [])].find((w) => w.children?.[1]?.dataset?.game === id);
      if (wrap) { wrap.children[1].focus?.(); return; }
    }
    [...($('category-tabs').children ?? [])].find((b) => b.getAttribute?.('aria-pressed') === 'true')?.focus?.();
  };
  function toggle(id, button) {
    const next = togglePin(pins, id);
    if (next.full) { notify(PIN_LIMIT_NOTICE); return; }
    notify('');
    const origin = ['featured-cards', 'pinned-cards', 'cards'].find((s) => [...($(s).children ?? [])].some((w) => w.children?.[1] === button));
    pins = next.pins; savePins(pins, storage); render();
    refocus(id, origin);
  }
  $('sort').replaceChildren(...SORTS.map((s) => { const o = node('option', '', s.label); o.value = s.id; return o; }));
  $('sort').addEventListener('change', () => { view = { ...view, sort: $('sort').value }; saveView(view, storage); render(); });
  $('pin-hint-close').addEventListener('click', () => { view = { ...view, hintClosed: true }; saveView(view, storage); render(); });
  render();
  return { render, get pins() { return pins; }, get view() { return view; } };
}
