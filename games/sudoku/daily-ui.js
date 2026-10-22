import { dailyScore, dailyDateLabel, dailyFinishedLater, dailyPracticeRequested } from '../../shared/daily.js?v=6053a51';
import { showDailyBanner, appendDailySummary as appendSharedSummary } from '../../shared/daily-ui.js?v=6053a51';

export { showDailyBanner };

// 共用分享連結,只補數獨秒數的計時說明。完成當下及重新進入都用相同文字。
export function appendDailySummary(doc, mount, daily) {
  const index = mount.children.length;
  appendSharedSummary(doc, mount, daily);
  if (daily?.row?.finished_at && !daily.row.cleared) {
    mount.children[index].textContent = `${dailyFinishedLater(daily.row) ? `${dailyDateLabel(daily.day)} 挑戰` : '今日挑戰'}成績(從開題起算,含離開時間):${dailyScore(daily.row)}`;
  }
}

export function showDailyClosed(doc, daily, error) {
  showDailyBanner(doc, daily, error);
  const wrap = doc.querySelector('.board-wrap'); wrap.hidden = true;
  const box = doc.createElement('section'); box.className = 'daily-summary';
  if (daily?.completed) appendDailySummary(doc, box, daily);
  // RS91:練習出錯(日期超出範圍、該日挑戰仍在收件)不是帳號問題 ⇒ 回大廳重選。
  const practice = daily?.practice || !!dailyPracticeRequested(globalThis.location?.search ?? '');
  const link = doc.createElement('a'); link.className = 'btn';
  link.href = error ? practice ? '../../' : '../../me/' : './';
  link.textContent = error ? practice ? '回大廳' : '前往登入／檢查帳號' : '玩一般模式'; box.append(link); wrap.before(box);
}
