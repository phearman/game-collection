// 結算遮罩的 XP 明細(RS5):各遊戲 ui.js 在「本局 +N XP」下一行呼叫 xpBreakdownHtml(ended.xpBreakdown)。
// 明細由 progress.js 的 xpBreakdown 產生(加總 = 本局 XP);後面接「XP 怎麼算?」連到 /me/#xp。

const ME_XP = '../../me/#xp';

// 明細金額帶正負號(輔助局的「輔助 ×0.5」為負)。
export const signedXp = (xp) => (xp < 0 ? `−${-xp}` : `+${xp}`);

export function xpBreakdownText(breakdown) {
  if (!breakdown) return '';
  if (breakdown.items.length === 0) return '放棄的局不計 XP';
  return breakdown.items.map((it) => `${it.label} ${signedXp(it.xp)}`).join(' · ');
}

export function xpBreakdownHtml(breakdown) {
  const text = xpBreakdownText(breakdown);
  if (!text) return '';
  return `<p class="overlay-xp-detail">${text} <a href="${ME_XP}">XP 怎麼算?</a></p>`;
}

// /me/「XP 怎麼算?」的三個範例(RS5 §2.4)。數字一律由 xpBreakdown 實算,測試核對 10 / 30 / 135。
export const XP_EXAMPLES = [
  { title: 'G1 2048 一般難度,沒合出 2048 就結束、沒破紀錄、不是當天第一局',
    args: { result: 'lose', difficulty: 'normal', isBest: false, dailyFirst: false, newAchievements: 0 } },
  { title: 'G7 下樓梯困難,刷新最佳(這款沒有勝利)、不是當天第一局',
    args: { result: 'lose', difficulty: 'hard', isBest: true, dailyFirst: false, newAchievements: 0 } },
  { title: 'G1 2048 當天第一局就合出 2048 並刷新最佳,同時解開「首局」「首勝」「合出 2048」三個成就',
    args: { result: 'win', difficulty: 'normal', isBest: true, dailyFirst: true, newAchievements: 3 } },
];

// 以 DOM 元素組出同一段明細(給用 createElement 組遮罩的遊戲;不用 innerHTML)。
export function appendXpBreakdown(container, breakdown, doc = globalThis.document) {
  const text = xpBreakdownText(breakdown);
  if (!text) return;
  const p = doc.createElement('p');
  p.className = 'overlay-xp-detail';
  p.textContent = `${text} `;
  const a = doc.createElement('a');
  a.href = ME_XP;
  a.textContent = 'XP 怎麼算?';
  p.append(a);
  container.append(p);
}

// 結算遮罩「最佳」那一行(IR7)。→ 文字;'' = 不顯示。
// 先前最佳為 0(第一次玩或從未得分)⇒ 不顯示;本局即新最佳 ⇒ 只顯示 🎉;追平 ⇒「已追平」;落後 ⇒「距最佳 N 還差 M」。
// 輔助局不刷新最佳,所以不顯示新最佳;超過先前最佳也不顯示(遮罩另有「不刷新最佳」那行)。
// noun / unit:各款用語(下樓梯 =「紀錄」「 層」);unit 直接接「還差」,預設一個空白。
export function bestLine({ isBest, bestBefore, score, assist = false, noun = '分數', unit = ' ' }) {
  if (isBest && !assist) return `🎉 新的最佳${noun}!`;
  if (!(bestBefore > 0) || score > bestBefore) return '';
  if (score === bestBefore) return `已追平最佳${noun}!`;
  return `距最佳 ${bestBefore.toLocaleString()}${unit}還差 ${(bestBefore - score).toLocaleString()}`;
}

// HTML 版:包成 <p>;不顯示時回 ''。
export const bestLineHtml = (args) => {
  const text = bestLine(args);
  return text ? `<p>${text}</p>` : '';
};
