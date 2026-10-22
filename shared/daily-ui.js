import { dailyDateLabel, dailyScore, dailyShare, dailyFinishedLater, DAILY_LOGIN_NOTICE, DAILY_FIXED_NOTE, DAILY_PRACTICE_NOTE, dailyPracticeRequested } from './daily.js?v=6053a51';

export function showDailyBanner(doc, daily, error) {
  const banner = doc.getElementById('daily-banner');
  banner.hidden = false;
  banner.textContent = error || (daily?.practice ? `📅 ${dailyDateLabel(daily.day)} 題目練習` : daily ? `📅 ${dailyDateLabel(daily.day)} 挑戰`
    + (daily.row?.cleared ? ' · 今天已清除 · 明天再挑戰'
      : daily.completed ? ` · ${dailyFinishedLater(daily.row) ? '' : '今天'}已完成 ✓ · ${dailyScore(daily.row)}` : '') : DAILY_LOGIN_NOTICE);
  // RS73:說明每日挑戰固定這幾款、只換題目;沒有每日盤(未登入/錯誤)時不顯示。
  const note = doc.getElementById('daily-note');
  // RS91:練習模式改說明「不計排行、不影響今日挑戰」。
  if (note) { note.textContent = daily?.practice ? DAILY_PRACTICE_NOTE : DAILY_FIXED_NOTE; note.hidden = !daily || !!error; }
}
export function appendDailySummary(doc, mount, daily, marks = []) {
  if (!daily?.row?.finished_at || daily.row.cleared) return;
  const later = dailyFinishedLater(daily.row); // IR68:跨日完成,成績算在開始那天
  const p = doc.createElement('p'); p.textContent = `你${later ? ` ${dailyDateLabel(daily.day)} ` : '今天'}的成績：${dailyScore(daily.row)}`
    + (['minesweeper', 'memory'].includes(daily.row.game_id) ? '（從開題起算,含離開時間）' : ''); mount.append(p);
  const share = doc.createElement('a'); share.className = 'btn'; share.textContent = '分享到 LINE';
  share.href = `https://line.me/R/msg/text/?${encodeURIComponent(dailyShare(daily.day, daily.row.game_id, daily.row, marks))}`;
  share.target = '_blank'; share.rel = 'noopener noreferrer'; mount.append(share);
  // RS78:結算卡加「看今日排行」(遊戲頁在 games/{id}/,排行頁在網站根目錄下 daily-rank/)。
  // 跨日完成時今日排行是另一天,⛔ 顯示(往日排行目前沒有頁面)。
  if (later) return;
  const rank = doc.createElement('a'); rank.className = 'btn'; rank.textContent = '🏆 看今日排行';
  rank.href = '../../daily-rank/'; mount.append(rank);
}
export function showDailyClosed(doc, daily, error) {
  showDailyBanner(doc, daily, error);
  const wrap = doc.querySelector('.board-wrap'); wrap.hidden = true;
  const box = doc.createElement('section'); box.className = 'daily-summary';
  if (daily?.completed) appendDailySummary(doc, box, daily, daily.row.detail?.marks ?? []);
  // RS91:練習出錯(日期超出範圍、該日挑戰仍在收件)不是帳號問題 ⇒ 回大廳重選。
  const practice = daily?.practice || !!dailyPracticeRequested(globalThis.location?.search ?? '');
  const link = doc.createElement('a'); link.className = 'btn';
  link.href = error ? practice ? '../../' : '../../me/' : './';
  link.textContent = error ? practice ? '回大廳' : '前往登入／檢查帳號' : '玩一般模式'; box.append(link); wrap.before(box);
}
