import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=19c6738';
import { element } from '../shared/feedback.js?v=19c6738';
import { JOKE_CATEGORIES, jokeFieldsError, normalizeJokeBody, parseJokeImport } from './joke-import.js?v=19c6738';

export { JOKE_CATEGORIES, parseJokeImport } from './joke-import.js?v=19c6738';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
    async list({ page = 1, category = '', status = '' } = {}) {
      if (!Number.isInteger(page) || page < 1 || (category && !JOKE_CATEGORIES.includes(category)) ||
          (status && !['pending', 'approved', 'rejected'].includes(status))) throw new Error('篩選無效');
      const id = await requireAdmin();
      const result = await call(id, 'rpc/list_line_jokes_admin', { p_page: page, p_category: category || null, p_status: status || null });
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

export function initJokesPanel({ doc, auth, client, onDenied = () => {}, confirm = globalThis.confirm }) {
  const $ = (id) => doc.getElementById(id);
  const node = (tag, text, cls) => element(doc, tag, text, cls);
  const userId = auth.session?.user.id;
  let epoch = 0; let loaded = false; let loading = false;
  let page = 1; let total = 0; let preview = null; let importing = false; let importEpoch = 0;
  const current = (stamp) => stamp === epoch && auth.session?.user.id === userId;
  const clear = () => {
    ++epoch; loaded = false; loading = false;
    ++importEpoch; preview = null; importing = false; page = 1; total = 0;
    for (const id of ['pending-jokes', 'approved-jokes', 'rejected-jokes', 'jokes-import-preview']) $(id).replaceChildren();
    $('jokes-import-text').value = ''; $('jokes-direct-approve').checked = false;
    $('jokes-import-status').textContent = ''; $('jokes-page').textContent = '';
    $('jokes-import-submit').disabled = true; $('jokes-import-check').disabled = false;
    $('jokes-import-text').disabled = false; $('jokes-direct-approve').disabled = false;
    $('jokes-category-filter').value = ''; $('jokes-state-filter').value = '';
    $('jokes-prev').disabled = true; $('jokes-next').disabled = true;
    $('jokes-status').textContent = ''; $('reload-jokes').disabled = false;
  };
  const load = async () => {
    if (auth.session?.user.id !== userId) return;
    const stamp = ++epoch; loading = true; $('reload-jokes').disabled = true;
    $('jokes-status').textContent = '載入中…';
    try {
      const result = await client.list({ page, category: $('jokes-category-filter').value, status: $('jokes-state-filter').value });
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
  const categories = $('jokes-category-filter');
  for (const value of ['', ...JOKE_CATEGORIES]) { const option = node('option', value || '全部分類'); option.value = value; categories.append(option); }
  const states = $('jokes-state-filter');
  for (const [value, label] of [['', '全部狀態'], ['pending', '待審'], ['approved', '已上架'], ['rejected', '已下架']]) {
    const option = node('option', label); option.value = value; states.append(option);
  }
  categories.value = ''; states.value = '';
  for (const filter of [categories, states]) filter.addEventListener('change', () => { page = 1; return load(); });
  for (const [id, step] of [['jokes-prev', -1], ['jokes-next', 1]]) $(id).addEventListener('click', () => {
    if (loading || $(id).disabled) return; page += step; return load();
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
    const controls = ['jokes-import-text', 'jokes-direct-approve', 'jokes-import-check', 'jokes-import-submit'];
    controls.forEach((id) => { $(id).disabled = true; });
    $('jokes-import-status').textContent = '匯入中…';
    try {
      const result = await client.import(rows, $('jokes-direct-approve').checked === true);
      if (stamp !== importEpoch || auth.session?.user.id !== userId) return;
      preview = null; $('jokes-import-text').value = ''; $('jokes-direct-approve').checked = false;
      $('jokes-import-preview').replaceChildren();
      $('jokes-import-status').textContent = `匯入 ${result.inserted} 則，已存在略過 ${result.skipped} 則。`;
      page = 1; await load();
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
  $('reload-jokes').addEventListener('click', load);
  return { clear, load, open: () => loaded ? undefined : load() };
}
