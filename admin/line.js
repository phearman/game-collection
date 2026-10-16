import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=3f1141d';
export const GROUP_MODES = Object.freeze({ leisure:'休閒群',work_leisure:'工作群(含休閒)',work_only:'純工作群' });
export function groupModeSelect(doc, selected = 'leisure') {
  const select=doc.createElement('select'); select.setAttribute('aria-label','群組模式');
  for (const [value,name] of Object.entries(GROUP_MODES)) { const option=doc.createElement('option'); option.value=value; option.textContent=name; select.append(option); }
  select.value=selected; return select;
}

// Loaded on explicit interaction; group identifiers stay in RPC inputs, never labels.
export function appendGroupProjectControl({ doc, container, group, client, isCurrent }) {
  const node = (tag, text) => { const item=doc.createElement(tag); if (text) item.textContent=text; return item; };
  if (!['work_leisure','work_only'].includes(group.mode)) { container.append(node('p','休閒群不綁專案')); return; }
  const open=node('button','設定專案'); open.type='button'; open.className='btn';
  const output=node('div'); let loading=false;
  open.addEventListener('click',async () => {
    if (loading || !isCurrent()) return; loading=true; open.disabled=true;
    try {
      const meta=await client.metadata({ group_id:group.group_id }); if (!isCurrent()) return;
      const select=node('select'); select.setAttribute('aria-label','群組綁定專案');
      for (const [id,name] of [['','未綁定'],...meta.projects.filter((p) => p.active).map((p) => [p.id,p.code])]) {
        const option=node('option',name); option.value=id; select.append(option);
      }
      select.value=meta.binding_project_id ?? '';
      const save=node('button','儲存專案綁定'); save.type='button';
      const status=node('p'); status.setAttribute('role','status');
      save.addEventListener('click',async () => {
        if (save.disabled || !isCurrent()) return; save.disabled=true;
        try {
          await client.project('bind_group',{ group_id:group.group_id,id:select.value || null });
          if (isCurrent()) status.textContent='已儲存專案綁定';
        } catch { if (isCurrent()) status.textContent='儲存失敗，請重新載入後重試'; }
        finally { save.disabled=false; }
      });
      output.replaceChildren(select,save,status);
    } catch { if (isCurrent()) output.textContent='專案資料讀取失敗，請重試'; }
    finally { loading=false; open.disabled=false; }
  });
  container.append(open,output);
}

// Admin-only lists and mutations; player queries never carry LINE identifiers.
export function createPendingGroupsClient({ auth, client, url = SUPABASE_URL,
  key = SUPABASE_PUBLISHABLE_KEY, fetch: request = globalThis.fetch } = {}) {
  const root = url.replace(/\/$/, '');
  async function requireAdmin() {
    const userId = auth?.session?.user.id;
    if (!userId || !(await client.isAdmin()) || auth.session?.user.id !== userId) throw new Error('沒有權限');
    return userId;
  }
  async function call(userId, path, body) {
    const token = await auth.accessToken();
    if (!token || auth.session?.user.id !== userId) throw new Error('沒有權限');
    let response;
    try {
      response = await request.call(globalThis, `${root}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('連線失敗，請稍後重試'); }
    if (auth.session?.user.id !== userId) throw new Error('沒有權限');
    let data;
    try { data = response.status === 204 ? null : await response.json(); }
    catch { throw new Error('LINE 群組服務暫時無法使用，請稍後重試'); }
    if (auth.session?.user.id !== userId) throw new Error('沒有權限');
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('沒有權限，請確認登入狀態');
      if (data?.message === 'LINE_GROUP_NOT_FOUND') throw new Error('群組清單已變更，請重新載入後再試');
      if (data?.message === '公事模式群組已達 3 個上限') throw new Error(data.message);
      if (data?.message === '聊天室不支援公事模式,請改用群組') throw new Error(data.message);
      if (data?.message === 'LINE_GROUP_NAME_UNAVAILABLE') throw new Error('目前無法取得群組名稱，請稍後重試');
      throw new Error('LINE 群組服務暫時無法使用，請稍後重試');
    }
    if (data?.status === 'work_group_limit') throw new Error('公事模式群組已達 3 個上限');
    if (data?.status === 'room_work_unsupported') throw new Error('聊天室不支援公事模式,請改用群組');
    if (data?.status === 'group_changed') throw new Error('群組清單已變更，請重新載入後再試');
    return data;
  }
  async function list(table, select) {
    const userId = await requireAdmin();
    const rows = [];
    let cursor;
    for (;;) {
      const query = new URLSearchParams({ select, order: 'group_id.asc', limit: '100' });
      if (cursor) query.set('group_id', `gt.${cursor}`);
      const page = await call(userId, `rest/v1/${table}?${query}`);
      rows.push(...page);
      if (page.length < 100) return rows;
      cursor = page.at(-1).group_id;
    }
  }
  async function mutate(action, groupId, mode = 'leisure', projectId = null) {
    if (typeof groupId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(groupId)) throw new Error('群組識別碼無效');
    const userId = await requireAdmin();
    // LINE credentials and metadata refreshes stay in the Edge environment.
    return ['approve', 'refresh_name'].includes(action)
      ? call(userId, 'functions/v1/line-webhook', { action, group_id: groupId,...(action === 'approve' ? {mode,project_id:projectId} : {}) })
      : call(userId, `rest/v1/rpc/${action}_line_group`, { p_group_id: groupId });
  }
  return {
    listPendingGroups: () => list('line_pending_groups', 'group_id,group_name,source_type,first_seen_at,last_seen_at'),
    async listAllowedGroups() {
      const rows=await list('line_allowed_groups','group_id,group_name,source_type,approved_at,bot_present');
      const modes=await call(await requireAdmin(),'rest/v1/rpc/list_work_group_modes_admin',{});
      return rows.map((g) => ({...g,...(modes.find((m) => m.group_id===g.group_id) ?? {mode:'leisure'})}));
    },
    async setGroupMode(id,mode) { return call(await requireAdmin(),'rest/v1/rpc/set_line_group_mode',{p_group_id:id,p_mode:mode}); },
    async runWorkPurge() { return call(await requireAdmin(),'rest/v1/rpc/run_work_group_purge',{}); },
    async listGroupActions() {
      const userId = await requireAdmin();
      const query = new URLSearchParams({ select: 'id,group_id,group_name,action,actor_display_name,created_at,detail',
        order: 'created_at.desc,id.desc', limit: '20' });
      return call(userId, `rest/v1/line_group_actions?${query}`);
    },
    approveGroup: (id,mode,projectId) => mutate('approve', id,mode,projectId),
    refreshGroupName: (id) => mutate('refresh_name', id),
    ignoreGroup: (id) => mutate('ignore', id),
    revokeGroup: (id) => mutate('revoke', id),
  };
}
