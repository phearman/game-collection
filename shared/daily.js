import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, cloudEnabled } from './supabase-config.js?v=dd499c2';
import { formatDuration } from './duration.js?v=dd499c2';

export const DAILY_GAMES = ['sudoku', 'minesweeper', 'memory'];
export const DAILY_NAMES = { wordle: 'Wordle', sudoku: '數獨', minesweeper: '踩地雷', memory: '翻翻樂' };
export const DAILY_LOGIN_NOTICE = '登入後才能參加每日挑戰';
export const DAILY_FIXED_NOTE = '遊戲固定、每天換題目';
// 與 SQL daily_public_eligible / daily_memory_rank_misses 同源；踩地雷、翻翻樂共用 20 秒門檻。
export const DAILY_FAST_GAME_MIN_SECONDS = 20;
export const taiwanDay = (stamp) => new Date(Number(stamp) + 8 * 3600000).toISOString().slice(0, 10);
export const dailyDateLabel = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export const dailySlot = (game) => `${game}-daily`;
export const dailyRequested = (search) => new URLSearchParams(search).get('daily') === '1';

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
    if (!response.ok) throw new Error(data?.message === 'DAILY_EXPIRED'
      ? '挑戰已換日，請回大廳開始今天的挑戰' : data?.message === 'DAILY_CLEARED'
        ? '今天的挑戰紀錄已清除，請明天再挑戰' : '每日挑戰暫時無法使用，請稍後重試');
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
    finish: (game, day, result, guesses, detail = {}) => call('finish_daily', {
      p_game: game, p_result: result, p_guesses: guesses, p_detail: { ...detail, daily: day },
    }),
    dispose: () => unsubscribe?.(),
  };
}
export async function browserDailyClient() {
  if (!cloudEnabled) return createDailyClient();
  const { auth } = await (await import('./auth.js?v=dd499c2')).getCloudRuntime();
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
export function matchesDailySave(saved, daily, valid) {
  return !daily.row?.cleared && !!saved && saved.daily === daily.day && saved.daily_seed === daily.seed && valid(saved);
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
    } catch {
      message.textContent = DAILY_LOGIN_NOTICE;
      const login = doc.createElement('a'); login.className = 'btn'; login.href = 'me/'; login.textContent = '前往登入'; list.append(login);
    }
  };
  await render();
  globalThis.window?.addEventListener('pageshow', render);
  globalThis.document?.addEventListener('visibilitychange', () => { if (!doc.hidden) void render(); });
}
