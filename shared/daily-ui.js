import { dailyDateLabel, dailyScore, dailyShare, DAILY_LOGIN_NOTICE } from './daily.js?v=795425d';

export function showDailyBanner(doc, daily, error) {
  const banner = doc.getElementById('daily-banner');
  banner.hidden = false;
  banner.textContent = error || (daily ? `📅 ${dailyDateLabel(daily.day)} 挑戰`
    + (daily.row?.cleared ? ' · 今天已清除 · 明天再挑戰'
      : daily.completed ? ` · 今天已完成 ✓ · ${dailyScore(daily.row)}` : '') : DAILY_LOGIN_NOTICE);
}
export function appendDailySummary(doc, mount, daily, marks = []) {
  if (!daily?.row?.finished_at || daily.row.cleared) return;
  const p = doc.createElement('p'); p.textContent = `你今天的成績：${dailyScore(daily.row)}`; mount.append(p);
  const share = doc.createElement('a'); share.className = 'btn'; share.textContent = '分享到 LINE';
  share.href = `https://line.me/R/msg/text/?${encodeURIComponent(dailyShare(daily.day, daily.row.game_id, daily.row, marks))}`;
  share.target = '_blank'; share.rel = 'noopener noreferrer'; mount.append(share);
}
export function showDailyClosed(doc, daily, error) {
  showDailyBanner(doc, daily, error);
  const wrap = doc.querySelector('.board-wrap'); wrap.hidden = true;
  const box = doc.createElement('section'); box.className = 'daily-summary';
  if (daily?.completed) appendDailySummary(doc, box, daily, daily.row.detail?.marks ?? []);
  const link = doc.createElement('a'); link.className = 'btn'; link.href = error ? '../../me/' : './';
  link.textContent = error ? '前往登入／檢查帳號' : '玩一般模式'; box.append(link); wrap.before(box);
}
