import { createReportsClient, initReportsPanel } from './reports.js?v=4577fc1';
import { appendGroupProjectControl, groupModeSelect, GROUP_MODES } from './line.js?v=4577fc1';
import { cloudEnabled } from '../shared/supabase-config.js?v=4577fc1';
import { GAMES } from '../shared/games.js?v=4577fc1';
import { createPendingGroupsClient } from './line.js?v=4577fc1';
import { createJokesClient, initJokesPanel } from './jokes.js?v=4577fc1';
import { createTipsClient, initTipsPanel } from './tips.js?v=4577fc1';
import { createFeedbackClient, KINDS, STATUSES, STATUS_FIELDS, DEVICES, CHANNELS, LINE_SOURCES, validateFeedbackUpdate, filterFeedback, feedbackCSV, displayName, element } from '../shared/feedback.js?v=4577fc1';

// 注入 runtime/client 供測試；未通過管理者檢查不讀取回饋。
export async function initAdmin({ doc = globalThis.document, view = doc.defaultView ?? globalThis.window,
  runtime, client, pendingClient, jokesClient, tipsClient, reportsClient, confirm = (text) => globalThis.confirm(text) } = {}) {
  const $ = (id) => doc.getElementById(id);
  const node = (tag, text, cls) => element(doc, tag, text, cls);
  let rows = [];
  let epoch = 0;
  let loading = false;
  let groupEpoch = 0;
  let groupsLoading = false;
  let authorized = false;
  let activeTab;
  let jokesPanel;
  let tipsPanel;
  let reportsPanel;
  const tabs = ['feedback', 'line-groups', 'jokes', 'tips', 'reports'];
  const selectTab = (tab, focus = false) => {
    if (!authorized) return;
    if (!tabs.includes(tab)) tab = 'feedback';
    const changed = activeTab !== tab;
    activeTab = tab;
    for (const name of tabs) {
      const button = $(`tab-${name}`);
      const selected = name === tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      $(name === 'feedback' ? 'admin-content' : name === 'line-groups' ? 'line-groups-panel' : `${name}-panel`).hidden = !selected;
    }
    if (view?.location && view.location.hash !== `#${tab}`) view.location.hash = tab;
    if (focus) $(`tab-${tab}`).focus();
    if (tab === 'reports') return reportsPanel?.open();
    if (tab === 'jokes' && changed) return jokesPanel?.open();
    if (tab === 'tips') return tipsPanel?.open();
  };
  for (const id of ['admin-tabs', 'admin-content', 'line-groups-panel', 'jokes-panel', 'tips-panel', 'reports-panel']) $(id).hidden = true;
  const hideData = () => {
    authorized = false;
    activeTab = undefined;
    jokesPanel?.clear(); tipsPanel?.clear(); reportsPanel?.clear();
    rows = [];
    for (const id of ['admin-tabs', 'admin-content', 'line-groups-panel', 'jokes-panel', 'tips-panel', 'reports-panel']) $(id).hidden = true;
    $('feedback-rows').replaceChildren();
    for (const id of ['pending-groups', 'allowed-groups', 'group-actions']) $(id).replaceChildren();
    $('count').textContent = '';
    $('groups-status').textContent = '';
    $('tab-line-groups').textContent = 'LINE 群組';
  };
  const addOptions = (select, options) => {
    for (const [value, label] of Object.entries(options)) {
      const option = node('option', label); option.value = value; select.append(option);
    }
  };
  const rt = runtime ?? (cloudEnabled ? await (await import('../shared/auth.js?v=4577fc1')).getCloudRuntime() : null);
  if (!rt?.auth.session) {
    hideData();
    $('access').textContent = '登入後才能查看回饋後台'; $('login').hidden = false;
    return;
  }
  client ??= createFeedbackClient({ auth: rt.auth });
  pendingClient ??= createPendingGroupsClient({ auth: rt.auth, client });
  const userId = rt.auth.session.user.id;
  jokesClient ??= createJokesClient({ auth: rt.auth, client });
  jokesPanel = initJokesPanel({ doc, auth: rt.auth, client: jokesClient, confirm, timers: view?.setTimeout ? view : globalThis,
    onDenied: () => { ++epoch; ++groupEpoch; hideData(); $('access').textContent = '沒有權限'; } });
  tipsClient ??= createTipsClient({ auth: rt.auth, client });
  tipsPanel = initTipsPanel({ doc, auth: rt.auth, client: tipsClient, confirm,
    onDenied: () => { ++epoch; ++groupEpoch; hideData(); $('access').textContent = '沒有權限'; } });
  reportsClient ??= createReportsClient({ auth: rt.auth, client });
  reportsPanel = initReportsPanel({ doc, auth: rt.auth, client: reportsClient, confirm,
    onDenied: () => { ++epoch; ++groupEpoch; hideData(); $('access').textContent = '沒有權限'; } });
  const filters = () => ({ game: $('filter-game').value, kind: $('filter-kind').value,
    status: $('filter-status').value, keyword: $('keyword').value, channel: $('filter-channel').value });
  const visible = () => filterFeedback(rows, filters());

  const render = () => {
    const selected = visible();
    $('count').textContent = `${selected.length} / ${rows.length} 則`;
    $('feedback-rows').replaceChildren();
    for (const row of selected) {
      const tr = node('tr');
      const isLine = row.channel === 'line';
      const game = GAMES.find((g) => g.id === row.game_id)?.title ?? (row.game_id === 'lobby' ? '大廳' : row.game_id);
      const author = isLine
        ? `${displayName(row.display_name)} · ${LINE_SOURCES[row.source_type] ?? '來源未提供'}` : displayName(row.display_name);
      const created = new Date(row.created_at);
      const pad = (value) => String(value).padStart(2, '0');
      const time = node('td', '', 'feedback-time');
      time.append(node('span', `${created.getFullYear()}/${pad(created.getMonth() + 1)}/${pad(created.getDate())}`),
        node('span', `${pad(created.getHours())}:${pad(created.getMinutes())}`));
      tr.append(time);
      for (const [cls, label, text] of [
        ['feedback-channel', '', CHANNELS[row.channel ?? 'web'] ?? row.channel],
        ['feedback-author', '送出者與來源', author],
        ['feedback-game', '遊戲', isLine ? '—' : game],
        ['feedback-kind', '類型', KINDS[row.kind] ?? row.kind],
        ['body', '內容', row.body],
        ['feedback-device', '裝置', isLine ? '—' : DEVICES[row.device] ?? row.device],
        ['feedback-version', '版本', isLine ? '—' : row.app_version],
      ]) {
        const cell = node('td', text, cls);
        if (label) cell.setAttribute('data-label', label);
        tr.append(cell);
      }
      const actions = node('td', '', 'feedback-actions');
      const statusLabel = node('label', '狀態');
      const status = node('select'); addOptions(status, STATUSES); status.value = row.status;
      statusLabel.append(status);
      const inputs = {};
      const fieldLabels = {};
      for (const [key, rule] of Object.entries(STATUS_FIELDS)) {
        const label = node('label', rule.label);
        const input = node(key === 'reason' ? 'textarea' : 'input');
        input.name = key; input.value = row[key] ?? '';
        label.append(input); inputs[key] = input; fieldLabels[key] = label;
      }
      const syncFields = () => {
        for (const [key, rule] of Object.entries(STATUS_FIELDS)) {
          const required = status.value === rule.status;
          inputs[key].required = required;
          fieldLabels[key].hidden = Boolean(rule.status) && !required;
        }
      };
      status.addEventListener('change', syncFields); syncFields();
      const noteLabel = node('label', '備註（最多 1000 字）');
      const note = node('textarea'); note.value = row.note ?? ''; note.rows = 3;
      noteLabel.append(note);
      const save = node('button', '儲存', 'btn'); save.type = 'button';
      const message = node('p'); message.setAttribute('role', 'status');
      const history = node('details');
      history.append(node('summary', '查看狀態歷程'));
      const events = node('div'); history.append(events);
      let historyEpoch = 0;
      const loadHistory = async () => {
        const requestEpoch = ++historyEpoch;
        const savedEpoch = epoch;
        events.replaceChildren(node('p', '載入中…'));
        try {
          const data = await client.listEvents(row.id);
          if (requestEpoch !== historyEpoch || savedEpoch !== epoch || rt.auth.session?.user.id !== userId) return;
          events.replaceChildren();
          if (!data.length) events.append(node('p', '尚無狀態變更。'));
          const legacy = { read: '已讀（舊狀態）', done: '已處理（舊狀態）', handled: '已處理（舊狀態）' };
          for (const entry of data) {
            const item = node('p', `${new Date(entry.at).toLocaleString()} · ${STATUSES[entry.from_status] ?? legacy[entry.from_status] ?? entry.from_status} → ${STATUSES[entry.to_status] ?? entry.to_status}`);
            item.append(node('br'), node('span', entry.note), node('br'),
              node('span', entry.actor_id ? `操作者：${entry.actor_id}` : '資料庫轉換／帳號已移除'));
            events.append(item);
          }
        } catch (err) {
          if (requestEpoch !== historyEpoch || savedEpoch !== epoch || rt.auth.session?.user.id !== userId) return;
          events.replaceChildren(node('p', `歷程讀取失敗:${err.message}`));
          const retry = node('button', '重試', 'btn'); retry.type = 'button';
          retry.addEventListener('click', loadHistory); events.append(retry);
        }
      };
      history.addEventListener('toggle', () => { if (history.open) return loadHistory(); });
      save.addEventListener('click', async () => {
        if (save.disabled) return;
        const savedEpoch = epoch;
        save.disabled = true; message.textContent = '儲存中…';
        try {
          const fields = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
          validateFeedbackUpdate(status.value, note.value, fields);
          const updated = await client.update(row.id, status.value, note.value, fields);
          if (savedEpoch !== epoch || rt.auth.session?.user.id !== userId) return;
          const index = rows.findIndex((r) => r.id === row.id);
          if (index >= 0) rows[index] = { ...updated, display_name: row.display_name, source_type: row.source_type };
          message.textContent = '已儲存';
          if (history.open) await loadHistory();
          // 改狀態後讓篩選結果一致；無篩選時保留儲存提示與焦點。
          if (filters().status || filters().keyword) render();
        } catch (err) {
          if (savedEpoch === epoch) message.textContent = `儲存失敗:${err.message}，可重試。`;
        } finally { save.disabled = false; }
      });
      actions.append(statusLabel, ...Object.values(fieldLabels), noteLabel, save, message, history); tr.append(actions);
      $('feedback-rows').append(tr);
    }
  };

  const groupLabel = (group) => group.group_name || '(未取得名稱)';
  const fullyApproved = (allowed, pending) => allowed.group_id === pending.group_id
    && allowed.bot_present === true && allowed.source_type === pending.source_type;
  const groupButtons = (container, group, approved) => {
    const buttons = [];
    const message = node('p'); message.setAttribute('role', 'status');
    const mode=groupModeSelect(doc,group.mode ?? 'leisure');
    const project=node('select'); project.setAttribute('aria-label','核准時綁定專案'); project.hidden=true;
    project.append(node('option','先不綁')); project.value='';
    if (group.source_type === 'group') container.append(mode);
    if (!approved && group.source_type === 'group') container.append(project);
    mode.addEventListener('change',async () => {
      if (approved || !authorized || rt.auth.session?.user.id !== userId) return;
      project.hidden=mode.value==='leisure'; project.replaceChildren(node('option','先不綁')); project.value='';
      if (project.hidden) return;
      const stamp=groupEpoch; mode.disabled=true;
      try {
        const meta=await reportsClient.metadata();
        if (stamp!==groupEpoch || rt.auth.session?.user.id!==userId) return;
        for (const p of meta.projects.filter((p) => p.active)) { const option=node('option',p.code); option.value=p.id; project.append(option); }
      } catch (err) { message.textContent=err.message; }
      finally { mode.disabled=false; }
    });
    if (approved && group.source_type === 'group' && group.bot_present) {
      const save=node('button','儲存模式','btn'); save.type='button';
      save.addEventListener('click',async () => {
        if (save.disabled || !authorized || rt.auth.session?.user.id!==userId) return;
        save.disabled=true; const stamp=groupEpoch;
        try { await pendingClient.setGroupMode(group.group_id,mode.value); if (stamp===groupEpoch && rt.auth.session?.user.id===userId) await loadGroups('已儲存模式'); }
        catch (err) { if (stamp===groupEpoch && rt.auth.session?.user.id===userId) message.textContent=err.message; }
        finally { save.disabled=false; }
      });
      container.append(node('p',`模式：${GROUP_MODES[group.mode ?? 'leisure']}`),save);
    }
    for (const action of approved ? ['revoke', 'refresh_name'] : ['approve', 'ignore']) {
      const label = { approve: '核准', ignore: '忽略', revoke: '撤銷', refresh_name: '更新名稱' }[action];
      const button = node('button', label, 'btn'); button.type = 'button'; buttons.push(button);
      button.addEventListener('click', async () => {
        if (button.disabled || groupsLoading || !authorized || rt.auth.session?.user.id !== userId) return;
        const prompt = action === 'revoke' ? `撤銷「${groupLabel(group)}」？之後的訊息不再收，已收到的回饋保留。`
          : action === 'ignore' ? `忽略「${groupLabel(group)}」？將移除待核准登記，之後加入或傳 #回饋 會再次登記。`
            : `核准「${groupLabel(group)}」？之後的文字回饋將開始收取。`;
        if (action !== 'refresh_name' && !confirm(prompt)) return;
        const savedEpoch = groupEpoch;
        buttons.forEach((item) => { item.disabled = true; }); message.textContent = '處理中…';
        try {
          // Recheck approval in case another admin approved a row already on this screen.
          const duplicate = action === 'approve' && (await pendingClient.listAllowedGroups())
            .some((item) => fullyApproved(item, group));
          if (groupEpoch !== savedEpoch || rt.auth.session?.user.id !== userId) return;
          const method = duplicate ? 'ignoreGroup' : action === 'refresh_name' ? 'refreshGroupName' : `${action}Group`;
          await pendingClient[method](group.group_id,...(method==='approveGroup' ? [mode.value,project.value || null] : []));
          if (groupEpoch !== savedEpoch || rt.auth.session?.user.id !== userId) return;
          await loadGroups(duplicate ? '此群組已核准,已清除重複的待核准紀錄'
            : action === 'refresh_name' ? '已更新群組名稱' : '');
        } catch (err) {
          if (groupEpoch === savedEpoch && rt.auth.session?.user.id === userId) message.textContent = `操作失敗：${err.message}`;
        } finally { buttons.forEach((item) => { item.disabled = false; }); }
      });
      container.append(button);
    }
    container.append(message);
  };
  const renderGroups = (pending, allowed, actions) => {
    const allowedById = new Map(allowed.map((group) => [group.group_id, group]));
    pending = pending.filter((group) => !allowed.some((item) => fullyApproved(item, group)));
    $('tab-line-groups').textContent = pending.length ? `LINE 群組 (${pending.length})` : 'LINE 群組';
    for (const id of ['pending-groups', 'allowed-groups', 'group-actions']) $(id).replaceChildren();
    if (!pending.length) $('pending-groups').append(node('p', '目前沒有待核准群組。'));
    if (!allowed.length) $('allowed-groups').append(node('p', '目前沒有已核准群組。'));
    if (!actions.length) $('group-actions').append(node('p', '尚無操作紀錄。'));
    for (const [groups, approved, target] of [[pending, false, 'pending-groups'], [allowed, true, 'allowed-groups']]) {
      for (const group of groups) {
        const item = node('div', '', 'admin-card');
        const times = approved ? `核准：${new Date(group.approved_at).toLocaleString()} · ${group.bot_present ? '機器人在群組' : '機器人已不在群組'}`
          : `首次：${new Date(group.first_seen_at).toLocaleString()} · 最後：${new Date(group.last_seen_at).toLocaleString()}`;
        item.append(node('p', `${groupLabel(group)} · ${group.source_type === 'room' ? '多人聊天室' : '群組'}`), node('p', times));
        if (!approved && allowedById.has(group.group_id)) item.append(node('p', allowedById.get(group.group_id).reapproval_required
          ? '重新加入,需重新核准' : '已核准但狀態異常,核准即修復'));
        groupButtons(item, group, approved);
        if (approved && group.source_type === 'group' && group.bot_present) appendGroupProjectControl({ doc, container: item, group, client: reportsClient,
          isCurrent: () => authorized && rt.auth.session?.user.id === userId && item.parentNode !== null }); $(target).append(item);
      }
    }
    for (const entry of actions) $('group-actions').append(node('p',
      `${new Date(entry.created_at).toLocaleString()} · ${{ approve: '核准', ignore: '忽略', revoke: '撤銷',mode:'模式',bind:'綁專案',purge:'清除' }[entry.action] ?? entry.action} · ${groupLabel(entry)} · ${entry.detail ?? ''} · 操作者：${displayName(entry.actor_display_name)}`));
  };

  const loadGroups = async (successMessage = '') => {
    const current = ++groupEpoch;
    groupsLoading = true; $('reload-groups').disabled = true;
    $('groups-status').textContent = '載入中…';
    try {
      const pending = await pendingClient.listPendingGroups();
      if (groupEpoch !== current || rt.auth.session?.user.id !== userId) return;
      const allowed = await pendingClient.listAllowedGroups();
      if (groupEpoch !== current || rt.auth.session?.user.id !== userId) return;
      const actions = await pendingClient.listGroupActions();
      if (groupEpoch !== current || rt.auth.session?.user.id !== userId) return;
      renderGroups(pending, allowed, actions);
      $('groups-status').textContent = successMessage;
    } catch (err) {
      if (groupEpoch !== current || rt.auth.session?.user.id !== userId) return;
      if (err.message.startsWith('沒有權限')) { ++epoch; hideData(); $('access').textContent = '沒有權限'; }
      else $('groups-status').textContent = `讀取失敗:${err.message}，請重新載入重試。`;
    } finally {
      if (groupEpoch === current) { groupsLoading = false; $('reload-groups').disabled = false; }
    }
  };

  const load = async () => {
    const current = ++epoch;
    loading = true;
    $('reload').disabled = true; $('export-csv').disabled = true;
    $('count').textContent = '載入中…';
    try {
      const data = await client.listAdmin();
      if (epoch !== current || rt.auth.session?.user.id !== userId) return;
      rows = data;
      $('access').textContent = '';
      if (!authorized) {
        authorized = true; $('admin-tabs').hidden = false;
        selectTab(view?.location?.hash.slice(1));
        await loadGroups();
        if (epoch !== current || !authorized || rt.auth.session?.user.id !== userId) return;
      }
      // 保留篩選，補入資料裡的遊戲（含未知遊戲 id）。
      const chosen = $('filter-game').value;
      const all = node('option', '全部遊戲'); all.value = '';
      $('filter-game').replaceChildren(all);
      const games = Object.fromEntries([...new Set(rows.map((r) => r.game_id))].map((id) =>
        [id, GAMES.find((g) => g.id === id)?.title ?? (id === 'lobby' ? '大廳' : id)]));
      addOptions($('filter-game'), games); $('filter-game').value = chosen;
      render();
    } catch (err) {
      if (epoch !== current || rt.auth.session?.user.id !== userId) return;
      rows = []; $('feedback-rows').replaceChildren();
      const denied = err.message.startsWith('沒有權限');
      if (denied) { ++groupEpoch; hideData(); }
      const message = authorized ? $('count') : $('access');
      message.textContent = denied ? '沒有權限' : `讀取失敗:${err.message}`;
      const retry = node('button', '重試', 'btn'); retry.type = 'button';
      retry.addEventListener('click', () => { retry.remove(); load(); });
      if (!denied) message.append(retry);
    } finally {
      if (epoch === current) { loading = false; $('reload').disabled = false; $('export-csv').disabled = false; }
    }
  };

  addOptions($('filter-kind'), KINDS); addOptions($('filter-status'), STATUSES); addOptions($('filter-channel'), CHANNELS);
  for (const id of ['filter-game', 'filter-kind', 'filter-status', 'filter-channel', 'keyword']) $(id).addEventListener('input', render);
  $('reload').addEventListener('click', load);
  $('reload-groups').addEventListener('click', () => loadGroups());
  $('purge-work-groups')?.addEventListener('click',async () => {
    if (groupsLoading || !authorized || rt.auth.session?.user.id!==userId) return;
    const stamp=groupEpoch; $('purge-work-groups').disabled=true;
    try { const result=await pendingClient.runWorkPurge(); if (stamp===groupEpoch && rt.auth.session?.user.id===userId) await loadGroups(`已清除 ${result.groups} 個到期群組、${result.reports} 則回報`); }
    catch (err) { if (stamp===groupEpoch && rt.auth.session?.user.id===userId) $('groups-status').textContent=err.message; }
    finally { $('purge-work-groups').disabled=false; }
  });
  for (const [index, name] of tabs.entries()) {
    $(`tab-${name}`).addEventListener('click', () => selectTab(name));
    $(`tab-${name}`).addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next], true);
    });
  }
  view?.addEventListener('hashchange', () => selectTab(view.location.hash.slice(1)));
  $('export-csv').addEventListener('click', () => {
    if (loading || $('admin-content').hidden || rt.auth.session?.user.id !== userId) return;
    const url = URL.createObjectURL(new Blob([feedbackCSV(visible())], { type: 'text/csv;charset=utf-8' }));
    const link = node('a'); link.href = url; link.download = 'feedback.csv';
    doc.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  rt.auth.subscribe(({ session }) => {
    if (session?.user.id !== userId) {
      ++epoch; ++groupEpoch; hideData(); $('access').textContent = '沒有權限';
    }
  });
  await load();
}

if (typeof document !== 'undefined') {
  const { bindThemeToggle } = await import('../shared/theme.js?v=4577fc1');
  bindThemeToggle(document.getElementById('theme'));
  initAdmin().catch(() => {
    for (const id of ['admin-tabs', 'admin-content', 'line-groups-panel', 'jokes-panel', 'tips-panel', 'reports-panel']) document.getElementById(id).hidden = true;
    document.getElementById('access').textContent = '後台暫時無法使用，請重新載入';
  });
}
