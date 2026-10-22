import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, cloudEnabled } from './supabase-config.js?v=6053a51';
import { formatDuration } from './duration.js?v=6053a51';

export const DAILY_GAMES = ['sudoku', 'minesweeper', 'memory'];
export const DAILY_NAMES = { wordle: 'Wordle', sudoku: '數獨', minesweeper: '踩地雷', memory: '翻翻樂' };
export const DAILY_LOGIN_NOTICE = '登入後才能參加每日挑戰';
export const DAILY_FIXED_NOTE = '遊戲固定、每天換題目';
// 與 SQL daily_public_eligible / daily_memory_rank_misses 同源；踩地雷、翻翻樂共用 20 秒門檻。
export const DAILY_FAST_GAME_MIN_SECONDS = 20;
export const taiwanDay = (stamp) => new Date(Number(stamp) + 8 * 3600000).toISOString().slice(0, 10);
export const dailyDateLabel = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export const dailySlot = (game) => `${game}-daily`;
// IR68:D 日開始的挑戰收到 D+1 台灣中午 12:00,仍計入 D 日。期限只由伺服器(SQL daily_deadline)判定;
// 這兩個常數是它的鏡像,只給文案與測試用,改期限時兩邊一起改。
export const DAILY_GRACE_HOURS = 36;
export const dailyDeadline = (day) => Date.parse(`${day}T00:00:00+08:00`) + DAILY_GRACE_HOURS * 3600000;
export const dailyNextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export const dailyExpiredText = (day) =>
  `${dailyDateLabel(day)} 的挑戰只接受到 ${dailyDateLabel(dailyNextDay(day))} 中午 12:00,這局不列入排行`;
// 局還開著時,那天的紀錄已被清除(或超過保留天數):同樣照一般局記錄,但⛔ 寫期限(期限未必已過)。
export const dailyGoneText = (day) => `${dailyDateLabel(day)} 的挑戰紀錄已清除,這局不列入排行`;
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
// D56(PM 裁 RS91 審查 #2):往日題目答案可查、可重玩 ⇒ 一律當輔助局(XP 打對折、不刷新最佳、不解遊戲專屬成就)。
export const PRACTICE_ASSIST_TEXT = '🧩 往日練習:不刷新最佳';
export function dailyPracticeRequested(search) {
  const day = new URLSearchParams(search).get('practice');
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
  const unsubscribe = auth?.subscribe(() => {
    if (identity !== auth.session?.user.id) { identity = auth.session?.user.id; epoch++; }
  });
  async function call(name, body = {}) {
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
      response = await request(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000), referrerPolicy: 'no-referrer',
      });
    } catch { check(); throw new Error('每日挑戰連線失敗，請稍後重試'); }
    check();
    const data = await response.json(); check();
    if (!response.ok) throw Object.assign(new Error(data?.message === 'DAILY_EXPIRED'
      ? '這局已超過每日挑戰的收件時間,不列入排行' : data?.message === 'DAILY_GONE'
        ? '這天的挑戰紀錄已清除,這局不列入排行' : data?.message === 'DAILY_CLEARED'
        ? '今天的挑戰紀錄已清除，請明天再挑戰' : data?.message === 'DAILY_PAST_RANGE'
          ? `只能練習最近 ${DAILY_PRACTICE_DAYS} 天(不含今天)的題目` : data?.message === 'DAILY_PAST_OPEN'
            ? '這天的挑戰你還沒完成、仍在收件中,請先完成原本那局(收到隔天中午 12:00)' : '每日挑戰暫時無法使用，請稍後重試'),
    { code: ['DAILY_EXPIRED', 'DAILY_GONE', 'DAILY_CLEARED', 'DAILY_PAST_RANGE', 'DAILY_PAST_OPEN'].includes(data?.message) ? data.message : undefined });
    return data;
  }
  const gameCall = (name, game) => {
    if (!DAILY_GAMES.includes(game)) throw new Error('不支援的每日遊戲');
    return call(name, { p_game: game });
  };
  return {
    get userId() { return auth?.session?.user.id; },
    seed: (game) => gameCall('daily_seed', game),
    start: (game) => gameCall('start_daily', game),
    today: () => call('my_daily_today'),
    pastSeed: (game, day) => {
      if (!DAILY_GAMES.includes(game)) throw new Error('不支援的每日遊戲');
      return call('daily_past_seed', { p_game: game, p_day: day });
    },
    finish: (game, day, result, guesses, detail = {}) => call('finish_daily', {
      p_game: game, p_result: result, p_guesses: guesses, p_detail: { ...detail, daily: day },
    }),
    dispose: () => unsubscribe?.(),
  };
}
export async function browserDailyClient() {
  if (!cloudEnabled) return createDailyClient();
  const { auth } = await (await import('./auth.js?v=6053a51')).getCloudRuntime();
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
export async function mountDailyLobby(doc, client, createClient = browserDailyClient) {
  const list = doc.getElementById('daily-games');
  const message = doc.getElementById('daily-message');
  const render = async () => {
    list.replaceChildren();
    try {
      client ??= await createClient();
      const today = await client.today();
      message.textContent = `📅 ${dailyDateLabel(today.day)} 挑戰 · 每人每款一天一次`;
      for (const game of DAILY_GAMES) {
        const row = today.results.find((r) => r.game_id === game);
        const link = doc.createElement('a'); link.className = 'btn';
        link.href = `games/${game}/?daily=1`;
        link.textContent = `${DAILY_NAMES[game]} · ${dailyStatus(row)}`;
        list.append(link);
      }
      mountDailyPractice(doc, today.day);
    } catch {
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
