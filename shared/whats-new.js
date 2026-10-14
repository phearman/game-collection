import { CHANGELOG } from './changelog.js?v=5cadbe4';
import { GAMES } from './games.js?v=5cadbe4';

export const SEEN_UPDATE_KEY = 'gc:seen-update';

export function latestUpdateKey(latest) {
  return latest ? `${latest.date}|${latest.title}` : null;
}

export function shouldShow({ seen, latestKey, hasHistory }) {
  if (!latestKey || seen === latestKey) return false;
  return seen != null || Boolean(hasHistory);
}

// 統計也保留了舊版最佳分數及已超出最近紀錄上限的遊玩痕跡。
export function hasPlayHistory(summary) {
  return Boolean(summary.plays?.length || summary.saves?.length
    || summary.games?.some(({ stats }) => stats && (stats.last_played_at
      || stats.plays_count > 0 || stats.best_score > 0 || stats.total_sec > 0)));
}

// 大廳傳入紀錄判斷;儲存與 document 可注入,不在模組載入時存取瀏覽器。
export function setupWhatsNew({ hasHistory, latest = CHANGELOG[0],
  games = GAMES, storage, doc = globalThis.document } = {}) {
  const latestKey = latestUpdateKey(latest);
  if (!latestKey) return null;
  let seen;
  try {
    storage ??= globalThis.localStorage;
    seen = storage.getItem(SEEN_UPDATE_KEY);
    if (!shouldShow({ seen, latestKey, hasHistory })) {
      if (seen === null) storage.setItem(SEEN_UPDATE_KEY, latestKey);
      return null;
    }
    // 先確認可寫,保留原值;沒有原值時還原成沒有此 key。
    storage.setItem(SEEN_UPDATE_KEY, seen ?? '');
    if (seen === null) storage.removeItem(SEEN_UPDATE_KEY);
  } catch {
    return null;
  }

  const node = (tag, cls, text) => {
    const el = doc.createElement(tag);
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const dialog = node('dialog', 'whats-new');
  const heading = node('h2', 'whats-new-heading', '這次更新了什麼');
  heading.id = 'whats-new-heading';
  dialog.setAttribute('aria-labelledby', heading.id);
  const date = node('time', 'whats-new-date', latest.date);
  date.dateTime = latest.date;
  const title = node('h3', 'whats-new-title', latest.title);
  const list = node('ul', 'whats-new-items');
  for (const item of latest.items) {
    const row = node('li', '');
    const scope = item.scope === '全站' ? '全站'
      : games.find((game) => game.code === item.scope)?.title ?? item.scope;
    row.append(node('span', 'changelog-label', scope),
      node('span', 'tag', item.kind), node('span', 'whats-new-text', item.text));
    list.append(row);
  }
  const foot = node('div', 'whats-new-foot');
  const link = node('a', 'btn', '看全部更新紀錄');
  link.href = 'changelog/';
  const button = node('button', 'btn', '知道了');
  button.type = 'button';
  button.autofocus = true;
  foot.append(link, button);
  dialog.append(heading, date, title, list, foot);

  let acknowledged = false;
  const acknowledge = () => {
    if (acknowledged) return;
    acknowledged = true;
    try { storage.setItem(SEEN_UPDATE_KEY, latestKey); } catch { /* 寫入失敗不阻擋關閉 */ }
  };
  const dismiss = () => {
    acknowledge();
    dialog.close();
  };
  button.addEventListener('click', dismiss);
  link.addEventListener('click', acknowledge); // PM 裁:點「看全部更新紀錄」也算看過,回大廳不再跳
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
  });
  dialog.addEventListener('close', () => {
    acknowledge();
    dialog.remove();
  });
  doc.body.append(dialog);
  dialog.showModal();
  return dialog;
}
