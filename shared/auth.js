import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js?v=e2da0a7';
import { levelFor } from './progress.js?v=e2da0a7';
import { markCloudOffline } from './cloud-status.js?v=e2da0a7';

const AUTH_KEY = 'gc:auth';
const REFRESH_LOCK_KEY = 'gc:auth-refresh-lock';
const REFRESH_LOCK_MS = 20000;
const REFRESH_TIMEOUT_MS = 10000;
const RETRY_BASE_MS = 15000;
const RETRY_MAX_MS = 300000;
const RETRY_AT_KEY = 'gc:auth-retry-at'; // 跨分頁共享的退避期限(ms)
// 本分頁已確認「這個帳號 + 這台裝置」合併過(IR32):值 = `${user id}|${device id}`,換帳號自然對不上;登出、登入失效時清除。
const MERGED_KEY = 'gc:merged-device';
const CLOCK_SKEW_MS = 1000; // 共享退避期限比上限還晚超過這麼多 ⇒ 異常(時鐘回撥等),不採用
const TRANSIENT_STATUS = (status) => status === 408 || status === 429 || (status >= 500 && status <= 599);
// 錯誤分類(IR30,refresh 與雲端準備共用):網路錯誤(連不上、讀本文中斷,呼叫端標 transient)、逾時、408、429、5xx 是暫時故障;
// 其他 4xx、解析失敗、資料格式錯誤(含處理資料時的 TypeError)都視為失效。
export const isTransientError = (err) => Boolean(err?.transient) || TRANSIENT_STATUS(err?.status);
const PKCE_KEY = 'gc:pkce';
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function sameOriginRedirect(target, current) {
  const url = new URL(target, current);
  if (url.origin !== new URL(current).origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('登入返回網址必須與目前頁面同源');
  }
  url.searchParams.delete('code');
  return url.href;
}

// 空白的初始 profile 不算遊玩資料，避免新裝置登入時不必要的衝突。
export function hasRecords(data) {
  return Boolean(data && ((data.profile?.xp ?? 0) > 0 || Object.keys(data.profile?.achievements ?? {}).length
    || (data.profile?.streak?.longest ?? 0) > 0 || Object.keys(data.stats ?? {}).length
    || data.plays?.length || data.saves?.length));
}
export function firstLoginDecision(local, cloud, merged = false) {
  if (merged) return 'cloud';
  if (!hasRecords(cloud)) return hasRecords(local) ? 'upload' : 'cloud';
  return hasRecords(local) ? 'choose' : 'cloud';
}

export function deviceId(storage = globalThis.localStorage, crypto = globalThis.crypto) {
  let id = storage.getItem('gc:device');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? '')) {
    if (crypto.randomUUID) id = crypto.randomUUID();
    else {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    storage.setItem('gc:device', id);
  }
  return id;
}

// 供本機預覽與測試使用;正式合併在伺服器交易內重算。
// RS86:本機數獨各難度最佳取大;merge_device SQL 仍採較新整份 detail(PM 接受的限制)。
export function mergeRecords(local, cloud) {
  if (!cloud.profile) return structuredClone(local);
  const later = (a, b) => !a ? b : !b ? a : a >= b ? a : b;
  const lp = local.profile ?? {};
  const cp = cloud.profile ?? lp;
  const achievements = { ...cp.achievements };
  for (const [id, at] of Object.entries(lp.achievements ?? {})) achievements[id] = achievements[id] ? (at < achievements[id] ? at : achievements[id]) : at;
  const xp = (cp.xp ?? 0) + (lp.xp ?? 0);
  const streak = (lp.streak?.last_day ?? '') > (cp.streak?.last_day ?? '') ? lp.streak : cp.streak;
  const profile = { ...cp, xp, level: levelFor(xp), achievements, daily_first_day: later(cp.daily_first_day, lp.daily_first_day),
    streak: { ...streak, longest: Math.max(cp.streak?.longest ?? 0, lp.streak?.longest ?? 0) } };
  const stats = structuredClone(cloud.stats ?? {});
  for (const [id, s] of Object.entries(local.stats ?? {})) {
    const c = stats[id];
    if (!c) { stats[id] = structuredClone(s); continue; }
    stats[id] = { ...((s.last_played_at ?? '') > (c.last_played_at ?? '') ? s : c),
      plays_count: c.plays_count + s.plays_count, wins_count: c.wins_count + s.wins_count,
      best_score: Math.max(c.best_score, s.best_score), total_sec: c.total_sec + s.total_sec,
      last_played_at: later(c.last_played_at, s.last_played_at) };
    if (id === 'sudoku' && (s.detail?.best_by_difficulty || c.detail?.best_by_difficulty)) {
      const best = {};
      for (const difficulty of ['beginner', 'normal', 'hard', 'expert']) {
        const a = s.detail?.best_by_difficulty?.[difficulty];
        const b = c.detail?.best_by_difficulty?.[difficulty];
        const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0); // 壞值(非數字)⛔ 蓋掉另一側有效值
        if (a !== undefined || b !== undefined) best[difficulty] = Math.max(num(a), num(b));
      }
      stats[id].detail = { ...stats[id].detail, best_by_difficulty: best };
    }
  }
  const plays = new Map((cloud.plays ?? []).map((p) => [p.id, structuredClone(p)]));
  for (const p of local.plays ?? []) if (!plays.has(p.id)) plays.set(p.id, structuredClone(p));
  const saves = new Map((cloud.saves ?? []).map((s) => [s.game_id, structuredClone(s)]));
  for (const s of local.saves ?? []) if (!saves.has(s.game_id) || Date.parse(s.updated_at) > Date.parse(saves.get(s.game_id).updated_at)) saves.set(s.game_id, structuredClone(s));
  return { profile, stats, plays: [...plays.values()].sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at) || b.id.localeCompare(a.id)).slice(0, 50), saves: [...saves.values()] };
}

export function createAuth({
  url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY, fetch: request = globalThis.fetch,
  storage = globalThis.localStorage, sessionStorage = globalThis.sessionStorage,
  crypto = globalThis.crypto, location = globalThis.location, history = globalThis.history,
  now = Date.now, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout,
  win = globalThis.window, doc = globalThis.document, timeoutMs = REFRESH_TIMEOUT_MS,
} = {}) {
  let session = null;
  let disposed = false;
  let nextRetryAt = 0; // 暫時故障後的退避期限(ms);期限前不再發 refresh
  let deferred = false; // 隱藏頁到時間的 refresh 延到回到前景再做
  let timer;
  let refreshing;
  let message = '';
  let epoch = 0;
  const listeners = new Set();
  const emit = () => { for (const cb of listeners) cb({ session, message }); };
  const enabled = Boolean(url && key);
  const read = () => {
    try {
      const s = JSON.parse(storage.getItem(AUTH_KEY));
      return s?.access_token && s?.refresh_token && s?.user?.id && Number.isFinite(s.expires_at) ? s : null;
    } catch { return null; }
  };
  session = enabled ? read() : null;
  // 計時到期:隱藏頁不打 API(回前景再做),避免背景分頁在服務故障時持續重試。
  const fire = () => {
    if (disposed) return;
    if (doc?.hidden) { deferred = true; return; }
    refresh().catch(() => {});
  };
  const arm = (ms) => {
    clearTimer(timer);
    if (disposed) return;
    timer = setTimer(fire, ms);
    timer?.unref?.();
  };
  const schedule = () => {
    clearTimer(timer);
    if (session) arm(Math.max(1000, session.expires_at * 1000 - now() - 60000));
  };
  const clear = (text = '') => {
    epoch += 1;
    session = null;
    message = text;
    clearTimer(timer);
    try { storage.removeItem(AUTH_KEY); } catch { /* 記憶體仍登出 */ }
    try { sessionStorage.removeItem(MERGED_KEY); } catch { /* 下次照舊向雲端查 */ }
    emit();
  };
  // 換 token。逾時涵蓋整次請求(連線、讀本文、解析);分類見 isTransientError。
  // 畸形回應(缺欄位、壞 JSON、到期時間不是有限正數)視為失效。
  const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const token = async (grant, body) => {
    let timeoutId;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimer(() => { controller?.abort(); reject(Object.assign(new Error('連線逾時'), { transient: true })); }, timeoutMs);
      timeoutId?.unref?.();
    });
    const work = (async () => {
      let res;
      try {
        res = await request(`${url.replace(/\/$/, '')}/auth/v1/token?grant_type=${grant}`, {
          method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          ...(controller ? { signal: controller.signal } : {}),
        });
      } catch { throw Object.assign(new Error('暫時連不上帳號服務'), { transient: true }); }
      if (!res.ok) throw Object.assign(new Error('登入失效，請重新登入'), { status: res.status });
      let s;
      try { s = await res.json(); } catch (e) {
        // 解析失敗(SyntaxError)=畸形回應;讀本文中斷(TypeError/AbortError 等)=網路錯誤
        if (!(e instanceof SyntaxError)) throw Object.assign(new Error('暫時連不上帳號服務'), { transient: true, cause: e });
        s = null;
      }
      const at = s?.expires_at === undefined ? (positive(s?.expires_in) ? Math.floor(now() / 1000) + s.expires_in : null)
        : (positive(s.expires_at) ? s.expires_at : null);
      if (!s?.access_token || !s.refresh_token || !s.user?.id || at === null) throw new Error('登入回應不完整');
      // 不保存 provider token 或 email；帳號 UI 只需要 GitHub 名稱與頭像。
      const meta = s.user.user_metadata ?? {};
      return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: at,
        user: { id: s.user.id, user_metadata: { user_name: meta.user_name, preferred_username: meta.preferred_username,
          name: meta.name, avatar_url: meta.avatar_url } } };
    })();
    work.catch(() => {}); // 逾時後晚到的錯誤不成為未處理的 rejection
    try { return await Promise.race([work, timeout]); } finally { clearTimer(timeoutId); }
  };
  const save = (s) => {
    storage.setItem(AUTH_KEY, JSON.stringify(s));
    session = s;
    message = '';
    schedule();
    emit();
  };
  // IR30:暫時故障保留登入資料並退避重試(15 秒起倍增,上限 5 分鐘);只有確定失效才登出。
  // 之前任何失敗都清除,Supabase 短暫異常時玩家就被登出。
  let retries = 0;
  // 跨分頁共享退避期限:任一分頁遇到暫時故障,其他分頁在期限前也不重打。時間戳異常(比現在晚太多)不採用。
  const sharedRetryAt = () => {
    try {
      const at = Number(storage.getItem(RETRY_AT_KEY));
      return Number.isFinite(at) && at > 0 && at - now() <= RETRY_MAX_MS + CLOCK_SKEW_MS ? at : 0;
    } catch { return 0; }
  };
  const retryLater = () => {
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retries);
    retries += 1;
    nextRetryAt = now() + delay;
    try { storage.setItem(RETRY_AT_KEY, String(nextRetryAt)); } catch { /* 只有本分頁退避 */ }
    arm(delay);
  };
  const clearRetry = () => {
    retries = 0; nextRetryAt = 0;
    try { storage.removeItem(RETRY_AT_KEY); } catch { /* 期限會自然過去 */ }
  };
  // 多分頁協調:同一時間只讓一個分頁換 token(鎖存在 localStorage,20 秒逾時);其他分頁等 storage 事件。
  // 鎖的時間戳在未來(鎖齡 < 0,時鐘回撥等)或已逾時都視為無效。
  const lockHeldByOther = () => {
    try {
      const lock = JSON.parse(storage.getItem(REFRESH_LOCK_KEY));
      if (!lock || lock.owner === instanceId || typeof lock.at !== 'number' || !Number.isFinite(lock.at)) return false;
      const age = now() - lock.at;
      return age >= 0 && age < REFRESH_LOCK_MS;
    } catch { return false; }
  };
  const instanceId = Math.random().toString(36).slice(2);
  async function refresh() {
    if (!session || disposed) return session;
    if (refreshing) return refreshing;
    // 所有 refresh 入口(計時、accessToken、init)都套用:隱藏頁延到回前景、退避期限(含其他分頁的)、鎖。
    if (doc?.hidden) { deferred = true; return session; }
    // 退避期間:計時器重排到退避期限,否則本分頁的計時器已用掉、期限過後再也不會自動檢查登入。
    const retryAt = Math.max(nextRetryAt, sharedRetryAt());
    if (now() < retryAt) { arm(retryAt - now()); return session; }
    if (lockHeldByOther()) { arm(REFRESH_LOCK_MS); return session; }
    const oldEpoch = epoch;
    const oldSession = session;
    const run = async () => {
      try { storage.setItem(REFRESH_LOCK_KEY, JSON.stringify({ owner: instanceId, at: now() })); } catch { /* 無法協調仍可自行 refresh */ }
      try {
        const s = await token('refresh_token', { refresh_token: oldSession.refresh_token });
        if (disposed || epoch !== oldEpoch) return session;
        clearRetry();
        save(s);
      } catch (err) {
        if (disposed || epoch !== oldEpoch) return session;
        if (!isTransientError(err)) clear('登入失效，請重新登入');
        else {
          message = '暫時連不上帳號服務，稍後會自動重試';
          retryLater();
          emit();
        }
      } finally {
        try { if (JSON.parse(storage.getItem(REFRESH_LOCK_KEY))?.owner === instanceId) storage.removeItem(REFRESH_LOCK_KEY); } catch { /* 鎖會逾時失效 */ }
      }
      return session;
    };
    refreshing = run();
    try { return await refreshing; } finally { refreshing = null; }
  }
  const onVisible = () => {
    if (disposed || doc?.hidden || !deferred) return;
    deferred = false;
    refresh().catch(() => {});
  };
  doc?.addEventListener?.('visibilitychange', onVisible);
  schedule();
  const onStorage = (e) => {
    if (e.key !== AUTH_KEY && e.key !== null) return;
    epoch += 1;
    session = read();
    message = session ? '' : '已登出';
    retries = 0; nextRetryAt = 0; // 另一分頁已換到新 token 或登出:本分頁退避歸零(共享期限由換到 token 的分頁清除)
    schedule();
    emit();
  };
  win?.addEventListener?.('storage', onStorage);
  return {
    enabled,
    get session() { return session; },
    get message() { return message; },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async accessToken() {
      if (session && session.expires_at * 1000 - now() <= 60000) await refresh();
      // 暫時故障而未換到新 token:已過期的 token 不送出(避免被當成 401 而登出),回 null 讓呼叫端當作離線。
      if (session && session.expires_at * 1000 <= now()) return null;
      return session?.access_token ?? null;
    },
    refresh,
    async signIn(redirect = location.href, provider = 'github') {
      if (!enabled) throw new Error('尚未設定帳號功能');
      if (!['google', 'github'].includes(provider)) throw new Error('不支援的登入方式');
      const target = sameOriginRedirect(redirect, location.href);
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      sessionStorage.setItem(PKCE_KEY, verifier);
      const authorize = new URL(`${url.replace(/\/$/, '')}/auth/v1/authorize`);
      for (const [k, v] of Object.entries({ provider, redirect_to: target, code_challenge: challenge, code_challenge_method: 's256' })) authorize.searchParams.set(k, v);
      if (provider === 'google') {
        // 不跟隨到 Google；成功的 302 會是 opaque redirect，未啟用的 400 可讀錯誤。
        const res = await request(authorize.href, { redirect: 'manual', headers: { apikey: key } });
        if (!res.ok && res.type !== 'opaqueredirect') {
          const error = await res.json();
          const text = error.msg || error.message || error.error_description || '';
          if (/provider.*(?:not enabled|disabled|unsupported)|unsupported provider/i.test(text)) throw new Error('Google 登入尚未開放');
          throw new Error('登入未完成，請重新登入');
        }
      }
      sessionStorage.setItem('gc:pkce-provider', provider);
      location.assign(authorize.href);
      return authorize.href;
    },
    async init() {
      if (!enabled) return null;
      const current = new URL(location.href);
      const code = current.searchParams.get('code');
      const oauthError = current.searchParams.get('error_description') || current.searchParams.get('error');
      if (code || oauthError) {
        current.searchParams.delete('code');
        for (const k of ['error', 'error_description', 'error_code']) current.searchParams.delete(k);
        history.replaceState(null, '', current.href);
        const verifier = sessionStorage.getItem(PKCE_KEY);
        const provider = sessionStorage.getItem('gc:pkce-provider');
        sessionStorage.removeItem(PKCE_KEY);
        sessionStorage.removeItem('gc:pkce-provider');
        const startEpoch = epoch;
        try {
          if (provider === 'google' && /provider.*(?:not enabled|disabled|unsupported)|unsupported provider/i.test(oauthError ?? '')) throw new Error('Google 登入尚未開放');
          if (oauthError || !verifier) throw new Error('登入未完成，請重新登入');
          const s = await token('pkce', { auth_code: code, code_verifier: verifier });
          if (disposed || epoch !== startEpoch) return session; // dispose 或已登出後晚到的回應作廢
          save(s);
        } catch (err) {
          if (disposed || epoch !== startEpoch) return session;
          clear(err.message);
        }
      }
      if (disposed) return session;
      await this.accessToken();
      return session;
    },
    async signOut() {
      const access = session?.access_token;
      clear('已登出');
      try { sessionStorage.removeItem(PKCE_KEY); } catch { /* 無 PKCE 資料 */ }
      if (access) {
        try { await request(`${url.replace(/\/$/, '')}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${access}` } }); } catch { /* 本機登出已完成 */ }
      }
    },
    // dispose 後在途的 refresh 回應一律作廢(不存檔、不排重試、不通知)。
    dispose() {
      disposed = true; epoch += 1;
      clearTimer(timer);
      win?.removeEventListener?.('storage', onStorage);
      doc?.removeEventListener?.('visibilitychange', onVisible);
      listeners.clear();
    },
  };
}

let runtime;
export function getCloudRuntime() {
  if (!runtime) runtime = (async () => {
    const auth = createAuth();
    await auth.init();
    let previousNotice = '';
    try {
      previousNotice = globalThis.sessionStorage.getItem('gc:auth-notice') ?? '';
      globalThis.sessionStorage.removeItem('gc:auth-notice');
    } catch { /* 儲存不可用仍顯示這次登入結果 */ }
    return { auth, store: null, notice: auth.message || previousNotice };
  })();
  return runtime;
}

export async function prepareCloudStore({ auth, local, cloud, storage = globalThis.localStorage,
  choose, confirm = globalThis.confirm, now = Date.now, session = globalThis.sessionStorage } = {}) {
  const id = deviceId(storage);
  // 同一分頁換頁時不必每頁再問一次雲端「合併過沒」(IR32:大廳少等一個網路來回);讀不到記號就照舊查。
  const userId = auth?.session?.user?.id;
  const mark = `${userId}|${id}`;
  const remember = () => { try { if (userId) session?.setItem(MERGED_KEY, mark); } catch { /* 下次照舊查 */ } };
  try { if (userId && session?.getItem(MERGED_KEY) === mark) return ''; } catch { /* 照舊查 */ }
  if (await cloud.hasMergedDevice(id)) { remember(); return ''; }
  const localData = await local.exportAll();
  const cloudData = await cloud.exportAll(); // 讀取失敗不能當成「雲端是空的」
  const decision = firstLoginDecision(localData, cloudData);
  let notice = '';
  if (decision === 'upload') {
    await cloud.mergeDevice(id, localData, 'upload');
    notice = '已把這台裝置的紀錄存到帳號';
  } else if (decision === 'choose' && !choose) {
    // 使用者 10-11:登入後自動匯入瀏覽器中的紀錄 ⇒ 預設直接合併,不跳選擇框(每台裝置只合併一次)。
    await cloud.mergeDevice(id, localData);
    notice = '已把這台裝置的紀錄合併進帳號';
  } else if (decision === 'choose') {
    const choice = await choose();
    if (choice === 'local') {
      if (!confirm('確定用這台裝置的紀錄覆蓋帳號？帳號原紀錄將被取代。')) throw new Error('已取消覆蓋，請重新選擇紀錄');
      await cloud.mergeDevice(id, localData, 'overwrite');
      notice = '已把這台裝置的紀錄存到帳號';
    } else if (choice === 'cloud') {
      let stamp = now();
      while (storage.getItem(`gc:backup:${stamp}`) !== null) stamp += 1;
      storage.setItem(`gc:backup:${stamp}`, JSON.stringify(localData));
      await cloud.mergeDevice(id, localData, 'cloud');
      notice = '已使用帳號裡的紀錄，本機原紀錄已另存備份';
    } else if (choice === 'merge') {
      await cloud.mergeDevice(id, localData);
      notice = '已把這台裝置的紀錄合併進帳號';
    } else throw new Error('尚未選擇紀錄');
  } else {
    await cloud.mergeDevice(id, localData, 'cloud');
  }
  remember();
  return notice;
}

// 所有頁面共用首次登入對話框，遊戲不用加入帳號 UI。
export function chooseRecords(doc = globalThis.document) {
  return new Promise((resolve) => {
    const dialog = doc.createElement('dialog');
    dialog.className = 'cloud-choice';
    const title = doc.createElement('h2');
    title.textContent = '選擇要使用的紀錄';
    const note = doc.createElement('p');
    note.textContent = '帳號與這台裝置都有紀錄，建議合併進帳號。';
    dialog.append(title, note);
    for (const [value, label] of [['merge', '把這台裝置的紀錄合併進帳號（建議）'], ['cloud', '只用帳號裡的紀錄'], ['local', '用這台裝置的紀錄覆蓋帳號']]) {
      const button = doc.createElement('button');
      button.className = 'btn';
      button.textContent = label;
      button.type = 'button';
      if (value === 'merge') button.autofocus = true;
      button.addEventListener('click', () => { dialog.close(); dialog.remove(); resolve(value); });
      dialog.append(button);
    }
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    doc.body.append(dialog);
    dialog.showModal();
  });
}

export function watchProfileIdentity(auth, rebuild = () => globalThis.location.reload()) {
  const userId = auth.session?.user.id ?? null;
  let changed = false;
  const unsubscribe = auth.subscribe(({ session, message }) => {
    if ((session?.user.id ?? null) === userId || changed) return;
    changed = true;
    rebuild(message || '帳號已變更');
  });
  return { get changed() { return changed; }, unsubscribe };
}

// 雲端適配器提供重算所需的即時獎勵與回傳明細，既有 profile 結算規則保持不動。
export async function createCloudProfile(options, factory) {
  const api = await factory(options);
  const store = options.store;
  store.finishRewards = (gameId) => api.liveRewards(gameId);
  const finish = api.finishPlay.bind(api);
  api.finishPlay = async (gameId, input) => {
    const result = await finish(gameId, input);
    const accepted = store.lastFinish.get(gameId);
    const out = accepted?.recomputed;
    return { ...result, ...(out && !result.duplicate ? { xpGained: out.xpGained, xpBreakdown: out.xpBreakdown,
      newAchievements: out.newAchievements } : {}), level: accepted?.level ?? result.level };
  };
  return api;
}

// 準備雲端紀錄失敗時,只有「登入已失效或伺服器拒絕」才登出(IR30);分類與 refresh 相同(isTransientError):
// 網路錯誤、逾時、408、429、5xx、暫時換不到 token 保留登入;其他 4xx、畸形回應(JSON 壞掉、欄位或型別不對)等視為失效。
export function cloudRejected(err, auth) {
  if (!auth?.session) return true;
  return !isTransientError(err);
}

export async function selectCloudStore(local) {
  const rt = await getCloudRuntime();
  rt.identity ??= watchProfileIdentity(rt.auth, (message) => {
    rt.store?.dispose();
    try { globalThis.sessionStorage.setItem('gc:auth-notice', message); } catch { /* 下頁仍顯示狀態 */ }
    globalThis.location.reload();
  });
  const guarded = (store) => new Proxy(store, {
    get(target, name) {
      const value = target[name];
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (rt.identity.changed) throw new Error('帳號已變更，請重新整理');
        return value.apply(target, args);
      };
    },
  });
  const showNotice = () => {
    const doc = globalThis.document;
    if (!rt.notice || !doc || doc.getElementById('account') || doc.getElementById('account-link')) return;
    let status = doc.getElementById('cloud-notice');
    if (!status) {
      status = doc.createElement('p');
      status.id = 'cloud-notice';
      status.setAttribute('role', 'status');
      const header = doc.querySelector('.topbar');
      if (header) header.after(status);
      else doc.body.prepend(status);
    }
    status.textContent = rt.notice;
  };
  if (!rt.auth.session) { showNotice(); return guarded(local); }
  if (!rt.store) {
    const { SupabaseStore } = await import('./stores/supabase.js?v=e2da0a7');
    rt.store = new SupabaseStore({ auth: rt.auth });
    try {
      rt.notice = await prepareCloudStore({ auth: rt.auth, local, cloud: rt.store });
    } catch (err) {
      console.error('[cloud] 登入後準備雲端紀錄失敗', err);
      rt.store.dispose();
      rt.store = null;
      if (cloudRejected(err, rt.auth)) {
        await rt.auth.signOut();
        rt.notice = `登入後讀取帳號紀錄失敗:${err.message}`;
        showNotice();
        return guarded(local);
      }
      // IR30:網路中斷或服務暫時異常 ⇒ 保留登入,本頁只存這台裝置;結算時提示「這局沒有上傳到雲端」。
      // ⛔ 不自動補送:現行結算 RPC 會刪該款雲端存檔,不改後端無法安全補送(PM 裁)。
      rt.notice = '暫時連不上帳號服務,這一頁的紀錄只存在這台裝置';
      markCloudOffline();
      showNotice();
      return guarded(local);
    }
  }
  showNotice();
  return guarded(rt.store);
}
