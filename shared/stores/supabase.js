// SupabaseStore:只用 fetch 呼叫 PostgREST，交易由 RPC 執行。
//
// store 介面(MemoryStore / LocalStore / SupabaseStore 共同遵守;所有方法回傳 Promise;
// put* / addPlay / deleteSave resolve 為 { ok:false, reason } 表示未寫入,profile.js 會改以記憶體資料為準):
//   getProfile() → profile | null          putProfile(profile)
//   getSave(gameId) → save | null(save.live = 本局即時獎勵明細,選填)          putSave(save)   deleteSave(gameId)   listSaves() → save[]
//   addPlay(play)                          只保留最近 50 筆,超過丟最舊
//   listPlays({ gameId?, limit? }) → play[]   新到舊
//   getStats(gameId) → stats | null        putStats(stats)   listStats() → { [game_id]: stats }
//   exportAll() → { profile, stats, plays, saves }
//   importAll(data)                        整份覆蓋;失敗須丟錯且原資料不變
//   commitFinish({ gameId, profile, stats, play, prepare? }) → { duplicate, out?, profile? }
//       本機 prepare(baseProfile, allStats) 在鎖內查收據後同步計算,回 applyFinish 結果(out)。
//       結算一次提交:刪該款存檔 + 寫 profile/stats/局紀錄/收據;
//                                          任一步失敗須丟錯且整批還原成原值,⛔ 回 false(IR6);還原不了丟
//                                          rollbackFailed 錯誤並附 retryRestore() → 再還原一次,回傳同規則的錯誤
//   isImportKey(key) → boolean(選填,同步)  storage 事件的 key 是否為「整份匯入」標記;profile 據此讓快取全部作廢
//   legacyBest(gameId) → number            RS1 前舊最佳分數(只有本機有;雲端實作回 0)
//
// 資料欄位(snake_case,與第二期 Postgres 欄位同名)見 workbook/plans/profile.md §3。

export class SupabaseStore {
  get cloud() { return true; }
  constructor({ url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY, auth,
    fetch: request = globalThis.fetch, win = globalThis.window } = {}) {
    if (!url || !key || !auth) throw new Error('尚未設定雲端帳號');
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.auth = auth;
    this.userId = auth.session?.user.id;
    // 原生 fetch 須以 globalThis 呼叫,存成物件方法會丟失呼叫對象(Illegal invocation)。
    this.fetch = (...args) => request.apply(globalThis, args);
    this.cache = new Map();
    // 快取世代(IR32):整份匯入/合併清空快取時 +1;清空前就發出、之後才回來的讀取不得回填舊資料。
    this.cacheEpoch = 0;
    this.pending = new Map();
    this.lastFinish = new Map();
    this.dirty = new Set();
    this.active = 0;
    this.failed = false;
    this.listeners = new Set();
    this.win = win;
    this.online = () => { this.retryPending().catch(() => {}); };
    win?.addEventListener?.('online', this.online);
  }

  get status() { return this.active ? '同步中' : this.failed || this.dirty.size || [...this.pending.values()].some((p) => !p.done) ? '離線' : '已同步'; }
  subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit() { for (const cb of this.listeners) cb(this.status); }
  dispose() { this.win?.removeEventListener?.('online', this.online); this.listeners.clear(); this.pending.clear(); }

  async request(path, { method = 'GET', body, prefer } = {}) {
    this.active += 1;
    this.emit();
    try {
      const token = await this.auth.accessToken();
      if (!token || !this.auth.session?.user.id || this.auth.session.user.id !== this.userId) {
        // 仍有同一帳號的登入資料、只是暫時換不到 token(IR30)⇒ 標記暫時故障,⛔ 不讓呼叫端登出。
        const offline = Boolean(this.auth.session?.user.id) && this.auth.session.user.id === this.userId;
        throw Object.assign(new Error(offline ? '暫時連不上帳號服務' : '請重新登入'), { transient: offline });
      }
      const headers = { apikey: this.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      if (prefer) headers.Prefer = prefer;
      // 網路錯誤(連不上、讀本文中斷)標為暫時故障;解析失敗與資料格式錯誤不是(IR30)。
      const networkError = (e) => Object.assign(e instanceof Error ? e : new Error('暫時連不上帳號服務'), { transient: true, reason: 'network' });
      let res;
      try {
        res = await this.fetch(`${this.url}/rest/v1/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      } catch (e) { throw networkError(e); }
      if (!res.ok) {
        let error;
        try { error = JSON.parse(await res.text()); } catch { /* 非 JSON 錯誤 */ }
        const err = new Error(error?.message === 'STALE_PROFILE' ? '紀錄已過期' : `同步失敗 (${res.status})`);
        err.stale = error?.message === 'STALE_PROFILE';
        err.status = res.status;
        throw err;
      }
      let data = null;
      if (res.status !== 204) {
        try { data = await res.text(); } catch (e) { throw networkError(e); }
      }
      this.failed = false;
      return data ? JSON.parse(data) : null;
    } catch (err) {
      this.failed = true;
      err.reason ??= err.transient ? 'network' : 'cloud';
      throw err;
    } finally { this.active -= 1; this.emit(); }
  }

  async read(path) {
    const epoch = this.cacheEpoch;
    try {
      const rows = await this.request(path);
      const clean = (rows ?? []).map(({ user_id, ...row }) => {
        // Postgres 的時區字串格式與本機 ISO 不同；profile 會直接比較存檔開始時間。
        for (const field of ['started_at', 'ended_at', 'updated_at', 'last_played_at']) {
          if (row[field]) row[field] = new Date(row[field]).toISOString();
        }
        if (path.startsWith('saves?') && row.live === null) delete row.live;
        return path.startsWith('saves?') ? restoreSave(row) : row;
      });
      if (epoch === this.cacheEpoch) this.cache.set(path, structuredClone(clean));
      return clean;
    } catch (err) {
      if (this.cache.has(path)) return structuredClone(this.cache.get(path));
      const table = path.split('?')[0];
      const rows = this.cache.get(`${table}?select=*`);
      const game = new URLSearchParams(path.split('?')[1]).get('game_id')?.slice(3);
      if (rows && game) return structuredClone(rows.filter((row) => row.game_id === game));
      throw err; // 初次讀取失敗不能被當成空資料，避免錯誤地初始化/覆蓋帳號。
    }
  }
  filter(gameId) { return new URLSearchParams({ game_id: `eq.${gameId}` }).toString(); }
  updateCache(table, value, removeGame) {
    if (table === 'saves' && value) value = restoreSave(value);
    const idField = table === 'plays' ? 'id' : 'game_id';
    for (const [path, rows] of this.cache) {
      if (!path.startsWith(`${table}?`)) continue;
      // 局紀錄涉及排序和上限，保留已有快取做離線讀取，下一次 GET 會更新。
      if (table === 'plays') continue;
      const game = new URLSearchParams(path.split('?')[1]).get('game_id')?.slice(3);
      if (game && game !== (value?.game_id ?? removeGame)) continue;
      const next = rows.filter((row) => table !== 'profiles' && row[idField] !== (value?.[idField] ?? removeGame));
      if (value) next.push(structuredClone(value));
      this.cache.set(path, next);
    }
    if (value && table === 'saves') this.cache.set(`saves?select=*&${this.filter(value.game_id)}&limit=1`, [structuredClone(value)]);
  }
  async write(table, value, conflict) {
    const dirty = `${table}:${value.game_id ?? value.id ?? ''}`;
    try {
      const user_id = this.auth.session?.user.id;
      await this.request(`${table}?on_conflict=${conflict}`, { method: 'POST', body: { ...pick(table, value), user_id },
        prefer: `resolution=${table === 'plays' ? 'ignore' : 'merge'}-duplicates,return=minimal` });
      this.updateCache(table, pick(table, value));
      this.dirty.delete(dirty);
      this.emit();
      return true;
    } catch (err) { this.dirty.add(dirty); this.emit(); return writeFailure(err); }
  }
  baseline(field) {
    // 不確定是否已提交的結算重試，必須從原基準重算，避免已成功的交易再加一次 XP。
    const pending = [...this.pending.values()][0];
    return pending?.baseline?.[field];
  }
  async getProfile() {
    if (this.baseline('profile') !== undefined) return structuredClone(this.baseline('profile'));
    return (await this.read('profiles?select=*&limit=1'))[0] ?? null;
  }
  putProfile(profile) { return this.write('profiles', profile, 'user_id'); }
  async getSave(gameId) { return (await this.read(`saves?select=*&${this.filter(gameId)}&limit=1`))[0] ?? null; }
  putSave(save) { return this.write('saves', save, 'user_id,game_id'); }
  async deleteSave(gameId) {
    // IR6 放棄結算時取消待重試交易。
    this.pending.delete(gameId);
    const dirty = `saves:${gameId}`;
    try {
      await this.request(`saves?${this.filter(gameId)}`, { method: 'DELETE', prefer: 'return=minimal' });
      this.updateCache('saves', null, gameId); this.dirty.delete(dirty); this.emit(); return true;
    } catch (err) { this.dirty.add(dirty); this.emit(); return writeFailure(err); }
  }
  listSaves() { return this.read('saves?select=*'); }
  addPlay(play) { return this.write('plays', play, 'user_id,id'); }
  listPlays({ gameId, limit = 50 } = {}) {
    const query = new URLSearchParams({ select: '*', order: 'ended_at.desc,id.desc', limit: String(Math.max(0, Math.min(50, Number.isFinite(limit) ? Math.floor(limit) : 50))) });
    if (gameId) query.set('game_id', `eq.${gameId}`);
    return this.read(`plays?${query}`);
  }
  async getStats(gameId) {
    const stats = this.baseline('stats');
    if (stats !== undefined) return structuredClone(stats[gameId] ?? null);
    return (await this.read(`stats?select=*&${this.filter(gameId)}&limit=1`))[0] ?? null;
  }
  putStats(stats) { return this.write('stats', stats, 'user_id,game_id'); }
  async listStats() {
    if (this.baseline('stats') !== undefined) return structuredClone(this.baseline('stats'));
    return Object.fromEntries((await this.read('stats?select=*')).map((s) => [s.game_id, s]));
  }
  async exportAll() {
    // 四份互不相依,同時讀(IR32);錯誤與完成時機同依序讀(allInOrder)。
    const [profile, stats, plays, saves] = await allInOrder([this.getProfile(), this.listStats(), this.listPlays(), this.listSaves()]);
    return { profile, stats, plays, saves };
  }
  async importAll(data) {
    // 匯入不排程重試；失敗由呼叫者決定，不能日後默默覆蓋新的紀錄。
    await this.request('rpc/import_all', { method: 'POST', body: { data: cleanData(data) } });
    this.pending.clear(); this.cache.clear(); this.cacheEpoch += 1; this.dirty.clear(); this.emit();
  }
  async hasMergedDevice(deviceId) {
    const query = new URLSearchParams({ select: 'device_id', device_id: `eq.${deviceId}`, limit: '1' });
    return Boolean((await this.request(`merged_devices?${query}`))?.length);
  }
  async mergeDevice(deviceId, data, mode = 'merge') {
    await this.request('rpc/merge_device', { method: 'POST', body: { device_id: deviceId, data: { ...cleanData(data), _mode: mode } } });
    this.pending.clear(); this.cache.clear(); this.cacheEpoch += 1; this.dirty.clear(); this.emit();
  }
  async sendFinish(pending) {
    let result;
    for (let retry = 0; ; retry += 1) {
      try {
        result = await this.request(pending.daily ? 'rpc/commit_daily_play' : 'rpc/commit_finish', { method: 'POST', body: pending.body });
        break;
      } catch (err) {
        if (!err.stale || !pending.recompute || retry >= 3) throw err;
        // 過期後必須讀伺服器，不能採用離線快取或不確定交易的 baseline。
        const rows = await this.request('profiles?select=*&limit=1');
        const stats = await this.request('stats?select=*');
        const base = rows?.[0];
        if (!base) throw new Error('帳號紀錄已變更，請重新整理');
        const out = pending.recompute(base, Object.fromEntries(stats.map((s) => [s.game_id, s])), pending.body.play);
        pending.recomputed = out;
        pending.baseline = { profile: base, stats: Object.fromEntries(stats.map((s) => [s.game_id, s])) };
        pending.body = { game_id: pending.body.game_id, profile: pick('profiles', out.profile), stats: pick('stats', out.stats[pending.body.game_id]), play: pick('plays', out.play) };
      }
    }
    if (result?.profile) pending.body.profile = result.profile;
    if (result?.stats) pending.body.stats = result.stats;
    if (result?.play) pending.body.play = result.play;
    pending.duplicate = result?.duplicate === true;
    pending.done = true;
    this.updateCache('profiles', pending.body.profile);
    this.updateCache('stats', pending.body.stats);
    this.updateCache('saves', null, pending.saveId ?? pending.body.game_id);
    this.dirty.delete('profiles:');
    this.dirty.delete(`stats:${pending.body.game_id}`);
    this.dirty.delete(`saves:${pending.saveId ?? pending.body.game_id}`);
    this.emit();
  }
  async commitFinish({ gameId, saveId = gameId, profile, stats, play, recompute }) {
    let pending = this.pending.get(gameId);
    if (!pending) {
      const profileRows = this.cache.get('profiles?select=*&limit=1');
      const statsRows = this.cache.get('stats?select=*');
      pending = { daily: saveId !== gameId, saveId, body: { game_id: gameId, profile: pick('profiles', profile), stats: pick('stats', stats), play: pick('plays', play) },
        baseline: { profile: profileRows?.[0] ?? null, stats: Object.fromEntries((statsRows ?? []).map((s) => [s.game_id, s])) },
        recompute: recompute ?? ((base, stats, play) => recalculateFinish(base, stats, play, this.finishRewards?.(gameId))), done: false };
      this.pending.set(gameId, pending);
    }
    if (!pending.done) {
      pending.sending ??= this.sendFinish(pending).finally(() => { pending.sending = null; });
      await pending.sending; // 失敗保留同一個 play.id 與原請求，並丟錯。
    }
    Object.assign(profile, structuredClone(pending.body.profile));
    Object.assign(stats, structuredClone(pending.body.stats));
    Object.assign(play, structuredClone(pending.body.play));
    this.lastFinish.set(gameId, { recomputed: pending.recomputed, level: pending.body.profile.level, duplicate: pending.duplicate });
    this.pending.delete(gameId);
    return { duplicate: pending.duplicate, profile: pending.body.profile };
  }
  async retryPending() {
    for (const pending of this.pending.values()) {
      if (pending.done) continue;
      pending.sending ??= this.sendFinish(pending).finally(() => { pending.sending = null; });
      await pending.sending;
    }
  }
  isImportKey() { return false; }
  async legacyBest() { return 0; }
}

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../supabase-config.js?v=bb80cea';
import { writeFailure, allInOrder } from './errors.js?v=bb80cea';
import { applyFinish, ACHIEVEMENT_XP } from '../progress.js?v=bb80cea';
import { normalizePlay } from './normalize.js?v=bb80cea';

function recalculateFinish(base, stats, play, live) {
  const missing = (live?.achievements ?? []).filter((id) => !base.achievements?.[id]);
  const profile = missing.length ? { ...base,
    achievements: { ...base.achievements, ...Object.fromEntries(missing.map((id) => [id, play.ended_at])) },
    xp: base.xp + missing.length * ACHIEVEMENT_XP } : base;
  return applyFinish({ profile, stats, gameId: play.game_id, result: play.result, score: play.score,
    difficulty: play.difficulty, detail: play.detail, assist: play.detail?.assist === true,
    startedAt: Date.parse(play.started_at), endedAt: Date.parse(play.ended_at), durationSec: play.duration_sec, id: play.id, live });
}
const FIELDS = {
  profiles: ['schema_version', 'device_id', 'xp', 'level', 'achievements', 'streak', 'daily_first_day', 'rev'],
  stats: ['game_id', 'plays_count', 'wins_count', 'best_score', 'total_sec', 'last_played_at', 'detail'],
  plays: ['id', 'game_id', 'started_at', 'ended_at', 'duration_sec', 'result', 'score', 'difficulty', 'is_best', 'xp_gained', 'detail'],
  saves: ['game_id', 'state', 'active_sec', 'started_at', 'updated_at', 'version', 'live'],
};
// POST 成功後的快取也使用共用存檔介面;離線讀回時不得重新補發 id。
function restoreSave(save) {
  if (!save.state?.round_id) return save;
  const { round_id, ...state } = save.state;
  return { ...save, round_id, state };
}
function pick(table, value) {
  if (table === 'plays') value = normalizePlay(value);
  if (table === 'saves' && value.round_id) value = { ...value, state: { ...value.state, round_id: value.round_id } };
  return structuredClone(Object.fromEntries(FIELDS[table].filter((f) => value[f] !== undefined).map((f) => [f, value[f]])));
}
function cleanData(data) {
  return { profile: data.profile ? pick('profiles', data.profile) : null,
    stats: Object.fromEntries(Object.entries(data.stats).map(([id, s]) => [id, pick('stats', s)])),
    plays: data.plays.slice(0, 50).map((p) => pick('plays', p)), saves: data.saves.map((s) => pick('saves', s)) };
}
