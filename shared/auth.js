import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js?v=4a02c9a';
import { levelFor } from './progress.js?v=4a02c9a';

const AUTH_KEY = 'gc:auth';
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

// 與 merge_device SQL 相同的規則，供預覽與測試使用；正式合併在伺服器交易內重算。
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
  win = globalThis.window,
} = {}) {
  let session = null;
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
  const schedule = () => {
    clearTimer(timer);
    if (session) {
      timer = setTimer(() => { refresh().catch(() => {}); }, Math.max(1000, session.expires_at * 1000 - now() - 60000));
      timer?.unref?.();
    }
  };
  const clear = (text = '') => {
    epoch += 1;
    session = null;
    message = text;
    clearTimer(timer);
    try { storage.removeItem(AUTH_KEY); } catch { /* 記憶體仍登出 */ }
    emit();
  };
  const token = async (grant, body) => {
    const res = await request(`${url.replace(/\/$/, '')}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('登入失效，請重新登入');
    const s = await res.json();
    if (!s.access_token || !s.refresh_token || !s.user?.id || !(s.expires_in > 0 || s.expires_at > 0)) throw new Error('登入回應不完整');
    // 不保存 provider token 或 email；帳號 UI 只需要 GitHub 名稱與頭像。
    const meta = s.user.user_metadata ?? {};
    return { access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at ?? Math.floor(now() / 1000) + s.expires_in,
      user: { id: s.user.id, user_metadata: { user_name: meta.user_name, preferred_username: meta.preferred_username,
        name: meta.name, avatar_url: meta.avatar_url } } };
  };
  const save = (s) => {
    storage.setItem(AUTH_KEY, JSON.stringify(s));
    session = s;
    message = '';
    schedule();
    emit();
  };
  async function refresh() {
    if (!session) return null;
    if (refreshing) return refreshing;
    const oldEpoch = epoch;
    const oldSession = session;
    const run = async () => {
      try {
        const s = await token('refresh_token', { refresh_token: oldSession.refresh_token });
        if (epoch === oldEpoch) save(s);
      } catch {
        if (epoch === oldEpoch) clear('登入失效，請重新登入');
      }
      return session;
    };
    refreshing = run();
    try { return await refreshing; } finally { refreshing = null; }
  }
  schedule();
  const onStorage = (e) => {
    if (e.key !== AUTH_KEY && e.key !== null) return;
    epoch += 1;
    session = read();
    message = session ? '' : '已登出';
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
        try {
          if (provider === 'google' && /provider.*(?:not enabled|disabled|unsupported)|unsupported provider/i.test(oauthError ?? '')) throw new Error('Google 登入尚未開放');
          if (oauthError || !verifier) throw new Error('登入未完成，請重新登入');
          save(await token('pkce', { auth_code: code, code_verifier: verifier }));
        } catch (err) { clear(err.message); }
      }
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
    dispose() { clearTimer(timer); win?.removeEventListener?.('storage', onStorage); listeners.clear(); },
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
  choose, confirm = globalThis.confirm, now = Date.now } = {}) {
  const id = deviceId(storage);
  if (await cloud.hasMergedDevice(id)) return '';
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
    return { ...result, ...(out ? { xpGained: out.xpGained, xpBreakdown: out.xpBreakdown,
      newAchievements: out.newAchievements } : {}), level: accepted?.level ?? result.level };
  };
  return api;
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
    const { SupabaseStore } = await import('./stores/supabase.js?v=4a02c9a');
    rt.store = new SupabaseStore({ auth: rt.auth });
    try {
      rt.notice = await prepareCloudStore({ auth: rt.auth, local, cloud: rt.store });
    } catch (err) {
      console.error('[cloud] 登入後準備雲端紀錄失敗', err);
      rt.store.dispose();
      rt.store = null;
      await rt.auth.signOut();
      rt.notice = `登入後讀取帳號紀錄失敗:${err.message}`;
      showNotice();
      return guarded(local);
    }
  }
  showNotice();
  return guarded(rt.store);
}
