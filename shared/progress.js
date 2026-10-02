// 個人紀錄規則層(RS1):XP、等級、成就、連續天數、遊戲時間、匯入檔驗證。
// 純函式:不碰 DOM、不碰 localStorage,時間一律由呼叫端傳入(毫秒)。
// 第二期要搬成伺服器端觸發器,所以規則只能寫在這裡;profile.js 只負責串接。
// 規格正典:workbook/plans/profile.md §4~§7、§9。

export const APP_ID = 'game-collection';
export const SCHEMA_VERSION = 1;
export const PLAYS_LIMIT = 50;
export const XP_PER_LEVEL = 100;
export const IDLE_MS = 60_000;
export const ACHIEVEMENT_XP = 30;
export const DAILY_FIRST_XP = 5;

export const RESULTS = ['win', 'lose', 'quit', 'draw'];
export const DIFFICULTY_MULT = { normal: 1, hard: 1.5, expert: 2 };

// ---- 日期 ----

const pad = (n) => String(n).padStart(2, '0');

// 「日」= 裝置本地日期 YYYY-MM-DD。
export function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function prevDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d - 1, 12).getTime());
}

export const iso = (ms) => new Date(ms).toISOString();

// ---- 等級 ----

export function levelFor(xp) {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

// 畫面 C 的進度條:本級已得 / 升級所需。
export function levelProgress(xp) {
  return { level: levelFor(xp), current: Math.max(0, xp) % XP_PER_LEVEL, need: XP_PER_LEVEL };
}

// ---- 連續天數(§6)----

// 有完成局的日子才呼叫。last_day 是昨天 → current+1;是今天 → 不變;否則重設為 1。
export function nextStreak(streak, day) {
  const s = streak ?? { last_day: null, current: 0, longest: 0 };
  let current;
  if (s.last_day === day) current = s.current;
  else if (s.last_day && prevDay(day) === s.last_day) current = s.current + 1;
  else current = 1;
  return { last_day: day, current, longest: Math.max(s.longest ?? 0, current) };
}

// ---- XP(§5)----

// newAchievements = 本局結束時新解開的成就數(局中即時解開的另計,見 applyUnlock)。
export function playXp({ result, difficulty = 'normal', isBest = false, dailyFirst = false, newAchievements = 0 }) {
  if (result === 'quit') return 0;
  const base = 10 + (result === 'win' ? 20 : 0) + (isBest ? 10 : 0);
  const mult = DIFFICULTY_MULT[difficulty] ?? 1;
  return Math.round(base * mult) + (dailyFirst ? DAILY_FIRST_XP : 0) + ACHIEVEMENT_XP * newAchievements;
}

// ---- 成就(§6)----

const sum = (stats, key) => Object.values(stats).reduce((n, s) => n + (Number(s?.[key]) || 0), 0);
const gamesPlayed = (stats) => Object.values(stats).filter((s) => (s?.plays_count ?? 0) >= 1).length;

// test(ctx):ctx = { stats, profile, play?, gameId?, event? };play 只在完成局結束時有,event 只在局中即時判定時有。
export const ACHIEVEMENTS = [
  { id: 'first_play', name: '首局', icon: '🥇', cond: '完成第 1 局', test: ({ stats }) => sum(stats, 'plays_count') >= 1 },
  { id: 'first_win', name: '首勝', icon: '🏆', cond: '任一局勝利', test: ({ play }) => play?.result === 'win' },
  { id: 'games_3', name: '玩過 3 款', icon: '🎲', cond: '完成過 3 款遊戲', test: ({ stats }) => gamesPlayed(stats) >= 3 },
  { id: 'games_6', name: '六款全玩', icon: '🌈', cond: '6 款遊戲都完成過', test: ({ stats }) => gamesPlayed(stats) >= 6 },
  {
    id: 'tile_2048', name: '合出 2048', icon: '🔢', cond: '2048 合出 2048 方塊',
    test: ({ play, gameId, event }) => (play
      ? play.game_id === '2048' && (play.detail?.max_tile ?? 0) >= 2048
      : gameId === '2048' && (event?.max_tile ?? 0) >= 2048),
  },
  {
    id: 'mines_expert', name: '踩地雷高級通關', icon: '💣', cond: '踩地雷高級難度勝利',
    test: ({ play }) => play?.game_id === 'minesweeper' && play.difficulty === 'expert' && play.result === 'win',
  },
  {
    id: 'wordle_2', name: 'Wordle 2 次猜中', icon: '🔤', cond: 'Wordle 2 次內猜中',
    test: ({ play }) => play?.game_id === 'wordle' && play.result === 'win' && (play.detail?.guesses ?? Infinity) <= 2,
  },
  {
    id: 'ttt_10', name: '井字棋 10 連不敗', icon: '⭕', cond: '井字棋連續 10 局不輸',
    test: ({ stats }) => (stats.tictactoe?.detail?.unbeaten ?? 0) >= 10,
  },
  { id: 'streak_3', name: '連玩 3 天', icon: '🔥', cond: '連續 3 天完成遊戲', test: ({ profile }) => (profile.streak?.current ?? 0) >= 3 },
  { id: 'streak_7', name: '連玩 7 天', icon: '📅', cond: '連續 7 天完成遊戲', test: ({ profile }) => (profile.streak?.current ?? 0) >= 7 },
  { id: 'hours_5', name: '累計 5 小時', icon: '⏳', cond: '遊戲時間累計 5 小時', test: ({ stats }) => sum(stats, 'total_sec') >= 18000 },
  { id: 'plays_100', name: '累計 100 局', icon: '💯', cond: '完成 100 局', test: ({ stats }) => sum(stats, 'plays_count') >= 100 },
];

// 回傳 ctx 下成立、但 profile 尚未解開的成就 id。
export function newlyUnlocked(ctx) {
  const have = ctx.profile.achievements ?? {};
  return ACHIEVEMENTS.filter((a) => !have[a.id] && a.test(ctx)).map((a) => a.id);
}

// ---- 資料初值 ----

export function emptyProfile(deviceId) {
  return {
    schema_version: SCHEMA_VERSION,
    device_id: deviceId,
    xp: 0,
    level: 1,
    achievements: {},
    streak: { last_day: null, current: 0, longest: 0 },
    daily_first_day: null,
  };
}

export function emptyStats(gameId) {
  return { game_id: gameId, plays_count: 0, wins_count: 0, best_score: 0, total_sec: 0, last_played_at: null, detail: {} };
}

// 舊資料遷移(§3):舊 best 併入 stats.best_score,取大者。
export function migrateLegacyBest(stats, gameId, legacyBest) {
  const best = Number(legacyBest) || 0;
  const cur = stats[gameId] ?? emptyStats(gameId);
  if (best <= cur.best_score) return stats;
  return { ...stats, [gameId]: { ...cur, best_score: best } };
}

// 各遊戲累計在 stats.detail 的欄位(只在完成局更新)。
function nextDetail(gameId, detail, result) {
  if (gameId === 'tictactoe' && ['win', 'draw', 'lose'].includes(result)) {
    return { ...detail, unbeaten: result === 'lose' ? 0 : (detail.unbeaten ?? 0) + 1 };
  }
  return detail;
}

// ---- 一局何時結束(§4.2)----

// everWon = 本局曾勝利(復原不會清掉;遮罩用的 won 會)。
// 遊戲判定結束。
export function resultOnGameOver({ everWon }) {
  return everWon ? 'win' : 'lose';
}

// 玩家按「新遊戲」:回傳 result,null = 不記錄。
export function resultOnNewGame({ everWon, moves }) {
  if (everWon) return 'win';
  return moves > 0 ? 'quit' : null;
}

// ---- 大廳排序(§10)----

// 最近活動時間 = 最後結算時間與存檔 updated_at 較新者;都沒有 → null。
export function lastActivity(stats, save) {
  const times = [stats?.last_played_at, save?.updated_at].filter(Boolean);
  return times.length ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
}

// 有活動者新到舊在前,其餘照 gameList 原順序。stats:{ [id]: stats };saves:{ [id]: save }。
export function recentOrder(gameList, stats, saves) {
  const at = new Map(gameList.map((g) => [g.id, lastActivity(stats[g.id], saves[g.id])]));
  const active = gameList.filter((g) => at.get(g.id)).sort((a, b) => Date.parse(at.get(b.id)) - Date.parse(at.get(a.id)));
  return [...active, ...gameList.filter((g) => !at.get(g.id))];
}

// ---- 一局結束:統計、XP、成就 ----

// in: { profile, stats(map), gameId, result, score, difficulty, detail, startedAt, endedAt, durationSec, id, live }
//   live = 本局局中已即時入帳的獎勵 { xp, achievements }:併入 play 紀錄與回傳的明細,但⛔ 不再加進總 XP。
// out: { profile, stats, play, xpGained, newAchievements, level }(皆為新物件,不改動輸入)
//   xpGained / newAchievements = 本局合計(含 live);profile.xp 只加結算當下的部分。
export function applyFinish(input) {
  const { gameId, result, score = 0, difficulty = 'normal', detail = {}, startedAt, endedAt, durationSec = 0, id } = input;
  const live = { xp: input.live?.xp ?? 0, achievements: input.live?.achievements ?? [] };
  if (!RESULTS.includes(result)) throw new Error(`unknown result: ${result}`);
  const completed = result !== 'quit';
  const prev = input.stats[gameId] ?? emptyStats(gameId);
  const isBest = score > (prev.best_score || 0);

  const gameStats = {
    ...prev,
    plays_count: prev.plays_count + (completed ? 1 : 0),
    wins_count: prev.wins_count + (result === 'win' ? 1 : 0),
    best_score: Math.max(prev.best_score || 0, score),
    total_sec: prev.total_sec + durationSec,
    last_played_at: iso(endedAt),
    detail: nextDetail(gameId, prev.detail ?? {}, result),
  };
  const stats = { ...input.stats, [gameId]: gameStats };

  let profile = { ...input.profile };
  let dailyFirst = false;
  if (completed) {
    const day = dayOf(endedAt);
    dailyFirst = profile.daily_first_day !== day;
    profile.daily_first_day = day;
    profile.streak = nextStreak(profile.streak, day);
  }

  const play = {
    id,
    game_id: gameId,
    started_at: iso(startedAt ?? endedAt),
    ended_at: iso(endedAt),
    duration_sec: durationSec,
    result,
    score,
    difficulty,
    is_best: isBest,
    xp_gained: 0,
    detail,
  };

  const unlocked = completed ? newlyUnlocked({ stats, profile, play }) : [];
  const finishXp = playXp({ result, difficulty, isBest, dailyFirst, newAchievements: unlocked.length });
  play.xp_gained = finishXp + live.xp;

  profile.achievements = { ...profile.achievements };
  for (const a of unlocked) profile.achievements[a] = iso(endedAt);
  profile.xp = (profile.xp ?? 0) + finishXp;
  profile.level = levelFor(profile.xp);

  return { profile, stats, play, xpGained: play.xp_gained, newAchievements: [...live.achievements, ...unlocked], level: profile.level };
}

// 局中事件即時判定(如合出 2048):XP 當下入帳,之後不重複計。
export function applyUnlock({ profile, stats, gameId, event, now }) {
  const newAchievements = newlyUnlocked({ stats, profile, gameId, event });
  if (newAchievements.length === 0) return { profile, newAchievements, xpGained: 0, level: profile.level };
  const xpGained = ACHIEVEMENT_XP * newAchievements.length;
  const next = { ...profile, achievements: { ...profile.achievements } };
  for (const a of newAchievements) next.achievements[a] = iso(now);
  next.xp = (next.xp ?? 0) + xpGained;
  next.level = levelFor(next.xp);
  return { profile: next, newAchievements, xpGained, level: next.level };
}

// 最近紀錄:新的在前,最多 PLAYS_LIMIT 筆,超過丟最舊。
export function pushPlay(plays, play, limit = PLAYS_LIMIT) {
  return [play, ...plays].slice(0, limit);
}

// ---- 遊戲時間(§7)----
// 只算「分頁可見」且「距上次輸入 ≤ 60 秒」的時間。分頁隱藏後須等下一次輸入才恢復。
// timer = { visible, lastInput, lastT, ms };事件 = { t, type: 'input' | 'hidden' | 'visible' | 'tick' }。

export function timerInit(t, baseSec = 0) {
  return { visible: true, lastInput: t, lastT: t, ms: baseSec * 1000 };
}

function credit(timer, t) {
  if (!timer.visible || t <= timer.lastT) return 0;
  const from = Math.max(timer.lastT, timer.lastInput);
  const to = Math.min(t, timer.lastInput + IDLE_MS);
  return Math.max(0, to - from);
}

export function timerEvent(timer, { t, type }) {
  const next = { ...timer, ms: timer.ms + credit(timer, t), lastT: Math.max(timer.lastT, t) };
  if (type === 'input') next.lastInput = t;
  if (type === 'hidden') { next.visible = false; next.lastInput = -Infinity; }
  if (type === 'visible') next.visible = true;
  return next;
}

export function timerSeconds(timer, t) {
  return Math.floor((timer.ms + credit(timer, t)) / 1000);
}

// 時間戳序列 → 實際遊玩秒數(第一個事件視為開始)。
export function activeSeconds(events, baseSec = 0) {
  if (events.length === 0) return baseSec;
  let timer = timerInit(events[0].t, baseSec);
  for (const e of events.slice(1)) timer = timerEvent(timer, e);
  return timerSeconds(timer, timer.lastT);
}

// ---- 匯入檔驗證(§9)----

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isTime = (v) => isStr(v) && !Number.isNaN(Date.parse(v));
// 遊戲 id:小寫英數與連字號(擋掉 __proto__ 之類會取到繼承屬性的 key)。
export const isGameId = (v) => isStr(v) && /^[a-z0-9-]{1,32}$/.test(v);
// 成就 id 只收白名單(匯入檔內容會顯示在畫面上)。
export const isAchievementId = (v) => isStr(v) && ACHIEVEMENTS.some((a) => a.id === v);

function checkProfile(p) {
  if (!isObj(p)) return 'profile 缺少或格式錯誤';
  if (!isStr(p.device_id)) return 'profile.device_id 格式錯誤';
  if (!isNum(p.xp) || !isNum(p.level)) return 'profile.xp / level 格式錯誤';
  if (!isObj(p.achievements) || !Object.entries(p.achievements).every(([k, v]) => isAchievementId(k) && isTime(v))) {
    return 'profile.achievements 格式錯誤';
  }
  if (!isObj(p.streak) || !isNum(p.streak.current) || !isNum(p.streak.longest)) return 'profile.streak 格式錯誤';
  return null;
}

function checkStats(stats) {
  if (!isObj(stats)) return 'stats 缺少或格式錯誤';
  for (const [k, s] of Object.entries(stats)) {
    if (!isGameId(k) || !isObj(s) || s.game_id !== k) return 'stats 內有遊戲統計格式錯誤';
    for (const f of ['plays_count', 'wins_count', 'best_score', 'total_sec']) {
      if (!isNum(s[f])) return `stats.${k}.${f} 格式錯誤`;
    }
  }
  return null;
}

function checkPlays(plays) {
  if (!Array.isArray(plays)) return 'plays 缺少或格式錯誤';
  for (const p of plays) {
    if (!isObj(p) || !isStr(p.id) || !isGameId(p.game_id) || !RESULTS.includes(p.result)
      || !isNum(p.score) || !isNum(p.duration_sec) || !isNum(p.xp_gained) || !isStr(p.ended_at)) {
      return 'plays 內有紀錄格式錯誤';
    }
  }
  return null;
}

// 存檔外層(§3);live 為本局即時獎勵明細(選填)。
export function isValidSave(s) {
  if (!isObj(s) || !isGameId(s.game_id) || !isObj(s.state)) return false;
  if (!isNum(s.active_sec) || s.active_sec < 0 || !isNum(s.version)) return false;
  if (!isTime(s.started_at) || !isTime(s.updated_at)) return false;
  if (s.live !== undefined && !(isObj(s.live) && isNum(s.live.xp) && Array.isArray(s.live.achievements) && s.live.achievements.every(isAchievementId))) return false;
  return true;
}

// stateValidators:{ [game_id]: (state) => boolean },各遊戲提供自己 state 的檢查。只取自有屬性的函式。
export function stateValidatorFor(stateValidators, gameId) {
  const valid = Object.hasOwn(stateValidators, gameId) ? stateValidators[gameId] : undefined;
  return typeof valid === 'function' ? valid : null;
}

// 存檔外層與該遊戲的 state 都合格。
export function isValidGameSave(s, stateValidators = {}) {
  if (!isValidSave(s)) return false;
  const valid = stateValidatorFor(stateValidators, s.game_id);
  return !valid || valid(s.state) === true;
}

function checkSaves(saves, stateValidators) {
  if (!Array.isArray(saves)) return 'saves 缺少或格式錯誤';
  for (const s of saves) {
    if (!isValidSave(s)) return 'saves 內有存檔格式錯誤';
    if (!isValidGameSave(s, stateValidators)) return `saves 內 ${s.game_id} 的遊戲狀態格式錯誤`;
  }
  if (new Set(saves.map((s) => s.game_id)).size !== saves.length) return 'saves 內有重複的遊戲存檔';
  return null;
}

// → { ok: true, data, summary } | { ok: false, error }
export function validateImport(data, stateValidators = {}) {
  if (!isObj(data)) return { ok: false, error: '不是有效的紀錄檔' };
  if (data.app !== APP_ID) return { ok: false, error: '不是遊戲集錦的紀錄檔' };
  if (data.schema_version !== SCHEMA_VERSION) return { ok: false, error: `不支援的版本:${data.schema_version}` };
  const error = checkProfile(data.profile) || checkStats(data.stats) || checkPlays(data.plays) || checkSaves(data.saves, stateValidators);
  if (error) return { ok: false, error };
  return {
    ok: true,
    data,
    summary: {
      level: levelFor(data.profile.xp),
      plays_count: sum(data.stats, 'plays_count'),
      achievements: Object.keys(data.profile.achievements).length,
    },
  };
}

export function exportData({ profile, stats, plays, saves, now }) {
  return { app: APP_ID, schema_version: SCHEMA_VERSION, exported_at: iso(now), profile, stats, plays, saves };
}

export function exportFileName(now) {
  return `game-collection-profile-${dayOf(now).replaceAll('-', '')}.json`;
}
