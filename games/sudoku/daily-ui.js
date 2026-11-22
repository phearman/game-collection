import { dailyScore, dailyDateLabel, dailyFinishedLater, dailyPracticeRequested, dailyResumeRequested } from '../../shared/daily.js?v=5ccf94d7';
import { showDailyBanner, appendDailySummary as appendSharedSummary, appendResumeActions } from '../../shared/daily-ui.js?v=5ccf94d7';

export { showDailyBanner };

// 共用分享連結,只補數獨秒數的計時說明。完成當下及重新進入都用相同文字。
export function appendDailySummary(doc, mount, daily) {
  const index = mount.children.length;
  appendSharedSummary(doc, mount, daily);
  if (daily?.row?.finished_at && !daily.row.cleared) {
    mount.children[index].textContent = `${dailyFinishedLater(daily.row) ? `${dailyDateLabel(daily.day)} 挑戰` : '今日挑戰'}成績(從開題起算,含離開時間):${dailyScore(daily.row)}`;
  }
}

export const DAILY_START_GATE_TEXT = '按下開始才計時,計時從開始那一刻起算,離開頁面也照算。每人一天一次。';

// IR118 R1~R3:今天還沒開過 ⇒ 只顯示說明與「▶ 開始今日挑戰」;按下才呼叫 start(由 start 回呼),成功才收起閘門、顯示盤面。
// 送出中停用防連點;失敗照現行錯誤橫幅,可再按。
export function showDailyStartGate(doc, day, start) {
  // r1(PM):整列 .actions(今日挑戰/新遊戲/復原/難度)閘門期間也藏,開始成功才顯示。
  const hide = [doc.querySelector('.board-wrap'), doc.getElementById('number-pad'), doc.querySelector('.tools'), doc.querySelector('.actions'),
    doc.querySelector('.assist-tools'), doc.getElementById('hint')].filter(Boolean);
  for (const el of hide) el.hidden = true;
  showDailyBanner(doc, { day, completed: false }, '');
  const box = doc.createElement('section'); box.className = 'daily-summary daily-start';
  const text = doc.createElement('p'); text.textContent = DAILY_START_GATE_TEXT; box.append(text);
  const button = doc.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = '▶ 開始今日挑戰';
  box.append(button);
  const link = doc.createElement('a'); link.className = 'btn'; link.href = './'; link.textContent = '玩一般模式'; box.append(link);
  (hide[0] ?? doc.getElementById('board-wrap')).before(box);
  return new Promise((resolve) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const daily = await start();
        box.hidden = true;
        for (const el of hide) el.hidden = false;
        resolve(daily);
      } catch (error) {
        showDailyBanner(doc, null, error.message);
        button.disabled = false;
      }
    });
  });
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
