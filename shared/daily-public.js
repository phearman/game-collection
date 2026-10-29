import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, cloudEnabled } from './supabase-config.js?v=09d8276';
import { DAILY_GAMES, DAILY_NAMES, dailyDateLabel, dailyScore } from './daily.js?v=09d8276';
import { formatDuration } from './duration.js?v=09d8276';
import { safeAvatarUrl } from './avatars.js?v=09d8276';

// 網站今日挑戰排行(RS98 預設公開)。暱稱仍沿用 RS78 R3。
export const PUBLIC_RANK_NOTE = '預設公開;你的今日挑戰成績會用這個暱稱和排行頭像出現在網站今日排行,所有人都看得到。關閉後立即從排行移除。';
export const PUBLIC_RANK_EMPTY = '今天還沒有可公開的上榜成績';
export const PUBLIC_RANK_LIMIT = 50;
export const PUBLIC_RANK_NOTICE = '你的今日挑戰成績現在預設公開,可在『我的紀錄』關閉';
export const PUBLIC_RANK_NOTICE_KEY = 'gc:daily-public-notice:rs98';

// 只在瀏覽器記「知道了」,不保存帳號資訊;儲存被封鎖仍可關閉並繼續使用頁面。
export function createDailyPublicNotice({ doc, meLink = '../me/', storage = () => globalThis.localStorage }) {
  const box = doc.getElementById('daily-public-notice');
  let dismissed = false;
  try { dismissed = storage()?.getItem(PUBLIC_RANK_NOTICE_KEY) === '1'; } catch { /* 儲存不可用 */ }
  return (settings) => {
    if (!box) return;
    try { dismissed ||= storage()?.getItem(PUBLIC_RANK_NOTICE_KEY) === '1'; } catch { /* 儲存不可用 */ }
    box.hidden = dismissed || settings?.default_public !== true;
    box.replaceChildren();
    if (box.hidden) return;
    const note = doc.createElement('p'); note.textContent = PUBLIC_RANK_NOTICE;
    const link = doc.createElement('a'); link.href = meLink; link.textContent = '我的紀錄';
    const close = doc.createElement('button'); close.type = 'button'; close.className = 'btn'; close.textContent = '知道了';
    close.addEventListener('click', () => {
      dismissed = true; box.hidden = true;
      try { storage()?.setItem(PUBLIC_RANK_NOTICE_KEY, '1'); } catch { /* 儲存不可用 */ }
    });
    box.append(note, link, ' ', close);
  };
}

export function initDailyPublicNotice({ doc, auth, client = createDailyPublicClient({ auth }), meLink, storage }) {
  const show = createDailyPublicNotice({ doc, meLink, storage });
  let seq = 0;
  const render = async () => {
    const version = ++seq, owner = auth.session?.user.id;
    show(null);
    if (!owner) return;
    try {
      const settings = await client.get();
      if (version === seq && owner === auth.session?.user.id) show(settings);
    } catch { /* 提示載入失敗不擋頁面,也不推測公開狀態 */ }
  };
  const unsubscribe = auth.subscribe(render);
  void render();
  return () => { seq++; unsubscribe(); show(null); };
}

// 去頭尾空白用 JS 的 \s(含全形空白 U+3000、NBSP 等),資料庫 daily_public_trim 用同一組字元。
// 控制字元與換行整串檢查(含頭尾),兩邊結果才會一致。
export const cleanNickname = (raw) => String(raw ?? '').replace(/^\s+|\s+$/gu, '');
export function nicknameError(raw, { allowEmpty = false } = {}) {
  const text = String(raw ?? '');
  if (/[\p{Cc}\u2028\u2029]/u.test(text)) return '暱稱不能有換行或控制字元';
  const name = cleanNickname(text);
  if (!name) return allowEmpty ? null : '請先填暱稱';
  if ([...name].length > 10) return '暱稱最多 10 個字';
  // 網址:含 ://、www.,或「英數字.英文字母 2 個以上」(x.cn、a.dev、a.company;接受少數誤擋如 Mr.Bean)。
  if (/:\/\/|www\./i.test(name) || /[A-Za-z0-9]\.[A-Za-z]{2,}/.test(name)) return '暱稱不能放網址';
  if (/[@＠]/u.test(name)) return '暱稱不能有 @';
  if (/[0-9０-９]{6,}/u.test(name)) return '暱稱不能有連續 6 位以上的數字';
  return null;
}

const SERVER_ERRORS = { INVALID_NICKNAME: '暱稱不符合規則' };

// rank:未登入也能看(只帶 publishable key);登入者帶自己的權杖,伺服器另回自己的名次。
// get/save:只限登入者本人(RPC)。404 = 資料庫尚未開放,標記 unavailable。
export function createDailyPublicClient({ auth, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY, fetch: request = globalThis.fetch } = {}) {
  const base = () => `${String(url).replace(/\/$/, '')}/rest/v1/`;
  async function send(path, { body, login = false } = {}) {
    if (!url || !key) throw Object.assign(new Error('今日排行尚未開放'), { unavailable: true });
    const owner = auth?.session?.user.id ?? null;
    if (login && !owner) throw new Error('請先用 Google 或 GitHub 登入');
    const token = owner ? await auth.accessToken() : null;
    if (login && !token) throw new Error('請重新登入後再試');
    if ((auth?.session?.user.id ?? null) !== owner) throw new Error('登入狀態已變更,請重新整理後再試');
    let response;
    try {
      response = await request(base() + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        referrerPolicy: 'no-referrer',
      });
    } catch { throw new Error('連線失敗,請稍後重試'); }
    if ((auth?.session?.user.id ?? null) !== owner) throw new Error('登入狀態已變更,請重新整理後再試');
    const raw = response.status === 204 ? '' : await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error('今日排行回應無效,請稍後重試'); }
    if (response.status === 404) throw Object.assign(new Error('今日排行尚未開放'), { unavailable: true });
    if (!response.ok) throw new Error(SERVER_ERRORS[data?.message]
      ?? ([401, 403].includes(response.status) ? '請重新登入後再試' : '今日排行暫時無法使用,請稍後重試'));
    return data;
  }
  return {
    rank: (game) => send('rpc/daily_public_rank', { body: { p_game_id: game } }),
    get: () => send('rpc/daily_public_profile', { body: {}, login: true }),
    save: (enabled, nickname) => send('rpc/daily_public_set', { body: { p_enabled: enabled === true, p_nickname: nickname ?? null }, login: true }),
  };
}
export async function browserDailyPublicClient() {
  if (!cloudEnabled) return createDailyPublicClient();
  const { auth } = await (await import('./auth.js?v=09d8276')).getCloudRuntime();
  return createDailyPublicClient({ auth });
}

// daily-rank/ 頁(R5~R9):分頁籤 = 今日挑戰遊戲清單(DAILY_GAMES,日後加遊戲自動出現);未登入也能看。
export function mountDailyRank({ doc, client, games = DAILY_GAMES, loggedIn = () => false, meLink = '../me/' }) {
  const $ = (id) => doc.getElementById(id);
  const tabs = $('tabs'), panel = $('panel'), me = $('me'), list = $('list'), empty = $('empty'), dayLabel = $('day-label');
  let current = null, seq = 0;
  const buttons = games.map((game, i) => {
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'btn'; button.id = `tab-${game}`; button.dataset.game = game;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'panel');
    button.textContent = DAILY_NAMES[game] ?? game;
    button.addEventListener('click', () => select(game));
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? games.length - 1 : step ? (i + step + games.length) % games.length : -1;
      if (target < 0) return;
      event.preventDefault?.(); select(games[target]); buttons[target].focus?.();
    });
    return button;
  });
  tabs.replaceChildren(...buttons);
  const row = (r) => {
    const li = doc.createElement('li'); li.dataset.game = current;
    const place = doc.createElement('span'); place.className = 'daily-rank-place'; place.textContent = `${r.place}`;
    const avatar = doc.createElement('span'); avatar.className = 'daily-rank-avatar';
    const url = safeAvatarUrl(r.avatar?.url);
    const emoji = typeof r.avatar?.emoji === 'string' ? r.avatar.emoji : '🙂';
    if (url) {
      const img = doc.createElement('img');
      Object.assign(img, { src: url, alt: '', width: 36, height: 36, referrerPolicy: 'no-referrer' });
      img.addEventListener?.('error', () => { avatar.textContent = emoji; });
      avatar.append(img);
    } else avatar.textContent = emoji;
    const name = doc.createElement('span'); name.className = 'daily-rank-name'; name.textContent = String(r.nickname ?? '');
    const score = doc.createElement('span'); score.className = 'daily-rank-score'; score.textContent = current === 'memory' ? dailyScore({ ...r, game_id: current, detail: { misses: r.misses } }) : formatDuration(r.seconds);
    li.append(place, avatar, name, score);
    return li;
  };
  const showMe = (data) => {
    me.replaceChildren();
    if (!data?.me) { me.hidden = true; return; }
    me.hidden = false;
    if (data.me.public && data.me.place) { me.textContent = `你今天的名次:第 ${data.me.place} 名`; return; }
    me.append(data.me.public ? '你今天還沒有上榜的成績' : '你的成績沒有公開 · ');
    if (!data.me.public) {
      const a = doc.createElement('a'); a.href = meLink; a.textContent = '到我的紀錄設定'; me.append(a);
    }
  };
  async function select(game) {
    current = game;
    const mySeq = ++seq;
    for (const b of buttons) {
      const on = b.dataset.game === game;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `tab-${game}`);
    list.hidden = true; empty.hidden = false; empty.textContent = '讀取中…'; me.textContent = '';
    try {
      const data = await client.rank(game);
      if (mySeq !== seq) return;
      if (data?.day) dayLabel.textContent = `${dailyDateLabel(data.day)} 今日挑戰 · 成績預設公開,可在「我的紀錄」關閉,每款最多 ${PUBLIC_RANK_LIMIT} 名。`;
      const rows = Array.isArray(data?.rows) ? data.rows.slice(0, PUBLIC_RANK_LIMIT) : [];
      list.replaceChildren(...rows.map(row));
      list.hidden = !rows.length; empty.hidden = Boolean(rows.length); empty.textContent = rows.length ? '' : PUBLIC_RANK_EMPTY;
      showMe(loggedIn() ? data : null);
    } catch (err) {
      if (mySeq !== seq) return;
      list.hidden = true; empty.hidden = false; empty.textContent = err.message; showMe(null);
    }
  }
  return { select, ready: select(games[0]), get current() { return current; } };
}

// me/ 帳號區塊的「今日挑戰排行」設定(R1~R3)。動態內容一律 textContent/屬性。
export function initDailyPublic({ doc, auth, client = createDailyPublicClient({ auth }) }) {
  const $ = (id) => doc.getElementById(id);
  const box = $('daily-public-box'), signedOut = $('daily-public-signed-out');
  const toggle = $('daily-public-on'), name = $('daily-public-name'), saveBtn = $('daily-public-save'), msg = $('daily-public-msg');
  const showNotice = createDailyPublicNotice({ doc });
  let settings = null, seq = 0, owner = null, ready = false, busy = false, started = false;
  const stale = (mySeq, myOwner) => mySeq !== seq || myOwner !== auth.session?.user.id;
  const setEnabled = () => { const on = ready && !busy; toggle.disabled = !on; name.disabled = !on; saveBtn.disabled = !on; };
  const show = () => { toggle.checked = settings?.enabled === true; name.value = settings?.nickname ?? ''; };
  const save = async (enabled) => {
    if (!ready || busy || !owner || owner !== auth.session?.user.id) return;
    // 關閉公開一律直接送出(R13 立即移除),⛔ 被欄位裡尚未儲存的暱稱擋住;暱稱不送,伺服器保留已存的。
    if (enabled) {
      const error = nicknameError(name.value, { allowEmpty: true });
      if (error) { msg.textContent = error; toggle.checked = settings?.enabled === true; return; }
    }
    const mySeq = ++seq, myOwner = owner;
    busy = true; setEnabled(); msg.textContent = '儲存中…';
    try {
      const next = await client.save(enabled, enabled ? cleanNickname(name.value) : null);
      if (stale(mySeq, myOwner)) return;
      settings = next ?? { enabled, nickname: cleanNickname(name.value) || null };
      showNotice(settings);
      msg.textContent = settings.enabled ? '已公開,今日挑戰成績會出現在今日排行' : '已儲存,你的成績沒有公開';
    } catch (err) {
      if (stale(mySeq, myOwner)) return;
      if (err?.unavailable) { ready = false; msg.textContent = ''; } else msg.textContent = err.message;
    } finally {
      if (!stale(mySeq, myOwner)) { busy = false; setEnabled(); show(); }
    }
  };
  toggle.addEventListener('change', () => save(toggle.checked));
  saveBtn.addEventListener('click', () => save(toggle.checked));

  const render = async () => {
    const next = auth.session?.user.id ?? null;
    if (started && next === owner && (ready || busy || next === null)) return;
    started = true;
    const mySeq = ++seq;
    owner = next; settings = null; ready = false; busy = false; msg.textContent = '';
    showNotice(null);
    show(); setEnabled();
    box.hidden = !owner; signedOut.hidden = Boolean(owner);
    if (!owner) return;
    const myOwner = owner;
    try {
      const loaded = await client.get();
      if (stale(mySeq, myOwner)) return;
      settings = loaded; ready = true;
      showNotice(settings);
    } catch (err) {
      if (stale(mySeq, myOwner)) return;
      if (!err?.unavailable) msg.textContent = err.message;
    }
    setEnabled(); show();
  };
  const unsubscribe = auth.subscribe(render);
  void render();
  return unsubscribe;
}
