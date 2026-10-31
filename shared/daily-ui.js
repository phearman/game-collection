import { DAILY_ASSISTED_TEXT, dailyDateLabel, dailyScore, dailyShare, dailyFinishedLater, dailyAbandonConfirm, DAILY_LOGIN_NOTICE, DAILY_FIXED_NOTE, DAILY_PRACTICE_NOTE, dailyPracticeRequested, dailyResumeRequested, DAILY_PAST_OPEN_TEXT, DAILY_RESUME_NO_SAVE_TEXT } from './daily.js?v=4a61272';

// IR74:往日練習被「那天的每日局還在收件中」擋下 ⇒ 給「繼續那局」與「放棄那局」;翻翻樂接回時找不到原存檔
// ⇒ 只給「放棄那局」(其他接回錯誤如已過期、網路、未登入不給)。放棄由伺服器標記(不列排行、不能再交),
// 成功後直接改開那天的練習。回傳是否加了按鈕(供測試)。
export function appendResumeActions(doc, box, error, { game, client, confirm = globalThis.confirm, go = (href) => { globalThis.location.href = href; } } = {}) {
  const search = globalThis.location?.search ?? '';
  const practiceDay = dailyPracticeRequested(search), resumeDay = dailyResumeRequested(search);
  const day = practiceDay ?? resumeDay;
  if (!day || !game || error !== (practiceDay ? DAILY_PAST_OPEN_TEXT : DAILY_RESUME_NO_SAVE_TEXT)) return false;
  if (practiceDay) {
    const resume = doc.createElement('a'); resume.className = 'btn'; resume.href = `./?resume=${day}`;
    resume.textContent = '繼續那局'; box.append(resume);
  }
  if (!client) return !!practiceDay;
  const abandon = doc.createElement('button'); abandon.type = 'button'; abandon.className = 'btn';
  abandon.textContent = '放棄那局'; box.append(abandon);
  const note = doc.createElement('p'); note.hidden = true; box.append(note);
  abandon.onclick = async () => {
    if (!confirm(dailyAbandonConfirm(day))) return;
    abandon.disabled = true;
    try { await client.abandon(game, day); go(`./?practice=${day}`); }
    catch (failure) { note.textContent = failure.message; note.hidden = false; abandon.disabled = false; }
  };
  return true;
}

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
  if (daily.row.detail?.assisted === true) { // RS108
    const note = doc.createElement('p'); note.textContent = DAILY_ASSISTED_TEXT; mount.append(note);
  }
  const share = doc.createElement('a'); share.className = 'btn'; share.textContent = '分享到 LINE';
  share.href = `https://line.me/R/msg/text/?${encodeURIComponent(dailyShare(daily.day, daily.row.game_id, daily.row, marks))}`;
  share.target = '_blank'; share.rel = 'noopener noreferrer'; mount.append(share);
  // RS78:結算卡加「看今日排行」(遊戲頁在 games/{id}/,排行頁在網站根目錄下 daily-rank/)。
  // 跨日完成時今日排行是另一天,⛔ 顯示(往日排行目前沒有頁面)。
  if (later) return;
  const rank = doc.createElement('a'); rank.className = 'btn'; rank.textContent = '🏆 看今日排行';
  rank.href = '../../daily-rank/'; mount.append(rank);
}
export function showDailyClosed(doc, daily, error, actions = {}) {
  showDailyBanner(doc, daily, error);
  const wrap = doc.querySelector('.board-wrap'); wrap.hidden = true;
  const box = doc.createElement('section'); box.className = 'daily-summary';
  if (daily?.completed) appendDailySummary(doc, box, daily, daily.row.detail?.marks ?? []);
  appendResumeActions(doc, box, error, actions);
  // RS91:練習出錯(日期超出範圍、該日挑戰仍在收件)不是帳號問題 ⇒ 回大廳重選。IR74:接回往日那局出錯亦同。
  const search = globalThis.location?.search ?? '';
  const practice = daily?.practice || daily?.resumed || !!dailyPracticeRequested(search) || !!dailyResumeRequested(search);
  const link = doc.createElement('a'); link.className = 'btn';
  link.href = error ? practice ? '../../' : '../../me/' : './';
  link.textContent = error ? practice ? '回大廳' : '前往登入／檢查帳號' : '玩一般模式'; box.append(link); wrap.before(box);
}
