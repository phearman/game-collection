// RS7 線條圖示:網站畫面用 shared/icons/*.svg(CSS 遮罩,樣式在 icons.css)。
// LINE 與純文字處(成就提示、我的紀錄表格)仍用 games.js / progress.js 的 emoji。
// ⛔ innerHTML:圖示是一個空 <span class="gi gi-{id}">,外框 <span class="… cat-{分類}"> 給顏色。
import { GAMES } from './games.js?v=c687ae3e';

// 成就 id → 圖示 id;遊戲專屬成就沿用該遊戲圖示與分類色,通用成就用金色(badge)。
export const ACH_ICON = {
  first_play: 'ach-flag', first_win: 'ach-trophy', games_3: 'ach-dice', games_6: 'ach-six',
  streak_3: 'ach-flame', streak_7: 'ach-calendar', daily_7: 'ach-daily', hours_5: 'ach-hourglass', plays_100: 'ach-stack',
  tile_2048: '2048', mines_expert: 'minesweeper', memory_expert: 'memory', reversi_expert: 'reversi',
  archery_bullseye_3: 'archery', peg_genius: 'peg', wordle_2: 'wordle', ttt_10: 'tictactoe', bridge_perfect_5: 'bridge',
};

const categoryOf = (icon) => GAMES.find((g) => g.id === icon)?.category ?? 'badge';

export function achIcon(id) {
  const icon = ACH_ICON[id] ?? 'ach-trophy';
  return { icon, cat: categoryOf(icon) };
}

// doc.createElement 建一個圖示 <span>;cls 給外框(如 card-icon),cat 決定顏色。
export function iconEl(doc, icon, { cls = '', cat } = {}) {
  const box = doc.createElement('span');
  box.className = [cls, cat ? `cat-${cat}` : ''].filter(Boolean).join(' ');
  const glyph = doc.createElement('span');
  glyph.className = `gi gi-${icon}`;
  box.append(glyph);
  box.setAttribute('aria-hidden', 'true');
  return box;
}
