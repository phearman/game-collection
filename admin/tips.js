// RS55 後台「小常識」頁籤:批次匯入(預設待審)、狀態篩選清單、核准/退回/下架。規則以 migration 0031 為準。
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=e848582';
import { element } from '../shared/feedback.js?v=e848582';
import { normalizeJokeBody } from './joke-import.js?v=e848582';

export const TIP_CATEGORIES = Object.freeze(['生活', '健康', '飲食', '自然', '動物', '天文', '人體', '語文', '歷史']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const length = (value) => Array.from(value).length;
const forbiddenCharacters = /[\u0000-\u001f\u007f-\u009f​-‍‪-‮⁦-⁩﻿]/u;

// 出處必填 2~60 字,不可是網址(SQL line_tip_credit_valid 的同一規則)。
export function tipCreditValid(value) {
  if (typeof value !== 'string' || length(value.trim()) < 2 || length(value.trim()) > 60) return false;
  const text = value.normalize('NFKC');
  return !forbiddenCharacters.test(text) && !/(?:javascript|data|mailto|tel):/iu.test(text)
    && !/(?:www\.|[a-z][a-z0-9+.-]*:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,63}($|[^a-z0-9-]))/iu.test(text);
}

export function tipFieldsError({ category, body, credit }) {
  if (!TIP_CATEGORIES.includes(category)) return '分類無效';
  if (typeof body !== 'string' || length(body.trim()) < 10 || length(body.trim()) > 150 ||
      length(body.trim().normalize('NFKC')) < 10 || length(body.trim().normalize('NFKC')) > 150 ||
      forbiddenCharacters.test(body.normalize('NFKC')) || !normalizeJokeBody(body)) return '內容需 10～150 字，不可含控制或零寬字元';
  if (!tipCreditValid(credit)) return '出處必填 2～60 字，不可放網址';
  return null;
}

function csvRows(text) {
  const rows = []; let row = []; let field = ''; let quoted = false; let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === ',' || char === '\n') {
      row.push(field); field = ''; closed = false;
      if (char === '\n') { rows.push(row); row = []; }
    } else if (char === '"') {
      if (field || closed) throw new Error('CSV 引號格式錯誤');
      quoted = true;
    } else {
      if (closed) throw new Error('CSV 引號後只能接逗號或換行');
      field += char;
    }
  }
  if (quoted) throw new Error('CSV 引號未結束');
  row.push(field); rows.push(row); return rows;
}

// 三欄:分類,內容,出處(CSV,可含標題列);或每行「分類|內容|出處」。
export function parseTipImport(input) {
  const errors = []; const rows = [];
  if (typeof input !== 'string') return { rows, errors: ['請貼上匯入文字'], valid: false };
  const text = input.replace(/^﻿/u, '').replace(/\r\n?/gu, '\n');
  let values;
  try {
    const first = text.split('\n').find((line) => line.trim()) ?? '';
    const pipe = first.includes('|') && !first.startsWith('"') && (!first.includes(',') || first.indexOf('|') < first.indexOf(','));
    values = (pipe ? text.split('\n').map((line) => line.split('|')) : csvRows(text)).filter((row) => row.some((field) => field.trim()));
    if (values[0]?.map((field) => field.trim()).join(',') === '分類,內容,出處') values.shift();
  } catch (error) { return { rows, errors: [error.message], valid: false }; }
  if (!values.length || values.length > 200) errors.push('單次需 1～200 則');
  const seen = new Set();
  values.forEach((fields, index) => {
    if (fields.length !== 3) { errors.push(`第 ${index + 1} 則：需三欄（分類、內容、出處）`); return; }
    const [category, body, credit] = fields.map((field) => field.trim());
    rows.push({ category, body, credit });
    const error = tipFieldsError({ category, body: fields[1], credit: fields[2] });
    if (error) errors.push(`第 ${index + 1} 則：${error}`);
    const key = normalizeJokeBody(body);
    if (seen.has(key)) errors.push(`第 ${index + 1} 則：檔內內容重複`);
    seen.add(key);
  });
  return { rows, errors, valid: errors.length === 0 };
}

export function createTipsClient({ auth, client, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY,
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
      response = await request(`${url.replace(/\/$/, '')}/rest/v1/${path}`, { method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new Error('連線失敗，請稍後重試'); }
    if (auth.session?.user.id !== id) throw new Error('沒有權限');
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('沒有權限');
      let error; try { error = await response.json(); } catch { /* Never display raw API text. */ }
      if (error?.message === 'LINE_TIP_CHANGED') throw new Error('這則小常識已變更，請重新載入');
      throw new Error('小常識服務暫時無法使用，請稍後重試');
    }
    let data;
    try { data = response.status === 204 ? null : await response.json(); }
    catch { throw new Error('小常識服務暫時無法使用，請稍後重試'); }
    if (auth.session?.user.id !== id) throw new Error('沒有權限');
    return data;
  }
  return {
    async list({ page = 1, status = '' } = {}) {
      if (!Number.isInteger(page) || page < 1 || (status && !['pending', 'approved', 'rejected'].includes(status))) throw new Error('篩選無效');
      const id = await requireAdmin();
      const result = await call(id, 'rpc/list_line_tips_admin', { p_page: page, p_status: status || null });
      if (!Array.isArray(result?.rows) || result.rows.length > 50 || !Number.isInteger(result.total) || result.total < 0 ||
          !Number.isInteger(result.page) || result.page < 1) throw new Error('小常識服務暫時無法使用');
      return result;
    },
    async review(row, status, category, credit, reason = '') {
      if (!UUID.test(row?.id) || !['pending', 'approved'].includes(row.status) || !['approved', 'rejected'].includes(status) ||
          typeof reason !== 'string' || length(reason) > 200) throw new Error('狀態或理由無效（理由最多 200 字）');
      const error = tipFieldsError({ category, body: row.body, credit });
      if (error) throw new Error(error);
      const id = await requireAdmin();
      return call(id, 'rpc/review_line_tip', { p_id: row.id, p_status: status, p_category: category,
        p_credit: credit.trim(), p_reason: reason.trim(), p_expected_status: row.status });
    },
    async import(rows, approve = false) {
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200 || typeof approve !== 'boolean') throw new Error('匯入需 1～200 則');
      const seen = new Set();
      const checked = rows.map((row) => {
        const error = row && tipFieldsError(row);
        if (!row || error) throw new Error(error || '匯入欄位無效');
        const hash = normalizeJokeBody(row.body);
        if (seen.has(hash)) throw new Error('檔內內容重複');
        seen.add(hash);
        return { category: row.category, body: row.body.trim(), credit: row.credit.trim() };
      });
      const id = await requireAdmin();
      const result = await call(id, 'rpc/import_line_tips', { p_rows: checked, p_approve: approve });
      if (!Number.isInteger(result?.inserted) || !Number.isInteger(result?.skipped) || result.inserted < 0 || result.skipped < 0 ||
          result.inserted + result.skipped !== rows.length) throw new Error('匯入結果無效，請重新載入確認後再試');
      return result;
    },
  };
}

export function initTipsPanel({ doc, auth, client, onDenied = () => {}, confirm = globalThis.confirm }) {
  const $ = (id) => doc.getElementById(id);
  const node = (tag, text, cls) => element(doc, tag, text, cls);
  const userId = auth.session?.user.id;
  let epoch = 0; let loaded = false; let loading = false; let page = 1; let total = 0;
  let preview = null; let importing = false; let importEpoch = 0;
  const current = (stamp) => stamp === epoch && auth.session?.user.id === userId;
  const clear = () => {
    ++epoch; ++importEpoch; loaded = false; loading = false; preview = null; importing = false; page = 1; total = 0;
    for (const id of ['tips-list', 'tips-import-preview']) $(id).replaceChildren();
    $('tips-import-text').value = ''; $('tips-direct-approve').checked = false;
    for (const id of ['tips-import-status', 'tips-page', 'tips-status']) $(id).textContent = '';
    $('tips-import-submit').disabled = true; $('tips-state-filter').value = 'pending';
    $('tips-prev').disabled = true; $('tips-next').disabled = true; $('reload-tips').disabled = false;
  };
  const denied = () => { clear(); onDenied(); };
  const card = (row, stamp) => {
    const box = node('article', '', 'admin-card');
    box.append(node('p', row.body, 'joke-body'), node('p', `建立時間：${new Date(row.created_at).toLocaleString()}`));
    if (row.status === 'approved' && row.daily_after) box.append(node('p', `今日小常識輪替起日：${row.daily_after}`));
    if (row.status === 'rejected') {
      box.append(node('p', `分類：${row.category}`), node('p', `出處：${row.credit}`), node('p', `下架理由：${row.reject_reason ?? ''}`));
      return box;
    }
    const categoryLabel = node('label', '分類'); const category = node('select');
    for (const value of TIP_CATEGORIES) { const option = node('option', value); option.value = value; category.append(option); }
    category.value = row.category; categoryLabel.append(category);
    const creditLabel = node('label', '出處（必填，2～60 字，不放網址）'); const credit = node('textarea');
    credit.maxLength = 120; credit.value = row.credit ?? ''; creditLabel.append(credit);
    const reasonLabel = node('label', '退回／下架理由（選填，最多 200 字）'); const reason = node('textarea');
    reason.maxLength = 200; reason.value = row.reject_reason ?? ''; reasonLabel.append(reason);
    const message = node('p'); message.setAttribute('role', 'status'); const buttons = [];
    box.append(categoryLabel, creditLabel, reasonLabel);
    for (const [status, label] of [['approved', row.status === 'pending' ? '核准' : '儲存'], ['rejected', row.status === 'pending' ? '退回' : '下架']]) {
      const button = node('button', label, 'btn'); button.type = 'button'; buttons.push(button);
      button.addEventListener('click', async () => {
        if (button.disabled || loading || !current(stamp)) return;
        if (status === 'rejected' && !confirm(`${label}這則小常識？`)) return;
        buttons.forEach((b) => { b.disabled = true; }); message.textContent = '儲存中…';
        try {
          await client.review(row, status, category.value, credit.value, reason.value);
          if (current(stamp)) await load();
        } catch (error) {
          if (!current(stamp)) return;
          if (error.message.startsWith('沒有權限')) denied(); else message.textContent = `操作失敗：${error.message}`;
        } finally { buttons.forEach((b) => { b.disabled = false; }); }
      });
      box.append(button);
    }
    box.append(message);
    return box;
  };
  const load = async (selectedPage = page) => {
    if (auth.session?.user.id !== userId) return;
    const stamp = ++epoch; loading = true; $('reload-tips').disabled = true; $('tips-status').textContent = '載入中…';
    try {
      const result = await client.list({ page: selectedPage, status: $('tips-state-filter').value });
      if (!current(stamp)) return;
      page = result.page; total = result.total;
      $('tips-page').textContent = `第 ${page} / ${Math.max(1, Math.ceil(total / 50))} 頁 · 共 ${total} 則 · 每頁 50 則`;
      $('tips-prev').disabled = page <= 1; $('tips-next').disabled = page * 50 >= total;
      $('tips-list').replaceChildren();
      if (!result.rows.length) $('tips-list').append(node('p', '沒有符合的小常識。'));
      for (const row of result.rows) $('tips-list').append(card(row, stamp));
      loaded = true; $('tips-status').textContent = '';
    } catch (error) {
      if (!current(stamp)) return;
      if (error.message.startsWith('沒有權限')) denied(); else $('tips-status').textContent = `讀取失敗：${error.message}，請重新載入重試。`;
    } finally { if (current(stamp)) { loading = false; $('reload-tips').disabled = false; } }
  };
  const states = $('tips-state-filter');
  for (const [value, label] of [['', '全部狀態'], ['pending', '待審'], ['approved', '已上架'], ['rejected', '已下架']]) {
    const option = node('option', label); option.value = value; states.append(option);
  }
  states.value = 'pending';
  states.addEventListener('change', () => load(1));
  for (const [id, step] of [['tips-prev', -1], ['tips-next', 1]]) $(id).addEventListener('click', () => {
    if (loading || $(id).disabled) return; return load(page + step);
  });
  const invalidate = () => { preview = null; ++importEpoch; $('tips-import-submit').disabled = true;
    $('tips-import-preview').replaceChildren(); $('tips-import-status').textContent = ''; };
  $('tips-import-text').addEventListener('input', invalidate);
  $('tips-import-check').addEventListener('click', () => {
    if (importing || auth.session?.user.id !== userId) return;
    invalidate(); preview = parseTipImport($('tips-import-text').value);
    const container = $('tips-import-preview');
    for (const error of preview.errors) container.append(node('p', error));
    for (const [index, row] of preview.rows.entries()) {
      const box = node('article', '', 'admin-card');
      box.append(node('p', `${index + 1}.【${row.category}】${row.body}`, 'joke-body'), node('p', `出處：${row.credit}`, 'joke-body'));
      container.append(box);
    }
    $('tips-import-status').textContent = preview.valid ? `檢查通過，共 ${preview.rows.length} 則。請確認預覽後送出。` : '檢查未通過，請修正後重新預覽。';
    $('tips-import-submit').disabled = !preview.valid;
  });
  $('tips-import-submit').disabled = true;
  $('tips-import-submit').addEventListener('click', async () => {
    if (importing || !preview?.valid || auth.session?.user.id !== userId) return;
    const stamp = ++importEpoch; importing = true; const approve = $('tips-direct-approve').checked === true;
    const controls = ['tips-import-text', 'tips-direct-approve', 'tips-import-check', 'tips-import-submit'];
    controls.forEach((id) => { $(id).disabled = true; }); $('tips-import-status').textContent = '匯入中…';
    try {
      const result = await client.import(preview.rows, approve);
      if (stamp !== importEpoch || auth.session?.user.id !== userId) return;
      preview = null; $('tips-import-text').value = ''; $('tips-direct-approve').checked = false; $('tips-import-preview').replaceChildren();
      states.value = approve ? 'approved' : 'pending';
      $('tips-import-status').textContent = `匯入 ${result.inserted} 則，已存在略過 ${result.skipped} 則。`;
      await load(1);
    } catch (error) {
      if (stamp !== importEpoch || auth.session?.user.id !== userId) return;
      if (error.message.startsWith('沒有權限')) denied();
      else $('tips-import-status').textContent = `匯入失敗：${error.message}；若回應遺失，重新送出會依內容去重。`;
    } finally {
      if (stamp === importEpoch && auth.session?.user.id === userId) {
        importing = false; controls.forEach((id) => { $(id).disabled = false; }); $('tips-import-submit').disabled = !preview?.valid;
      }
    }
  });
  $('reload-tips').addEventListener('click', () => load());
  return { clear, load, open: () => loaded ? undefined : load() };
}
