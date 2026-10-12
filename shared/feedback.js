import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, cloudEnabled } from './supabase-config.js?v=71fb506';
import { GAMES } from './games.js?v=71fb506';

export const KINDS = { problem: '問題', suggestion: '建議', other: '其他' };
export const STATUSES = { new: '新的', triage: '評估中', need_info: '需要更多資訊', planned: '已排工項',
  released: '已上線', declined: '不採納', duplicate: '重複' };
export const STATUS_FIELDS = {
  work_item: { label: '工項（如 RS27）', status: 'planned', max: 100 },
  released_version: { label: '上線版本（如 G8 v1.4）', status: 'released', max: 100 },
  reason: { label: '不採納理由', status: 'declined', max: 1000 },
  duplicate_of: { label: '重複來源（回饋 id 或 IN-3、G7-4）', status: 'duplicate', max: 100 },
  tracker_id: { label: 'Tracker 編號（如 IN-3）', max: 100 },
};
export const DEVICES = { phone: '手機', tablet: '平板', desktop: '電腦', line: 'LINE' };
export const CHANNELS = { web: '網站', line: 'LINE' };
export const LINE_SOURCES = { user: '私訊', group: '群組', room: '多人聊天室' };
export const LOGIN_NOTICE = '登入後才能送出意見(到「我的紀錄」用 Google 或 GitHub 登入)';
const FIELDS = 'id,user_id,game_id,kind,body,app_version,path,device,status,created_at,handled_at,note,work_item,released_version,reason,duplicate_of,tracker_id,channel';
const own = (object, key) => Object.hasOwn(object, key);

export function validateFeedbackUpdate(status, note, fields = {}) {
  if (!own(STATUSES, status) || typeof note !== 'string' || Array.from(note).length > 1000) {
    throw new Error('狀態或備註無效，備註最多 1000 字');
  }
  const result = { status, note };
  for (const [key, rule] of Object.entries(STATUS_FIELDS)) {
    const value = fields[key] ?? '';
    if (typeof value !== 'string' || Array.from(value).length > rule.max) throw new Error(`${rule.label}最多 ${rule.max} 字`);
    if (status === rule.status && !value.trim()) throw new Error(`${rule.label}必填`);
    result[key] = value.trim();
  }
  return result;
}

export function playerFeedbackStatus(row) {
  switch (row.status) {
    case 'new': case 'triage': return '已收到';
    case 'need_info': return '需要更多資訊(看備註)';
    case 'planned': return '已排入改善';
    case 'released': return `已在新版改好(${row.released_version})`;
    case 'declined': return `這次先不做:${row.reason}`;
    case 'duplicate': return '已有相同意見';
    default: return '已收到';
  }
}

export function validateFeedback(kind, body) {
  if (!own(KINDS, kind)) throw new Error('請選擇意見類型');
  if (typeof body !== 'string' || !body.trim() || Array.from(body).length > 1000) {
    throw new Error('內容必填，請輸入 1～1000 字');
  }
  return { kind, body };
}

export function deviceType({ width = globalThis.screen?.width ?? globalThis.innerWidth ?? 1024,
  touch = (globalThis.navigator?.maxTouchPoints ?? 0) > 0 } = {}) {
  return touch && width < 768 ? 'phone' : touch && width <= 1024 ? 'tablet' : 'desktop';
}

export function feedbackContext({ gameId = 'lobby', location = globalThis.location,
  width, touch, version = new URL(import.meta.url).searchParams.get('v') || 'development' } = {}) {
  const game = GAMES.find((g) => g.id === gameId);
  if (gameId !== 'lobby' && !game) throw new Error('找不到這款遊戲');
  // 僅取 pathname；query/hash 可能帶 OAuth 或玩家資料，不能送入回饋。
  return { game_id: gameId, app_version: game?.version ?? version,
    path: location.pathname, device: deviceType({ width, touch }) };
}

export function displayName(value) {
  return typeof value === 'string' && value.trim() && !value.includes('@') ? value.slice(0, 100) : '玩家';
}

export function createFeedbackClient({ auth, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY,
  fetch: request = globalThis.fetch } = {}) {
  async function call(path, { method = 'GET', body, prefer } = {}) {
    const userId = auth?.session?.user.id;
    if (!userId) throw new Error(LOGIN_NOTICE);
    const token = await auth.accessToken();
    if (!token || auth.session?.user.id !== userId) throw new Error(LOGIN_NOTICE);
    if (!url || !key) throw new Error('意見回饋尚未開放');
    let response;
    try {
      response = await request.call(globalThis, `${url.replace(/\/$/, '')}/rest/v1/${path}`, {
        method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          ...(prefer ? { Prefer: prefer } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('連線失敗，請稍後重試'); }
    if (auth.session?.user.id !== userId) throw new Error(LOGIN_NOTICE);
    const raw = response.status === 204 ? '' : await response.text();
    if (auth.session?.user.id !== userId) throw new Error(LOGIN_NOTICE);
    if (!response.ok) {
      let error;
      try { error = JSON.parse(raw); } catch { /* 不把伺服器文字直接顯示給玩家 */ }
      if (error?.message === 'FEEDBACK_TOO_SOON') throw new Error('每 60 秒最多送出 1 則，請稍後重試');
      if (error?.message === 'FEEDBACK_DAILY_LIMIT') throw new Error('今天已送出 20 則，請明天再試');
      if ([401, 403].includes(response.status)) throw new Error('沒有權限，請確認登入狀態');
      throw new Error('回饋服務暫時無法使用，請稍後重試');
    }
    return raw ? JSON.parse(raw) : null;
  }
  const isAdmin = async () => Boolean(auth?.session) && await call('rpc/is_admin', { method: 'POST', body: {} }) === true;
  const requireAdmin = async () => { if (!(await isAdmin())) throw new Error('沒有權限'); };
  return {
    isAdmin,
    async submit({ kind, body, context }) {
      const validated = validateFeedback(kind, body);
      // 白名單組合，呼叫端即使帶入其他欄位也不會傳出。
      return call('feedback', { method: 'POST', prefer: 'return=minimal', body: {
        user_id: auth?.session?.user.id, ...validated,
        game_id: context.game_id, app_version: context.app_version, path: context.path, device: context.device,
      } });
    },
    async listMine() {
      const query = new URLSearchParams({ select: 'id,created_at,game_id,kind,body,status,note,released_version,reason',
        user_id: `eq.${auth?.session?.user.id}`, order: 'created_at.desc,id.desc', limit: '20' });
      return (await call(`feedback?${query}`)) ?? [];
    },
    async listAdmin() {
      await requireAdmin();
      const rows = [];
      // 小批讀取，避免 PostgREST 的單次回傳上限截斷列表與 CSV。
      let cursor;
      for (;;) {
        const query = new URLSearchParams({ select: FIELDS, order: 'created_at.desc,id.desc', limit: '100' });
        if (cursor) query.set('or', `(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}))`);
        const page = (await call(`feedback?${query}`)) ?? [];
        rows.push(...page);
        if (page.length < 100) break;
        cursor = page.at(-1);
      }
      const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      const names = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const authors = await call('rpc/feedback_authors', { method: 'POST', body: { ids: ids.slice(i, i + 100) } });
        for (const author of authors ?? []) names.set(author.user_id, displayName(author.display_name));
      }
      const sources = new Map();
      const lineIds = rows.filter((row) => row.channel === 'line').map((row) => row.id);
      for (let i = 0; i < lineIds.length; i += 100) {
        const query = new URLSearchParams({ select: 'feedback_id,source_type,display_name',
          feedback_id: `in.(${lineIds.slice(i, i + 100).join(',')})` });
        for (const source of (await call(`feedback_line_sources?${query}`)) ?? []) sources.set(source.feedback_id, source);
      }
      return rows.map((row) => ({ ...row, source_type: sources.get(row.id)?.source_type,
        display_name: row.channel === 'line' ? displayName(sources.get(row.id)?.display_name)
          : names.get(row.user_id) ?? '玩家' }));
    },
    async listEvents(id) {
      await requireAdmin();
      const rows = [];
      let cursor;
      for (;;) {
        const query = new URLSearchParams({ select: 'id,feedback_id,from_status,to_status,note,actor_id,at',
          feedback_id: `eq.${id}`, order: 'at.desc,id.desc', limit: '100' });
        if (cursor) query.set('or', `(at.lt.${cursor.at},and(at.eq.${cursor.at},id.lt.${cursor.id}))`);
        const page = (await call(`feedback_events?${query}`)) ?? [];
        rows.push(...page);
        if (page.length < 100) return rows;
        cursor = page.at(-1);
      }
    },
    async update(id, status, note, fields = {}) {
      const validated = validateFeedbackUpdate(status, note, fields);
      await requireAdmin();
      const query = new URLSearchParams({ id: `eq.${id}`, select: FIELDS });
      const rows = await call(`feedback?${query}`, { method: 'PATCH', prefer: 'return=representation',
        body: { ...validated, handled_at: status === 'released' ? new Date().toISOString() : null } });
      if (!rows?.length) throw new Error('這則回饋已刪除或沒有權限，請重新載入');
      return rows[0];
    },
  };
}

export function filterFeedback(rows, { game = '', kind = '', status = '', keyword = '', channel = '' } = {}) {
  const term = keyword.trim().toLocaleLowerCase();
  return rows.filter((row) => (!channel || (row.channel ?? 'web') === channel)
    && (!game || row.game_id === game) && (!kind || row.kind === kind)
    && (!status || row.status === status) && (!term || [row.body, row.note, row.display_name,
      ...Object.keys(STATUS_FIELDS).map((key) => row[key])]
      .some((value) => String(value ?? '').toLocaleLowerCase().includes(term))));
}

export function feedbackCSV(rows) {
  const columns = ['id', 'created_at', 'display_name', 'game_id', 'kind', 'body', 'device', 'app_version', 'path', 'status', 'handled_at', 'note', ...Object.keys(STATUS_FIELDS), 'channel', 'source_type'];
  const cell = (value) => {
    let text = String(value ?? '');
    // 玩家內容與備註不應在試算表中被當作公式執行。
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [columns, ...rows.map((row) => columns.map((key) => key === 'display_name' ? displayName(row[key]) : row[key]))]
    .map((row) => row.map(cell).join(',')).join('\r\n');
}

export function element(doc, tag, text, className) {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

export async function openFeedback({ gameId = 'lobby', meHref = 'me/', doc = globalThis.document,
  location = globalThis.location, runtime, client } = {}) {
  if (doc.querySelector('.feedback-dialog[open]')) return;
  const previousFocus = doc.activeElement;
  const dialog = element(doc, 'dialog', undefined, 'feedback-dialog');
  dialog.setAttribute('aria-labelledby', 'feedback-title');
  const title = element(doc, 'h2', '💬 意見回饋');
  title.id = 'feedback-title';
  const message = element(doc, 'p', '載入中…');
  message.setAttribute('role', 'status');
  const close = element(doc, 'button', '關閉', 'btn');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { unsubscribe?.(); dialog.remove(); previousFocus?.focus(); });
  let unsubscribe;
  dialog.append(title, message, close);
  doc.body.append(dialog);
  dialog.showModal();
  try {
    const rt = runtime ?? (cloudEnabled ? await (await import('./auth.js?v=71fb506')).getCloudRuntime() : null);
    if (!dialog.open) return;
    if (!rt?.auth.session) {
      message.textContent = LOGIN_NOTICE;
      const link = element(doc, 'a', '前往我的紀錄登入', 'btn');
      link.href = meHref;
      close.before(link);
      return;
    }
    const ownerId = rt.auth.session.user.id;
    client ??= createFeedbackClient({ auth: rt.auth });
    const context = feedbackContext({ gameId, location });
    const form = element(doc, 'form');
    const kindLabel = element(doc, 'label', '類型');
    const kind = element(doc, 'select');
    for (const [value, label] of Object.entries(KINDS)) {
      const option = element(doc, 'option', label); option.value = value; kind.append(option);
    }
    kindLabel.append(kind);
    const bodyLabel = element(doc, 'label', '內容（必填，1～1000 字）');
    const body = element(doc, 'textarea');
    body.required = true;
    body.rows = 6;
    bodyLabel.append(body);
    const count = element(doc, 'p', '0 / 1000 字');
    body.addEventListener('input', () => { count.textContent = `${Array.from(body.value).length} / 1000 字`; });
    const send = element(doc, 'button', '送出', 'btn'); send.type = 'submit';
    form.append(kindLabel, bodyLabel, count, send);
    close.before(form);
    message.textContent = '請不要填寫 email 或其他個人資料。';
    unsubscribe = rt.auth.subscribe(({ session }) => {
      if (session?.user.id !== ownerId) { form.remove(); message.textContent = LOGIN_NOTICE; }
    });
    let pending = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (pending) return;
      pending = true; send.disabled = true;
      try {
        await client.submit({ kind: kind.value, body: body.value, context });
        message.textContent = '謝謝你的意見!'; form.remove(); close.focus();
      } catch (err) {
        message.textContent = err.message;
        send.textContent = '重試'; send.disabled = false;
      } finally { pending = false; }
    });
    body.focus();
  } catch {
    message.textContent = '意見回饋暫時無法使用，請關閉後重試';
  }
}
