import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=795425d';

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
      if (data?.message === 'LINE_GROUP_NAME_UNAVAILABLE') throw new Error('目前無法取得群組名稱，請稍後重試');
      throw new Error('LINE 群組服務暫時無法使用，請稍後重試');
    }
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
  async function mutate(action, groupId) {
    if (typeof groupId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(groupId)) throw new Error('群組識別碼無效');
    const userId = await requireAdmin();
    // LINE credentials and metadata refreshes stay in the Edge environment.
    return ['approve', 'refresh_name'].includes(action)
      ? call(userId, 'functions/v1/line-webhook', { action, group_id: groupId })
      : call(userId, `rest/v1/rpc/${action}_line_group`, { p_group_id: groupId });
  }
  return {
    listPendingGroups: () => list('line_pending_groups', 'group_id,group_name,source_type,first_seen_at,last_seen_at'),
    listAllowedGroups: () => list('line_allowed_groups', 'group_id,group_name,source_type,approved_at,bot_present'),
    async listGroupActions() {
      const userId = await requireAdmin();
      const query = new URLSearchParams({ select: 'id,group_id,group_name,action,actor_display_name,created_at',
        order: 'created_at.desc,id.desc', limit: '20' });
      return call(userId, `rest/v1/line_group_actions?${query}`);
    },
    approveGroup: (id) => mutate('approve', id),
    refreshGroupName: (id) => mutate('refresh_name', id),
    ignoreGroup: (id) => mutate('ignore', id),
    revokeGroup: (id) => mutate('revoke', id),
  };
}
