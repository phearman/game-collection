import { dailyScore, dailyDateLabel, dailyFinishedLater, dailyPracticeRequested, dailyResumeRequested } from '../../shared/daily.js?v=32c428b';
import { showDailyBanner, appendDailySummary as appendSharedSummary, appendResumeActions } from '../../shared/daily-ui.js?v=32c428b';

export { showDailyBanner };

// 共用分享連結,只補數獨秒數的計時說明。完成當下及重新進入都用相同文字。
export function appendDailySummary(doc, mount, daily) {
  const index = mount.children.length;
  appendSharedSummary(doc, mount, daily);
  if (daily?.row?.finished_at && !daily.row.cleared) {
    mount.children[index].textContent = `${dailyFinishedLater(daily.row) ? `${dailyDateLabel(daily.day)} 挑戰` : '今日挑戰'}成績(從開題起算,含離開時間):${dailyScore(daily.row)}`;
  }
}

export function showDailyClosed(doc, daily, error, actions = {}) {
  showDailyBanner(doc, daily, error);
  const wrap = doc.querySelector('.board-wrap'); wrap.hidden = true;
  const box = doc.createElement('section'); box.className = 'daily-summary';
  if (daily?.completed) appendDailySummary(doc, box, daily);
  appendResumeActions(doc, box, error, actions);
  // RS91:練習出錯(日期超出範圍、該日挑戰仍在收件)不是帳號問題 ⇒ 回大廳重選。IR74:接回往日那局出錯亦同。
  const search = globalThis.location?.search ?? '';
  const practice = daily?.practice || daily?.resumed || !!dailyPracticeRequested(search) || !!dailyResumeRequested(search);
  const link = doc.createElement('a'); link.className = 'btn';
  link.href = error ? practice ? '../../' : '../../me/' : './';
  link.textContent = error ? practice ? '回大廳' : '前往登入／檢查帳號' : '玩一般模式'; box.append(link); wrap.before(box);
}
