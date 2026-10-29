import { DAILY_GRACE_HOURS, dailySlotDeadline } from './daily-slots.js?v=09d8276';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, cloudEnabled } from './supabase-config.js?v=09d8276';
import { formatDuration } from './duration.js?v=09d8276';

export const DAILY_GAMES = ['sudoku', 'minesweeper', 'memory'];
export const DAILY_NAMES = { wordle: 'Wordle', sudoku: '數獨', minesweeper: '踩地雷', memory: '翻翻樂' };
export const DAILY_LOGIN_NOTICE = '登入後才能參加每日挑戰';
export const DAILY_FIXED_NOTE = '遊戲固定、每天換題目';
// 與 SQL daily_public_eligible / daily_memory_rank_misses 同源；踩地雷、翻翻樂共用 20 秒門檻。
export const DAILY_FAST_GAME_MIN_SECONDS = 20;
export const taiwanDay = (stamp) => new Date(Number(stamp) + 8 * 3600000).toISOString().slice(0, 10);
export const dailyDateLabel = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export const dailyAbandonConfirm = (day) => `放棄 ${dailyDateLabel(day)} 的挑戰?這局不列入排行、之後也不能再交,但可以改練習這天的題目。`;
export { dailySlot, legacyDailySlot } from './daily-slots.js?v=09d8276';
// IR68:D 日開始的挑戰收到 D+1 台灣中午 12:00,仍計入 D 日。期限只由伺服器(SQL daily_deadline)判定;
// 這兩個常數是它的鏡像,只給文案與測試用,改期限時兩邊一起改。
export { DAILY_GRACE_HOURS };
export const dailyDeadline = dailySlotDeadline;
export const dailyNextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export const dailyExpiredText = (day) =>
  `${dailyDateLabel(day)} 的挑戰只接受到 ${dailyDateLabel(dailyNextDay(day))} 中午 12:00,這局不列入排行`;
// 局還開著時,那天的紀錄已被清除(或超過保留天數):同樣照一般局記錄,但⛔ 寫期限(期限未必已過)。
export const dailyGoneText = (day) => `${dailyDateLabel(day)} 的挑戰紀錄已清除,這局不列入排行`;
export const dailyAbandonedText = (day) => `${dailyDateLabel(day)} 的挑戰已放棄,這局不列入排行也不記錄`;
// 跨日完成:完成時間的台灣日晚於開始日 ⇒ 文案寫日期、⛔ 寫「今天」,也⛔ 連今日排行(那是另一天)。
export function dailyFinishedLater(row) {
  const stamp = Date.parse(row?.finished_at);
  return Number.isFinite(stamp) && typeof row?.day === 'string' && taiwanDay(stamp) > row.day;
}
// 送出每日成績:伺服器過了收件時間 ⇒ 回 { expired: 說明文字 },呼叫端照一般局結算(⛔ 給重試鈕);其餘錯誤照舊丟出。
export async function finishDailyOrExpire(client, daily, game, result, guesses, detail = {}) {
  try { return { row: await client.finish(game, daily.day, result, guesses, detail) }; }
  catch (error) {
    if (error?.code === 'DAILY_EXPIRED') return { expired: dailyExpiredText(daily.day) };
    if (error?.code === 'DAILY_GONE') return { expired: dailyGoneText(daily.day) };
    // IR74:往日那局已在別的分頁放棄(伺服器標記為已清除)⇒ 不能送也不能記成一般局(放棄時局號已清掉);
    // 呼叫端丟掉存檔、關閉這局,⛔ 進「重試送出」迴圈。今天的 DAILY_CLEARED 照舊。
    if (error?.code === 'DAILY_CLEARED' && (daily.resumed || daily.day < taiwanDay(Date.now())))
      throw Object.assign(new Error(dailyAbandonedText(daily.day)), { code: 'DAILY_ABANDONED' });
    throw error;
  }
}
// 結算 detail:被拒的局只帶 daily_expired(⛔ 帶 daily,不算連續每日成就),局號沿用開始時的 play_id。
export const dailyPlayDetail = (daily, expired) => daily.practice ? { practice: daily.day } : expired
  ? { daily_expired: daily.day, daily_play_id: daily.row.detail.play_id }
  : { daily: daily.day, daily_play_id: daily.row.detail.play_id };
export const dailyRequested = (search) => new URLSearchParams(search).get('daily') === '1';
// RS91:往日題目練習。網址 ?practice=YYYY-MM-DD;只收合法日期字串,其餘一律當一般模式。
export const practiceSlot = (game) => `${game}-practice`;
export const DAILY_PRACTICE_DAYS = 30;
export const DAILY_PRACTICE_NOTE = '練習:不計排行、不影響今日挑戰';
// RS91/IR74:那天自己的每日局還在收件中 ⇒ 不發練習題;頁面附「繼續那局/放棄那局」兩鈕解開死結。
export const DAILY_RESUME_NO_SAVE_TEXT = '找不到那局的續玩存檔,請回原本的裝置或分頁繼續;也可以放棄那局';
export const DAILY_PAST_OPEN_TEXT ='這天的挑戰你還沒完成、仍在收件中(收到隔天中午 12:00)。可以繼續那局,或放棄那局後改練習';
// D56(PM 裁 RS91 審查 #2):往日題目答案可查、可重玩 ⇒ 一律當輔助局(XP 打對折、不刷新最佳、不解遊戲專屬成就)。
export const PRACTICE_ASSIST_TEXT = '🧩 往日練習:不刷新最佳';
export function dailyPracticeRequested(search) { return dailyDayParam(search, 'practice'); }
// IR74:?resume=YYYY-MM-DD 接回自己那天還在收件期限內、未完成的每日局(跨日重新整理後的死結)。
export function dailyResumeRequested(search) { return dailyDayParam(search, 'resume'); }
function dailyDayParam(search, name) {
  const day = new URLSearchParams(search).get(name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null;
  const stamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day ? day : null;
}
// 可練習的日期:伺服器今天的前 1~30 天(新到舊)。今天與未來由伺服器拒發種子。
export function dailyPracticeDays(today, count = DAILY_PRACTICE_DAYS) {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(base - (i + 1) * 86400000).toISOString().slice(0, 10));
}
const WEEKDAYS = '日一二三四五六';
export const dailyDayOption = (day) => `${dailyDateLabel(day)}(${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;

export function dailyStatus(row) {
  if (row?.cleared) return '今天已清除 · 明天再挑戰';
  if (row?.finished_at) return `今天已完成 ✓ · ${dailyScore(row)}`;
  return row?.started_at ? '繼續' : '開始';
}
export function dailyScore(row) {
  if (row.game_id === 'memory') return `失誤 ${row.detail.misses} 次 · ${formatDuration(row.seconds)}`;
  return row.game_id === 'wordle'
    ? `${row.result === 'win' ? row.guesses : 'X'}/6 · ${formatDuration(row.seconds)}`
    : `${row.game_id === 'minesweeper' && row.result === 'lose' ? '💥 踩雷 · ' : ''}${formatDuration(row.seconds)}`;
}
export function dailyShare(day, game, row, marks = []) {
  const squares = { correct: '🟩', present: '🟨', absent: '⬜' };
  const score = game === 'wordle' ? `${row.result === 'win' ? row.guesses : 'X'}/6`
    : game === 'memory' ? dailyScore(row)
    : game === 'minesweeper' && row.result === 'lose' ? '💥' : formatDuration(row.seconds);
  return `遊戲集錦 ${dailyDateLabel(day)} ${DAILY_NAMES[game]} ${score}`
    + (game === 'wordle' ? `\n${(Array.isArray(marks) ? marks : []).filter(Array.isArray).slice(0, 6)
      .map((m) => m.slice(0, 5).map((c) => squares[c] ?? '⬜').join('')).join('\n')}` : '');
}
export function dailyRank(rows, game) {
  return rows.filter((r) => r.game_id === game && r.finished_at && !r.cleared
    && (game === 'wordle' || (r.result === 'win' && r.seconds >= (['minesweeper', 'memory'].includes(game) ? DAILY_FAST_GAME_MIN_SECONDS : 60))))
    .filter((r) => game !== 'memory' || (Number.isInteger(r.detail?.misses) && r.detail.misses >= 0))
    .sort((a, b) => game === 'wordle'
      ? Number(b.result === 'win') - Number(a.result === 'win')
        || (a.result === 'win' && b.result === 'win' ? a.guesses - b.guesses : 0) || a.seconds - b.seconds
      : (game === 'memory' ? a.detail.misses - b.detail.misses : 0) || a.seconds - b.seconds
        || (game === 'memory' ? Date.parse(a.finished_at) - Date.parse(b.finished_at) : 0)).slice(0, 5);
}

export function createDailyClient({ auth, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY,
  fetch: request = globalThis.fetch } = {}) {
  let epoch = 0;
  let identity = auth?.session?.user.id;
  const identityListeners = new Set();
  const unsubscribe = auth?.subscribe(() => {
    if (identity !== auth.session?.user.id) {
      identity = auth.session?.user.id; epoch++;
      for (const listener of identityListeners) listener();
    }
  });
  async function requestDaily(path, body) {
    const owner = auth?.session?.user.id;
    const version = epoch;
    const check = () => {
      if (owner !== auth?.session?.user.id || version !== epoch) throw new Error('帳號已變更，請重新整理');
    };
    if (!owner || !url || !key) throw new Error(DAILY_LOGIN_NOTICE);
    const token = await auth.accessToken(); check();
    if (!token) throw new Error(DAILY_LOGIN_NOTICE);
    let response;
    try {
      response = await request(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000), referrerPolicy: 'no-referrer',
      });
    } catch { check(); throw new Error('每日挑戰連線失敗，請稍後重試'); }
    check();
    const data = await response.json(); check();
    if (!response.ok) throw Object.assign(new Error(data?.message === 'DAILY_EXPIRED'
      ? '這局已超過每日挑戰的收件時間,不列入排行' : data?.message === 'DAILY_GONE'
        ? '這天的挑戰紀錄已清除,這局不列入排行' : data?.message === 'DAILY_CLEARED'
        ? '今天的挑戰紀錄已清除，請明天再挑戰' : data?.message === 'DAILY_PAST_RANGE'
          ? `只能練習最近 ${DAILY_PRACTICE_DAYS} 天(不含今天)的題目` : data?.message === 'DAILY_PAST_OPEN'
            ? DAILY_PAST_OPEN_TEXT : data?.message === 'DAILY_RESUME_DENIED'
              ? '那局已完成、已放棄或已過收件時間,不能再接回' : '每日挑戰暫時無法使用，請稍後重試'),
    { code: ['DAILY_EXPIRED', 'DAILY_GONE', 'DAILY_CLEARED', 'DAILY_PAST_RANGE', 'DAILY_PAST_OPEN', 'DAILY_RESUME_DENIED'].includes(data?.message) ? data.message : undefined });
    return data;
  }
  const call = (name, body = {}) => requestDaily(`rpc/${name}`, body);
  const gameCall = (name, game) => {
    if (!DAILY_GAMES.includes(game)) throw new Error('不支援的每日遊戲');
    return call(name, { p_game: game });
  };
  return {
    get userId() { return auth?.session?.user.id; },
    onIdentityChange(listener) { identityListeners.add(listener); return () => identityListeners.delete(listener); },
    seed: (game) => gameCall('daily_seed', game),
    start: (game) => gameCall('start_daily', game),
    today: () => call('my_daily_today'),
    // IR76:daily_results_self RLS 只准本人 select;started_at 為 NOT NULL,有列即已開始。
    openPast: (day) => requestDaily(`daily_results?${new URLSearchParams({
      select: 'game_id,day', day: `eq.${day}`, finished_at: 'is.null', cleared: 'is.false',
    })}`),
    pastSeed: (game, day) => {
      if (!DAILY_GAMES.includes(game)) throw new Error('不支援的每日遊戲');
      return call('daily_past_seed', { p_game: game, p_day: day });
    },
    // IR74:伺服器只對本人、往日、未完成、未放棄且仍在收件期限內的那列發種子/標記放棄。
    resume: (game, day) => {
      if (!DAILY_GAMES.includes(game)) throw new Error('不支援的每日遊戲');
      return call('daily_resume_seed', { p_game: game, p_day: day });
    },
    abandon: (game, day) => {
      if (!DAILY_GAMES.includes(game)) throw new Error('不支援的每日遊戲');
      return call('abandon_daily', { p_game: game, p_day: day });
    },
    finish: (game, day, result, guesses, detail = {}) => call('finish_daily', {
      p_game: game, p_result: result, p_guesses: guesses, p_detail: { ...detail, daily: day },
    }),
    dispose: () => { unsubscribe?.(); identityListeners.clear(); },
  };
}
export async function browserDailyClient() {
  if (!cloudEnabled) return createDailyClient();
  const { auth } = await (await import('./auth.js?v=09d8276')).getCloudRuntime();
  return createDailyClient({ auth });
}

// The server day is authoritative. Completed rows never generate another puzzle.
export async function prepareDaily(client, game) {
  const previous = game === 'memory' ? await client.today() : null;
  const seed = await client.seed(game);
  const row = await client.start(game);
  if (row.day !== seed.day) throw new Error('挑戰已換日，請重新整理');
  return { day: seed.day, seed: seed.seed, row, completed: !!row.finished_at || !!row.cleared,
    ...(game === 'memory' ? { resumeRequired: previous?.day === seed.day
      && previous.results.some((r) => r.game_id === game && r.started_at) } : {}) };
}
// RS91:練習只拿往日種子,⛔ 呼叫 start_daily(不影響今日一天一次、不建每日成績列)。
export async function preparePractice(client, game, day) {
  const seed = await client.pastSeed(game, day);
  if (seed.day !== day) throw new Error('練習題目日期不符,請重新整理');
  return { day, seed: seed.seed, row: null, completed: false, practice: true };
}
// IR74:接回往日那局 = 那天的每日局(⛔ 練習):使用 {game}-daily-{day} 存檔槽與開始時的 play_id,結算照常走
// finish_daily(伺服器以那列的日期計)。翻翻樂比照 PM 裁定:開過題卻找不到同日存檔就不重新發牌。
export async function prepareResume(client, game, day) {
  const resumed = await client.resume(game, day);
  if (resumed.day !== day || resumed.row?.day !== day) throw new Error('接回的挑戰日期不符,請重新整理');
  return { day, seed: resumed.seed, row: resumed.row, completed: false, resumed: true,
    ...(game === 'memory' ? { resumeRequired: true } : {}) };
}
export function matchesDailySave(saved, daily, valid) {
  return !daily.row?.cleared && !!saved && saved.daily === daily.day && saved.daily_seed === daily.seed && valid(saved);
}

// RS91:大廳「重玩往日題目」:選日期(伺服器今天的前 1~30 天)+三款遊戲按鈕,連到 ?practice=日期。
export function mountDailyPractice(doc, today) {
  const practice = doc.getElementById('daily-practice');
  if (practice?.tagName !== 'DETAILS') return;
  const select = doc.getElementById('daily-practice-day');
  const games = doc.getElementById('daily-practice-games');
  const previous = select.value;
  select.replaceChildren();
  for (const day of dailyPracticeDays(today)) {
    const option = doc.createElement('option'); option.value = day; option.textContent = dailyDayOption(day); select.append(option);
  }
  if (dailyPracticeDays(today).includes(previous)) select.value = previous;
  const draw = () => {
    games.replaceChildren();
    for (const game of DAILY_GAMES) {
      const link = doc.createElement('a'); link.className = 'btn';
      link.href = `games/${game}/?practice=${select.value}`; link.textContent = DAILY_NAMES[game];
      games.append(link);
    }
  };
  select.onchange = draw; draw();
  practice.hidden = false;
}
export async function mountDailyLobby(doc, client, createClient = browserDailyClient,
  { now = Date.now, confirm = globalThis.confirm,
    setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout } = {}) {
  const list = doc.getElementById('daily-games');
  const message = doc.getElementById('daily-message');
  const openPast = doc.getElementById('daily-open-past');
  let version = 0;
  let identitySubscribed = false, deadlineTimer;
  // 以身分/遊戲/日期保存請求狀態,重繪後的新入口仍共用同一筆進行中的放棄。
  const pendingAbandons = new Set();
  const visibleActions = new Map();
  const hideOpenPast = () => { if (openPast) { openPast.hidden = true; openPast.replaceChildren(); } };
  const render = async () => {
    const rendering = ++version;
    clearTimeout(deadlineTimer); deadlineTimer = undefined;
    visibleActions.clear();
    hideOpenPast();
    list.replaceChildren();
    try {
      client ??= await createClient();
      if (!identitySubscribed) {
        client.onIdentityChange?.(() => { void render(); });
        identitySubscribed = true;
      }
      const owner = client.userId;
      const current = () => rendering === version && owner === client.userId;
      const today = await client.today();
      if (!current()) return;
      message.textContent = `📅 ${dailyDateLabel(today.day)} 挑戰 · 每人每款一天一次`;
      for (const game of DAILY_GAMES) {
        const row = today.results.find((r) => r.game_id === game);
        const link = doc.createElement('a'); link.className = 'btn';
        link.href = `games/${game}/?daily=1`;
        link.textContent = `${DAILY_NAMES[game]} · ${dailyStatus(row)}`;
        list.append(link);
      }
      mountDailyPractice(doc, today.day);
      const yesterday = dailyPracticeDays(today.day, 1)[0];
      if (!openPast || now() >= dailyDeadline(yesterday)) return;
      // 提示是額外唯讀查詢;失敗不能影響今日按鈕與往日練習。
      let rows;
      try { rows = await client.openPast(yesterday); } catch { return; }
      if (!current() || now() >= dailyDeadline(yesterday) || !Array.isArray(rows)) return;
      for (const game of DAILY_GAMES) {
        if (!rows.some((row) => row.game_id === game && row.day === yesterday)) continue;
        const row = doc.createElement('div'); row.className = 'daily-open-past-row';
        const text = doc.createElement('p');
        text.textContent = `⏳ ${dailyDateLabel(yesterday)} 的${DAILY_NAMES[game]}挑戰還沒完成,收到今天中午 12:00`;
        const actions = doc.createElement('div'); actions.className = 'daily-games';
        const resume = doc.createElement('a'); resume.className = 'btn';
        resume.href = `games/${game}/?resume=${yesterday}`; resume.textContent = '繼續那局';
        const abandon = doc.createElement('button'); abandon.type = 'button'; abandon.className = 'btn';
        abandon.textContent = '放棄那局';
        const note = doc.createElement('p'); note.hidden = true; note.setAttribute('role', 'status');
        const operation = JSON.stringify([owner, game, yesterday]);
        const updateActions = (failure) => {
          if (!current()) return;
          const pending = pendingAbandons.has(operation);
          abandon.disabled = pending; resume.setAttribute('aria-disabled', String(pending)); resume.tabIndex = pending ? -1 : 0;
          note.hidden = !failure;
          if (failure) note.textContent = failure.message;
        };
        visibleActions.set(operation, updateActions); updateActions();
        resume.onclick = (event) => { if (abandon.disabled) event.preventDefault(); };
        abandon.onclick = async () => {
          if (!current() || pendingAbandons.has(operation) || !confirm(dailyAbandonConfirm(yesterday))) return;
          pendingAbandons.add(operation); updateActions();
          try {
            await client.abandon(game, yesterday);
            pendingAbandons.delete(operation);
            if (owner === client.userId) await render();
          }
          catch (failure) {
            pendingAbandons.delete(operation);
            if (owner === client.userId) visibleActions.get(operation)?.(failure);
          }
        };
        actions.append(resume, abandon); row.append(text, actions, note); openPast.append(row);
      }
      openPast.hidden = openPast.children.length === 0;
      if (!openPast.hidden) {
        deadlineTimer = setTimeout(() => {
          if (!current()) return;
          ++version; hideOpenPast(); visibleActions.clear(); deadlineTimer = undefined;
        }, Math.max(0, dailyDeadline(yesterday) - now()));
        deadlineTimer?.unref?.();
      }
    } catch {
      if (rendering !== version) return;
      hideOpenPast();
      const practice = doc.getElementById('daily-practice');
      if (practice?.tagName === 'DETAILS') practice.hidden = true;
      message.textContent = DAILY_LOGIN_NOTICE;
      const login = doc.createElement('a'); login.className = 'btn'; login.href = 'me/'; login.textContent = '前往登入'; list.append(login);
    }
  };
  await render();
  globalThis.window?.addEventListener('pageshow', render);
  globalThis.document?.addEventListener('visibilitychange', () => { if (!doc.hidden) void render(); });
}
