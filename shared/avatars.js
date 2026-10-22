import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js?v=bb80cea';

// 排行頭像(RS33):固定 24 個 emoji(動物/食物/運動;⛔ 人臉膚色、旗幟)。
// 順序與資料庫 migration 202610130010 的 public.avatar_emojis() 必須一致(測試比對)。
export const AVATAR_EMOJIS = [
  '🐶', '🐱', '🐼', '🐨', '🦊', '🐯', '🦁', '🐸', '🐵', '🐧', '🐢', '🐙',
  '🍎', '🍉', '🍓', '🍩', '🍕', '🍙',
  '⚽', '🏀', '⚾', '🎾', '🏓', '🎳',
];
// 登入頭像只接受這些網域的 https 網址;其他一律退回 emoji。
export const LOGIN_AVATAR_HOSTS = ['lh3.googleusercontent.com', 'avatars.githubusercontent.com'];

export function safeAvatarUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && LOGIN_AVATAR_HOSTS.includes(url.hostname) && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

// 沒選過的人:SHA-256(user_id) 前兩個 byte 取餘數,與資料庫同一算法,LINE 排行與 me/ 顯示一致。
export async function defaultEmoji(userId, subtle = globalThis.crypto.subtle) {
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(String(userId))));
  return AVATAR_EMOJIS[(digest[0] * 256 + digest[1]) % AVATAR_EMOJIS.length];
}

// settings = { emoji, use_login_avatar }(沒有設定可傳 null);loginUrl = 登入資料提供的頭像網址。
// → { emoji, url }:url 只在開關打開且網址合法時有值,畫面優先用 url、讀不到時用 emoji。
export async function avatarFor(settings, userId, loginUrl) {
  const chosen = AVATAR_EMOJIS.includes(settings?.emoji) ? settings.emoji : await defaultEmoji(userId);
  return { emoji: chosen, url: settings?.use_login_avatar === true ? safeAvatarUrl(loginUrl) : null };
}

export function createAvatarClient({ auth, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY, fetch: request = globalThis.fetch } = {}) {
  async function rpc(name, body) {
    const owner = auth?.session?.user.id;
    if (!owner) throw new Error('請先用 Google 或 GitHub 登入');
    const token = await auth.accessToken();
    if (!token || auth.session?.user.id !== owner) throw new Error('請重新登入後再試');
    if (!url || !key) throw new Error('帳號功能尚未開放');
    let response;
    try {
      response = await request(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        referrerPolicy: 'no-referrer',
      });
    } catch { throw new Error('連線失敗,請稍後重試'); }
    if (auth.session?.user.id !== owner) throw new Error('登入狀態已變更,請重新整理後再試');
    const raw = response.status === 204 ? '' : await response.text();
    // 404 = 資料庫還沒套用頭像 migration(RPC 不存在):標記 unavailable,畫面退回 emoji、停用設定、不顯示錯誤。
    if (response.status === 404) throw Object.assign(new Error('頭像設定尚未開放'), { unavailable: true });
    if (!response.ok) throw new Error([401, 403].includes(response.status) ? '請重新登入後再試' : '頭像設定暫時無法使用,請稍後重試');
    try { return raw ? JSON.parse(raw) : null; } catch { throw new Error('頭像設定回應無效,請稍後重試'); }
  }
  return {
    get: () => rpc('my_avatar', {}),
    save: (emoji, useLoginAvatar) => rpc('set_my_avatar', { p_emoji: emoji, p_use_login_avatar: useLoginAvatar === true }),
  };
}

// me/ 帳號區塊的「排行頭像」:顯示目前頭像、24 格選擇面板、使用登入頭像開關。動態內容一律 textContent/屬性。
export function initAvatarPicker({ doc, auth, client = createAvatarClient({ auth }) }) {
  const $ = (id) => doc.getElementById(id);
  const box = $('avatar-box'), signedOut = $('avatar-signed-out'), current = $('avatar-current');
  const grid = $('avatar-grid'), change = $('avatar-change'), toggle = $('avatar-login'), msg = $('avatar-msg');
  // seq:讀取與儲存共用的版本序號;每次 GET/儲存/換帳號都 +1,非同步回來時序號或帳號不符就丟棄(避免舊 GET 蓋掉新儲存)。
  // ready:設定已讀到才可操作;讀取中、儲存中、資料庫未開放(404)時控制項全部停用。
  let settings = null, seq = 0, owner = null, ready = false, busy = false, started = false;
  const loginUrl = () => auth.session?.user.user_metadata?.avatar_url;
  const stale = (mySeq, myOwner) => mySeq !== seq || myOwner !== auth.session?.user.id;
  const setEnabled = () => {
    const on = ready && !busy;
    change.disabled = !on; toggle.disabled = !on;
    for (const button of grid.children) button.disabled = !on;
    if (!on) { grid.hidden = true; change.setAttribute('aria-expanded', 'false'); }
  };
  const clearPreview = () => {
    current.replaceChildren(); current.textContent = '';
    toggle.checked = false;
    for (const button of grid.children) button.setAttribute('aria-checked', 'false');
  };

  const show = async (mySeq = seq, myOwner = owner) => {
    if (!myOwner) return;
    const avatar = await avatarFor(settings, myOwner, loginUrl());
    if (stale(mySeq, myOwner)) return;
    current.replaceChildren();
    if (avatar.url) {
      const img = doc.createElement('img');
      Object.assign(img, { src: avatar.url, alt: '登入頭像', width: 40, height: 40, referrerPolicy: 'no-referrer' });
      // 圖片載入失敗才退回 emoji;回呼時若已換帳號、版本已變或圖片已被換掉就不動畫面。
      img.addEventListener?.('error', () => {
        if (!stale(mySeq, myOwner) && current.children[0] === img) current.textContent = avatar.emoji;
      });
      current.append(img);
    } else current.textContent = avatar.emoji;
    toggle.checked = settings?.use_login_avatar === true;
    for (const button of grid.children) button.setAttribute('aria-checked', String(button.dataset.emoji === avatar.emoji && !avatar.url));
  };
  const save = async (emoji, useLogin) => {
    if (!ready || busy || !owner || owner !== auth.session?.user.id) return;
    const mySeq = ++seq, myOwner = owner;
    busy = true; setEnabled();
    msg.textContent = '儲存中…';
    try {
      const next = await client.save(emoji, useLogin);
      if (stale(mySeq, myOwner)) return;
      settings = next ?? { emoji, use_login_avatar: useLogin };
      msg.textContent = '已儲存';
    } catch (err) {
      if (stale(mySeq, myOwner)) return;
      if (err?.unavailable) {
        // 資料庫未開放(404):與讀取時相同,退回 emoji、停用設定、不顯示錯誤。
        settings = null; ready = false; msg.textContent = '';
      } else msg.textContent = err.message; // 其他失敗:設定維持儲存前的值,畫面(含開關)復原。
    } finally {
      if (!stale(mySeq, myOwner)) { busy = false; setEnabled(); }
    }
    await show(mySeq, myOwner);
  };

  grid.replaceChildren(...AVATAR_EMOJIS.map((emoji) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'avatar-choice';
    button.dataset.emoji = emoji;
    button.textContent = emoji;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.setAttribute('aria-label', `選擇 ${emoji}`);
    button.addEventListener('click', () => {
      grid.hidden = true; change.setAttribute('aria-expanded', 'false');
      return save(emoji, settings?.use_login_avatar === true);
    });
    return button;
  }));
  change.addEventListener('click', () => {
    grid.hidden = !grid.hidden;
    change.setAttribute('aria-expanded', String(!grid.hidden));
  });
  toggle.addEventListener('change', () => save(AVATAR_EMOJIS.includes(settings?.emoji) ? settings.emoji : null, toggle.checked));

  const render = async () => {
    const next = auth.session?.user.id ?? null;
    // 同一帳號(例如權杖刷新)不重新讀取,免得較晚的讀取蓋掉剛儲存的設定。
    if (started && next === owner && (ready || busy || next === null)) return;
    started = true;
    const mySeq = ++seq;
    owner = next; settings = null; ready = false; busy = false;
    msg.textContent = '';
    clearPreview(); setEnabled();
    box.hidden = !owner; signedOut.hidden = Boolean(owner);
    if (!owner) return;
    const myOwner = owner;
    try {
      const loaded = await client.get();
      if (stale(mySeq, myOwner)) return;
      settings = loaded; ready = true;
    } catch (err) {
      if (stale(mySeq, myOwner)) return;
      // 資料庫未開放頭像:退回 emoji、保持停用、不顯示錯誤;其他錯誤顯示訊息,同樣停用。
      if (!err?.unavailable) msg.textContent = err.message;
    }
    setEnabled();
    await show(mySeq, myOwner);
  };
  const unsubscribe = auth.subscribe(render);
  void render();
  return unsubscribe;
}
