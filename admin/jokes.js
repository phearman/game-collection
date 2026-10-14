import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=795425d';
import { element } from '../shared/feedback.js?v=795425d';

export const JOKE_CATEGORIES = ['物品', '動物', '校園', '諧音', '生活'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createJokesClient({ auth, client, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY,
  fetch: request = globalThis.fetch } = {}) {
  async function requireAdmin() {
    const id = auth?.session?.user.id;
    if (!id || await client.isAdmin() !== true || auth.session?.user.id !== id) throw new Error('沒有權限');
    return id;
  }
  async function call(id, path, body) {
    const token = await auth.accessToken();
    if (!token || auth.session?.user.id !== id) throw new Error('沒有權限');
    let response;
    try {
      response = await request(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('連線失敗，請稍後重試'); }
    if (auth.session?.user.id !== id) throw new Error('沒有權限');
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('沒有權限');
      let error; try { error = await response.json(); } catch { /* Never display raw API text. */ }
      if (error?.message === 'LINE_JOKE_CHANGED') throw new Error('這則笑話已變更，請重新載入');
      throw new Error('笑話服務暫時無法使用，請稍後重試');
    }
    let data;
    try { data = response.status === 204 ? null : await response.json(); }
    catch { throw new Error('笑話服務暫時無法使用，請稍後重試'); }
    if (auth.session?.user.id !== id) throw new Error('沒有權限');
    return data;
  }
  return {
    async list() {
      const id = await requireAdmin(); const rows = []; let cursor;
      for (;;) {
        const query = new URLSearchParams({ select: 'id,body,category,status,created_at,reject_reason',
          status: 'in.(pending,approved)', order: 'id.asc', limit: '100' });
        if (cursor) query.set('id', `gt.${cursor}`);
        const page = await call(id, `line_jokes?${query}`);
        if (!Array.isArray(page)) throw new Error('笑話服務暫時無法使用');
        rows.push(...page);
        if (page.length < 100) return rows;
        const next = page.at(-1).id;
        if (!UUID.test(next) || next === cursor) throw new Error('笑話服務暫時無法使用');
        cursor = next;
      }
    },
    async review(row, status, category, reason = '') {
      if (!UUID.test(row.id) || !['pending', 'approved'].includes(row.status) ||
          !['approved', 'rejected'].includes(status) || !JOKE_CATEGORIES.includes(category) ||
          typeof reason !== 'string' || Array.from(reason).length > 200) throw new Error('分類、狀態或理由無效（理由最多 200 字）');
      const id = await requireAdmin();
      return call(id, 'rpc/review_line_joke', { p_id: row.id, p_status: status,
        p_category: category, p_reason: reason.trim(), p_expected_status: row.status });
    },
  };
}

export function initJokesPanel({ doc, auth, client, onDenied = () => {}, confirm = globalThis.confirm }) {
  const $ = (id) => doc.getElementById(id);
  const node = (tag, text, cls) => element(doc, tag, text, cls);
  const userId = auth.session?.user.id;
  let epoch = 0; let loaded = false; let loading = false;
  const current = (stamp) => stamp === epoch && auth.session?.user.id === userId;
  const clear = () => {
    ++epoch; loaded = false; loading = false;
    for (const id of ['pending-jokes', 'approved-jokes']) $(id).replaceChildren();
    $('jokes-status').textContent = ''; $('reload-jokes').disabled = false;
  };
  const load = async () => {
    if (loading || auth.session?.user.id !== userId) return;
    const stamp = ++epoch; loading = true; $('reload-jokes').disabled = true;
    $('jokes-status').textContent = '載入中…';
    try {
      const rows = await client.list();
      if (!current(stamp)) return;
      for (const id of ['pending-jokes', 'approved-jokes']) $(id).replaceChildren();
      for (const [status, id] of [['pending', 'pending-jokes'], ['approved', 'approved-jokes']]) {
        const selected = rows.filter((row) => row.status === status);
        if (!selected.length) $(id).append(node('p', status === 'pending' ? '目前沒有待審笑話。' : '目前沒有已上架笑話。'));
        for (const row of selected) {
          const card = node('article', '', 'admin-card');
          card.append(node('p', row.body, 'joke-body'), node('p', `投稿時間：${new Date(row.created_at).toLocaleString()}`));
          const categoryLabel = node('label', '分類'); const category = node('select');
          for (const value of JOKE_CATEGORIES) { const option = node('option', value); option.value = value; category.append(option); }
          category.value = row.category; categoryLabel.append(category);
          const reasonLabel = node('label', '退回／下架理由（選填，最多 200 字）'); const reason = node('textarea');
          reason.maxLength = 200; reason.value = row.reject_reason ?? ''; reasonLabel.append(reason);
          const message = node('p'); message.setAttribute('role', 'status'); const buttons = [];
          card.append(categoryLabel, reasonLabel);
          for (const [newStatus, label] of [['approved', status === 'pending' ? '核准' : '儲存分類'], ['rejected', status === 'pending' ? '退回' : '下架']]) {
            const button = node('button', label, 'btn'); button.type = 'button'; buttons.push(button);
            button.addEventListener('click', async () => {
              if (button.disabled || loading || !current(stamp)) return;
              if (newStatus === 'rejected' && !confirm(`${label}這則笑話？`)) return;
              buttons.forEach((b) => { b.disabled = true; }); message.textContent = '儲存中…';
              try {
                await client.review(row, newStatus, category.value, reason.value);
                if (!current(stamp)) return;
                await load();
              } catch (error) {
                if (!current(stamp)) return;
                if (error.message.startsWith('沒有權限')) { clear(); onDenied(); }
                else message.textContent = `操作失敗：${error.message}`;
              } finally { buttons.forEach((b) => { b.disabled = false; }); }
            });
            card.append(button);
          }
          card.append(message); $(id).append(card);
        }
      }
      loaded = true; $('jokes-status').textContent = '';
    } catch (error) {
      if (!current(stamp)) return;
      if (error.message.startsWith('沒有權限')) { clear(); onDenied(); }
      else $('jokes-status').textContent = `讀取失敗：${error.message}，請重新載入重試。`;
    } finally { if (current(stamp)) { loading = false; $('reload-jokes').disabled = false; } }
  };
  $('reload-jokes').addEventListener('click', load);
  return { clear, load, open: () => loaded ? undefined : load() };
}
