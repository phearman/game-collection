import { dailyScore } from '../../shared/daily.js?v=4577fc1';
import { showDailyBanner, appendDailySummary as appendSharedSummary } from '../../shared/daily-ui.js?v=4577fc1';

export { showDailyBanner };

// 共用分享連結,只補數獨秒數的計時說明。完成當下及重新進入都用相同文字。
export function appendDailySummary(doc, mount, daily) {
  const index = mount.children.length;
  appendSharedSummary(doc, mount, daily);
  if (daily?.row?.finished_at && !daily.row.cleared) {
    mount.children[index].textContent = `今日挑戰成績(從開題起算,含離開時間):${dailyScore(daily.row)}`;
  }
}

export function showDailyClosed(doc, daily, error) {
  showDailyBanner(doc, daily, error);
  const wrap = doc.querySelector('.board-wrap'); wrap.hidden = true;
  const box = doc.createElement('section'); box.className = 'daily-summary';
  if (daily?.completed) appendDailySummary(doc, box, daily);
  const link = doc.createElement('a'); link.className = 'btn'; link.href = error ? '../../me/' : './';
  link.textContent = error ? '前往登入／檢查帳號' : '玩一般模式'; box.append(link); wrap.before(box);
}
