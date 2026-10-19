// 完成時間顯示(RS75):未滿 1 分「45 秒」、未滿 1 時「9 分 03 秒」、滿 1 時「1 時 02 分 03 秒」。
// 只管顯示;存值與排序仍用秒數。line-webhook 有一份相同的副本(edge 端無法匯入 shared/),測試鎖住兩邊輸出一致。
export function formatDuration(seconds) {
  const value = Number(seconds);
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; // Infinity、NaN 等異常值一律當 0
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h) return `${h} 時 ${pad(m)} 分 ${pad(s)} 秒`;
  if (m) return `${m} 分 ${pad(s)} 秒`;
  return `${s} 秒`;
}
