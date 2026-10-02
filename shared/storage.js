// localStorage 可能不可用(隱私模式、封鎖網站資料),讀寫失敗時遊戲照常可玩。
const PREFIX = 'game-collection:';

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 寫不進去就算了
  }
}

export function getBest(game) {
  return Number(load(`best:${game}`, 0)) || 0;
}

export function updateBest(game, score) {
  const best = getBest(game);
  if (score > best) {
    save(`best:${game}`, score);
    return score;
  }
  return best;
}
