import { cloudEnabled } from '../shared/supabase-config.js?v=a780d21';
import { GAMES } from '../shared/games.js?v=a780d21';
import { createFeedbackClient, KINDS, STATUSES, STATUS_FIELDS, DEVICES, validateFeedbackUpdate, filterFeedback, feedbackCSV, displayName, element } from '../shared/feedback.js?v=a780d21';

// 注入 runtime/client 供測試；未通過管理者檢查不讀取回饋。
export async function initAdmin({ doc = globalThis.document, runtime, client } = {}) {
  const $ = (id) => doc.getElementById(id);
  const node = (tag, text, cls) => element(doc, tag, text, cls);
  let rows = [];
  let epoch = 0;
  let loading = false;
  $('admin-content').hidden = true;
  const hideData = () => {
    rows = [];
    $('admin-content').hidden = true;
    $('feedback-rows').replaceChildren();
    $('count').textContent = '';
  };
  const addOptions = (select, options) => {
    for (const [value, label] of Object.entries(options)) {
      const option = node('option', label); option.value = value; select.append(option);
    }
  };
  const rt = runtime ?? (cloudEnabled ? await (await import('../shared/auth.js?v=a780d21')).getCloudRuntime() : null);
  if (!rt?.auth.session) {
    hideData();
    $('access').textContent = '登入後才能查看回饋後台'; $('login').hidden = false;
    return;
  }
  client ??= createFeedbackClient({ auth: rt.auth });
  const userId = rt.auth.session.user.id;
  const filters = () => ({ game: $('filter-game').value, kind: $('filter-kind').value,
    status: $('filter-status').value, keyword: $('keyword').value });
  const visible = () => filterFeedback(rows, filters());

  const render = () => {
    const selected = visible();
    $('count').textContent = `${selected.length} / ${rows.length} 則`;
    $('feedback-rows').replaceChildren();
    for (const row of selected) {
      const tr = node('tr');
      const game = GAMES.find((g) => g.id === row.game_id)?.title ?? (row.game_id === 'lobby' ? '大廳' : row.game_id);
      for (const [index, text] of [new Date(row.created_at).toLocaleString(), displayName(row.display_name), game,
        KINDS[row.kind] ?? row.kind, row.body, DEVICES[row.device] ?? row.device, row.app_version].entries()) {
        tr.append(node('td', text, index === 4 ? 'body' : ''));
      }
      const actions = node('td');
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
          if (index >= 0) rows[index] = { ...updated, display_name: row.display_name };
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

  const load = async () => {
    const current = ++epoch;
    loading = true;
    hideData();
    $('reload').disabled = true; $('export-csv').disabled = true;
    $('access').textContent = '載入中…';
    try {
      const data = await client.listAdmin();
      if (epoch !== current || rt.auth.session?.user.id !== userId) return;
      rows = data;
      $('access').textContent = '';
      $('admin-content').hidden = false;
      // 保留篩選，補入資料裡的遊戲（含未知遊戲 id）。
      const chosen = $('filter-game').value;
      const all = node('option', '全部遊戲'); all.value = '';
      $('filter-game').replaceChildren(all);
      const games = Object.fromEntries([...new Set(rows.map((r) => r.game_id))].map((id) =>
        [id, GAMES.find((g) => g.id === id)?.title ?? (id === 'lobby' ? '大廳' : id)]));
      addOptions($('filter-game'), games); $('filter-game').value = chosen;
      render();
    } catch (err) {
      if (epoch !== current) return;
      hideData();
      $('access').textContent = err.message === '沒有權限' ? '沒有權限' : `讀取失敗:${err.message}`;
      // 失敗時仍提供重試按鈕，不顯示資料。
      const retry = node('button', '重試', 'btn'); retry.type = 'button';
      retry.addEventListener('click', () => { retry.remove(); load(); });
      if (err.message !== '沒有權限') $('access').append(retry);
    } finally {
      if (epoch === current) { loading = false; $('reload').disabled = false; $('export-csv').disabled = false; }
    }
  };

  addOptions($('filter-kind'), KINDS); addOptions($('filter-status'), STATUSES);
  for (const id of ['filter-game', 'filter-kind', 'filter-status', 'keyword']) $(id).addEventListener('input', render);
  $('reload').addEventListener('click', load);
  $('export-csv').addEventListener('click', () => {
    if (loading || $('admin-content').hidden || rt.auth.session?.user.id !== userId) return;
    const url = URL.createObjectURL(new Blob([feedbackCSV(visible())], { type: 'text/csv;charset=utf-8' }));
    const link = node('a'); link.href = url; link.download = 'feedback.csv';
    doc.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  rt.auth.subscribe(({ session }) => {
    if (session?.user.id !== userId) {
      ++epoch; hideData(); $('access').textContent = '沒有權限';
    }
  });
  await load();
}

if (typeof document !== 'undefined') {
  const { bindThemeToggle } = await import('../shared/theme.js?v=a780d21');
  bindThemeToggle(document.getElementById('theme'));
  initAdmin().catch(() => {
    document.getElementById('admin-content').hidden = true;
    document.getElementById('access').textContent = '後台暫時無法使用，請重新載入';
  });
}
