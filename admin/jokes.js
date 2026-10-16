import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=6d7df09';
import { element } from '../shared/feedback.js?v=6d7df09';
import { JOKE_CATEGORIES, jokeFieldsError, normalizeJokeBody, parseJokeImport } from './joke-import.js?v=6d7df09';

export { JOKE_CATEGORIES, parseJokeImport } from './joke-import.js?v=6d7df09';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const JOKE_SOURCES = ['editor', 'submitted', 'builtin'];

// Date inputs are calendar dates in Asia/Taipei, independent of the browser zone.
export function jokeDateRange(mode = 'all', from = '', to = '', now = new Date()) {
  if (mode === 'all') return { from: null, to: null };
  if (!['today', '7days', 'custom'].includes(mode)) throw new Error('日期篩選無效');
  if (mode !== 'custom') {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (name) => parts.find((p) => p.type === name).value;
    to = `${part('year')}-${part('month')}-${part('day')}`;
    from = new Date(Date.parse(`${to}T00:00:00Z`) - (mode === '7days' ? 6 : 0) * 86400000).toISOString().slice(0, 10);
  }
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to)) throw new Error('請填寫有效的起日與訖日');
  if (from > to) throw new Error('起日不可晚於訖日');
  return { from: new Date(`${from}T00:00:00.000+08:00`).toISOString(),
    to: new Date(Date.parse(`${to}T00:00:00.000+08:00`) + 86400000).toISOString() };
}

export function jokeListParams({ page = 1, category = '', status = '', source = '',
  createdFrom = null, createdTo = null, reviewedFrom = null, reviewedTo = null } = {}) {
  if (!Number.isInteger(page) || page < 1 || (category && !JOKE_CATEGORIES.includes(category)) ||
      (status && !['pending', 'approved', 'rejected'].includes(status)) ||
      (source && !JOKE_SOURCES.includes(source))) throw new Error('篩選無效');
  for (const [from, to] of [[createdFrom, createdTo], [reviewedFrom, reviewedTo]]) {
    for (const value of [from, to]) {
      if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
          !Number.isFinite(Date.parse(value)))) throw new Error('日期篩選無效');
    }
    if (from !== null && to !== null && Date.parse(from) > Date.parse(to)) throw new Error('起日不可晚於訖日');
  }
  return { p_page: page, p_category: category || null, p_status: status || null, p_source: source || null,
    p_created_from: createdFrom, p_created_to: createdTo, p_reviewed_from: reviewedFrom, p_reviewed_to: reviewedTo };
}

export function submitterLines(submitter) {
  if (!submitter) return [];
  const name = submitter.linked === true
    ? `${submitter.avatar_emoji ? `${submitter.avatar_emoji} ` : ''}${submitter.nickname || '已綁定玩家'}`
    : `未綁定玩家${submitter.line_suffix ? ` ·${submitter.line_suffix}` : ''}`;
  return [`投稿者：${name}`, `累計投稿 ${submitter.total} 則(上架 ${submitter.approved} / 退回 ${submitter.rejected})`];
}
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
    async list(filters = {}) {
      const params = jokeListParams(filters);
      const id = await requireAdmin();
      const result = await call(id, 'rpc/list_line_jokes_admin', params);
      if (!Array.isArray(result?.rows) || result.rows.length > 50 || !Number.isInteger(result.total) || result.total < 0 ||
          !Number.isInteger(result.page) || result.page < 1) throw new Error('笑話服務暫時無法使用');
      return result;
    },
    async review(row, status, category, reason = '', answer = row.answer ?? null, credit = row.credit ?? null) {
      if (!UUID.test(row.id) || !['pending', 'approved'].includes(row.status) ||
          !['approved', 'rejected'].includes(status) || !JOKE_CATEGORIES.includes(category) ||
          typeof reason !== 'string' || Array.from(reason).length > 200) throw new Error('分類、狀態或理由無效（理由最多 200 字）');
      const error = jokeFieldsError({ category, body: row.body, answer, credit });
      if (error) throw new Error(error);
      const id = await requireAdmin();
      return call(id, 'rpc/review_line_joke', { p_id: row.id, p_status: status,
        p_category: category, p_reason: reason.trim(), p_expected_status: row.status,
        p_answer: answer?.trim() || null, p_credit: credit?.trim() || null });
    },
    async import(rows, approve = false) {
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200 || typeof approve !== 'boolean') throw new Error('匯入需 1～200 則');
      const seen = new Set();
      const checked = rows.map((row) => {
        const error = row && jokeFieldsError(row);
        if (!row || error) throw new Error(error || '匯入欄位無效');
        const hash = normalizeJokeBody(row.body);
        if (seen.has(hash)) throw new Error('檔內題目重複');
        seen.add(hash);
        return { category: row.category, body: row.body, answer: row.answer ?? null, credit: row.credit ?? null };
      });
      const id = await requireAdmin();
      const result = await call(id, 'rpc/import_line_jokes', { p_rows: checked, p_approve: approve });
      if (!Number.isInteger(result?.inserted) || !Number.isInteger(result?.skipped) || result.inserted < 0 || result.skipped < 0 ||
          result.inserted + result.skipped !== rows.length) throw new Error('匯入結果無效，請重新載入確認後再試');
      return result;
    },
  };
}

export function initJokesPanel({ doc, auth, client, onDenied = () => {}, confirm = globalThis.confirm, timers = globalThis }) {
  const $ = (id) => doc.getElementById(id);
  const node = (tag, text, cls) => element(doc, tag, text, cls);
  const userId = auth.session?.user.id;
  let epoch = 0; let loaded = false; let loading = false;
  let page = 1; let total = 0; let preview = null; let importing = false; let importEpoch = 0;
  let noticeTimer;
  const clearNotice = () => { timers.clearTimeout(noticeTimer); $('jokes-notice').textContent = ''; };
  const showNotice = () => {
    clearNotice(); $('jokes-notice').textContent = '已儲存';
    noticeTimer = timers.setTimeout(() => { $('jokes-notice').textContent = ''; }, 2000);
  };
  const dateControls = ['created', 'reviewed'];
  const syncDates = () => {
    for (const kind of dateControls) $('jokes-' + kind + '-custom').hidden = $('jokes-' + kind + '-filter').value !== 'custom';
  };
  const filters = (selectedPage) => {
    const result = { page: selectedPage, category: $('jokes-category-filter').value, status: $('jokes-state-filter').value,
      source: $('jokes-source-filter').value };
    const now = new Date();
    for (const kind of dateControls) {
      const range = jokeDateRange($('jokes-' + kind + '-filter').value,
        $('jokes-' + kind + '-from').value, $('jokes-' + kind + '-to').value, now);
      result[kind + 'From'] = range.from; result[kind + 'To'] = range.to;
    }
    return result;
  };
  const current = (stamp) => stamp === epoch && auth.session?.user.id === userId;
  const clear = () => {
    ++epoch; loaded = false; loading = false; clearNotice();
    ++importEpoch; preview = null; importing = false; page = 1; total = 0;
    for (const id of ['pending-jokes', 'approved-jokes', 'rejected-jokes', 'jokes-import-preview']) $(id).replaceChildren();
    $('jokes-import-text').value = ''; $('jokes-direct-approve').checked = false;
    $('jokes-import-status').textContent = ''; $('jokes-page').textContent = '';
    $('jokes-import-submit').disabled = true; $('jokes-import-check').disabled = false;
    $('jokes-import-text').disabled = false; $('jokes-direct-approve').disabled = false;
    $('jokes-category-filter').value = ''; $('jokes-state-filter').value = 'pending';
    $('jokes-source-filter').value = '';
    for (const kind of dateControls) {
      $('jokes-' + kind + '-filter').value = 'all';
      $('jokes-' + kind + '-from').value = ''; $('jokes-' + kind + '-to').value = '';
    }
    syncDates();
    $('jokes-prev').disabled = true; $('jokes-next').disabled = true;
    $('jokes-status').textContent = ''; $('reload-jokes').disabled = false;
  };
  const load = async (saved = false, selectedPage = page) => {
    if (auth.session?.user.id !== userId) return;
    let query;
    try { query = filters(selectedPage); }
    catch (error) { $('jokes-status').textContent = `讀取失敗：${error.message}`; return; }
    clearNotice();
    const stamp = ++epoch; loading = true; $('reload-jokes').disabled = true;
    $('jokes-status').textContent = '載入中…';
    try {
      const result = await client.list(query);
      if (!current(stamp)) return;
      const rows = result.rows; page = result.page; total = result.total;
      $('jokes-page').textContent = `第 ${page} / ${Math.max(1, Math.ceil(total / 50))} 頁 · 共 ${total} 則 · 每頁 50 則`;
      $('jokes-prev').disabled = page <= 1; $('jokes-next').disabled = page * 50 >= total;
      for (const id of ['pending-jokes', 'approved-jokes', 'rejected-jokes']) $(id).replaceChildren();
      for (const [status, id] of [['pending', 'pending-jokes'], ['approved', 'approved-jokes'], ['rejected', 'rejected-jokes']]) {
        const selected = rows.filter((row) => row.status === status);
        if (!selected.length) $(id).append(node('p', '本頁沒有此狀態的笑話。'));
        for (const row of selected) {
          const card = node('article', '', 'admin-card');
          card.append(node('p', row.body, 'joke-body'), node('p', `建立時間：${new Date(row.created_at).toLocaleString()}`));
          if (status === 'pending' && row.source === 'submitted') {
            for (const line of submitterLines(row.submitter)) card.append(node('p', line, 'joke-submitter'));
          }
          if (status === 'rejected') {
            card.append(node('p', `分類：${row.category}`), node('p', `答案：${row.answer ?? '無'}`),
              node('p', `出處：${row.credit ?? '原創（無出處）'}`), node('p', `下架理由：${row.reject_reason ?? ''}`));
            $(id).append(card); continue;
          }
          const categoryLabel = node('label', '分類'); const category = node('select');
          for (const value of JOKE_CATEGORIES) { const option = node('option', value); option.value = value; category.append(option); }
          category.value = row.category; categoryLabel.append(category);
          const answerLabel = node('label'); const answerHint = node('span'); const answer = node('textarea');
          answerLabel.append(answerHint);
          answer.maxLength = 120; answer.value = row.answer ?? ''; answerLabel.append(answer);
          const syncAnswer = () => {
            const riddle = category.value === '急轉彎';
            answer.disabled = !riddle; answer.required = riddle;
            if (!riddle) answer.value = '';
            answerHint.textContent = riddle ? '答案（必填，1～60 字）' : '答案（僅急轉彎可填）';
          };
          category.addEventListener('change', syncAnswer); syncAnswer();
          const creditLabel = node('label', '出處（選填，最多 100 字；網址限 HTTPS，無查詢參數）'); const credit = node('textarea');
          credit.maxLength = 200; credit.value = row.credit ?? ''; creditLabel.append(credit);
          const reasonLabel = node('label', '退回／下架理由（選填，最多 200 字）'); const reason = node('textarea');
          reason.maxLength = 200; reason.value = row.reject_reason ?? ''; reasonLabel.append(reason);
          const message = node('p'); message.setAttribute('role', 'status'); const buttons = [];
          card.append(categoryLabel, answerLabel, creditLabel, reasonLabel);
          for (const [newStatus, label] of [['approved', status === 'pending' ? '核准' : '儲存分類'], ['rejected', status === 'pending' ? '退回' : '下架']]) {
            const button = node('button', label, 'btn'); button.type = 'button'; buttons.push(button);
            button.addEventListener('click', async () => {
              if (button.disabled || loading || !current(stamp)) return;
              if (newStatus === 'rejected' && !confirm(`${label}這則笑話？`)) return;
              buttons.forEach((b) => { b.disabled = true; }); message.textContent = '儲存中…';
              try {
                const error = jokeFieldsError({ category: category.value, body: row.body, answer: answer.value || null, credit: credit.value || null });
                if (error) throw new Error(error);
                await client.review(row, newStatus, category.value, reason.value, answer.value.trim() || null, credit.value.trim() || null);
                if (!current(stamp)) return;
                await load(true);
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
      if (saved) showNotice();
    } catch (error) {
      if (!current(stamp)) return;
      if (error.message.startsWith('沒有權限')) { clear(); onDenied(); }
      else {
        if (saved) showNotice();
        $('jokes-status').textContent = `讀取失敗：${error.message}，請重新載入重試。`;
      }
    } finally { if (current(stamp)) { loading = false; $('reload-jokes').disabled = false; } }
  };
  const categories = $('jokes-category-filter');
  for (const value of ['', ...JOKE_CATEGORIES]) { const option = node('option', value || '全部分類'); option.value = value; categories.append(option); }
  const states = $('jokes-state-filter');
  for (const [value, label] of [['', '全部狀態'], ['pending', '待審'], ['approved', '已上架'], ['rejected', '已下架']]) {
    const option = node('option', label); option.value = value; states.append(option);
  }
  categories.value = ''; states.value = 'pending';
  const sources = $('jokes-source-filter');
  for (const [value, label] of [['', '全部來源'], ['editor', '編輯錄入'], ['submitted', '玩家投稿'], ['builtin', '內建']]) {
    const option = node('option', label); option.value = value; sources.append(option);
  }
  sources.value = '';
  const controls = [categories, states, sources];
  for (const kind of dateControls) {
    const select = $('jokes-' + kind + '-filter');
    for (const [value, label] of [['all', '全部'], ['today', '今天'], ['7days', '近 7 天'], ['custom', '自訂']]) {
      const option = node('option', label); option.value = value; select.append(option);
    }
    select.value = 'all';
    controls.push(select, $('jokes-' + kind + '-from'), $('jokes-' + kind + '-to'));
  }
  syncDates();
  for (const filter of controls) filter.addEventListener('change', () => {
    syncDates();
    if (dateControls.some((kind) => filter === $('jokes-' + kind + '-filter') && filter.value === 'custom' &&
        !$('jokes-' + kind + '-from').value && !$('jokes-' + kind + '-to').value)) {
      $('jokes-status').textContent = ''; return;
    }
    return load(false, 1);
  });
  for (const [id, step] of [['jokes-prev', -1], ['jokes-next', 1]]) $(id).addEventListener('click', () => {
    if (loading || $(id).disabled) return; return load(false, page + step);
  });
  const invalidate = () => {
    preview = null; ++importEpoch; $('jokes-import-submit').disabled = true;
    $('jokes-import-preview').replaceChildren(); $('jokes-import-status').textContent = '';
  };
  $('jokes-import-text').addEventListener('input', invalidate);
  $('jokes-import-check').addEventListener('click', () => {
    if (importing || auth.session?.user.id !== userId) return;
    invalidate(); preview = parseJokeImport($('jokes-import-text').value);
    const container = $('jokes-import-preview');
    for (const error of preview.errors) container.append(node('p', error));
    for (const [index, row] of preview.rows.entries()) {
      const card = node('article', '', 'admin-card');
      card.append(node('p', `${index + 1}.【${row.category}】${row.body}`, 'joke-body'),
        node('p', `答案：${row.answer ?? '無'}`, 'joke-body'), node('p', `出處：${row.credit ?? '原創（無出處）'}`, 'joke-body'));
      container.append(card);
    }
    $('jokes-import-status').textContent = preview.valid ? `檢查通過，共 ${preview.rows.length} 則。請確認預覽後送出。` : '檢查未通過，請修正後重新預覽。';
    $('jokes-import-submit').disabled = !preview.valid;
  });
  $('jokes-import-submit').disabled = true;
  $('jokes-import-submit').addEventListener('click', async () => {
    if (importing || !preview?.valid || auth.session?.user.id !== userId) return;
    const stamp = ++importEpoch; importing = true; const rows = preview.rows;
    const approve = $('jokes-direct-approve').checked === true;
    const controls = ['jokes-import-text', 'jokes-direct-approve', 'jokes-import-check', 'jokes-import-submit'];
    controls.forEach((id) => { $(id).disabled = true; });
    $('jokes-import-status').textContent = '匯入中…';
    try {
      const result = await client.import(rows, approve);
      if (stamp !== importEpoch || auth.session?.user.id !== userId) return;
      preview = null; $('jokes-import-text').value = ''; $('jokes-direct-approve').checked = false;
      $('jokes-import-preview').replaceChildren();
      states.value = approve ? 'approved' : 'pending';
      $('jokes-import-status').textContent = `匯入 ${result.inserted} 則，已存在略過 ${result.skipped} 則。目前顯示狀態篩選：${approve ? '已上架' : '待審'}。`;
      await load(false, 1);
    } catch (error) {
      if (stamp !== importEpoch || auth.session?.user.id !== userId) return;
      if (error.message.startsWith('沒有權限')) { clear(); onDenied(); }
      else $('jokes-import-status').textContent = `匯入失敗：${error.message}；若回應遺失，重新送出會依題目去重。`;
    } finally {
      if (stamp === importEpoch && auth.session?.user.id === userId) {
        importing = false; controls.forEach((id) => { $(id).disabled = false; });
        $('jokes-import-submit').disabled = !preview?.valid;
      }
    }
  });
  $('reload-jokes').addEventListener('click', () => load());
  return { clear, load, open: () => loaded ? undefined : load() };
}
