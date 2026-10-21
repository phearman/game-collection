import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js?v=821ea37';

export const LINK_STATUS = {
  invalid: '綁定連結無效或已被替換,請重新私訊 #綁定。',
  expired: '綁定連結已超過 10 分鐘,請重新私訊 #綁定。',
  used: '這個綁定連結已使用,請重新私訊 #綁定。',
  linked: '✅ 已綁定,回到 LINE 私訊 #成績 試試',
};

export function createLineLinkClient({ auth, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY,
  fetch: request = globalThis.fetch } = {}) {
  let identityEpoch = 0;
  let identity = auth?.session?.user.id;
  auth?.subscribe(() => {
    const next = auth.session?.user.id;
    if (next !== identity) { identityEpoch += 1; identity = next; }
  });
  async function call(path, body) {
    const owner = auth?.session?.user.id;
    const epoch = identityEpoch;
    const check = () => {
      if (!owner || auth.session?.user.id !== owner || epoch !== identityEpoch) throw new Error('登入狀態已變更,請重新整理後再試');
    };
    if (!owner) throw new Error('請先用 Google 或 GitHub 登入');
    const token = await auth.accessToken();
    check();
    if (!token) throw new Error('請重新登入後再試');
    if (!url || !key) throw new Error('帳號功能尚未開放');
    let response;
    try {
      response = await request(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        referrerPolicy: 'no-referrer',
      });
    } catch { throw new Error('連線失敗,請稍後重試'); }
    check();
    const raw = response.status === 204 ? '' : await response.text();
    check();
    if (!response.ok) throw new Error([401, 403].includes(response.status) ? '請重新登入後再試' : 'LINE 綁定服務暫時無法使用,請稍後重試');
    try { return raw ? JSON.parse(raw) : null; } catch { throw new Error('LINE 綁定服務回應無效,請稍後重試'); }
  }
  const tokenCall = (rpc, token) => /^[0-9a-f]{64}$/.test(token ?? '')
    ? call(`rpc/${rpc}`, { p_token: token }) : Promise.resolve({ status: 'invalid' });
  return {
    preview: (token) => tokenCall('preview_line_link', token),
    claim: (token) => tokenCall('claim_line_link', token),
    unlink: () => call('rpc/unlink_my_line', {}),
    async status() {
      const query = new URLSearchParams({ select: 'display_name,linked_at', user_id: `eq.${auth?.session?.user.id}`, limit: '1' });
      return (await call(`line_account_links?${query}`))?.[0] ?? null;
    },
  };
}

export function initLineLinkStatus({ doc, auth, client = createLineLinkClient({ auth }), ask = globalThis.confirm }) {
  const status = doc.getElementById('line-link-status');
  const button = doc.getElementById('unlink-line');
  let epoch = 0;
  let busy = false;
  const render = async () => {
    const current = ++epoch;
    button.hidden = true;
    status.textContent = '';
    if (!auth.session) return;
    status.textContent = '正在讀取 LINE 綁定狀態…';
    try {
      const link = await client.status();
      if (current !== epoch) return;
      status.textContent = link ? `已綁定 LINE:${link.display_name || '玩家'}` : '在 LINE 私訊「遊戲集錦回饋」#綁定 即可綁定';
      button.hidden = !link;
    } catch (err) { if (current === epoch) status.textContent = err.message; }
  };
  button.addEventListener('click', async () => {
    if (busy || !auth.session || !ask('要解除 LINE 綁定並退出所有群組排行嗎?')) return;
    busy = true; button.disabled = true;
    const current = epoch;
    try { await client.unlink(); if (current === epoch) await render(); }
    catch (err) { if (current === epoch) status.textContent = err.message; }
    finally { busy = false; button.disabled = false; }
  });
  const unsubscribe = auth.subscribe(render);
  void render();
  return unsubscribe;
}
