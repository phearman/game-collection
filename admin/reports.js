import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=4a61272';
export const REPORT_STATUS = Object.freeze({ draft:'未送出',new:'新的',triage:'評估中',need_info:'需要更多資訊',planned:'已排入處理',released:'已完成',declined:'不處理',duplicate:'重複',cancelled:'回報者已取消' });
export const REPORT_URGENCY = Object.freeze({ high:'高',mid:'中',low:'低',unsure:'不確定' });
export const REPORT_CATEGORY = Object.freeze({ issue:'問題',request:'需求',todo:'待辦',query:'查詢',unsure:'不確定' });
export function createReportsClient({ auth, client, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY,
  fetch: request = globalThis.fetch } = {}) {
  async function rpc(name, body, edge = false) {
    const uid = auth?.session?.user.id;
    if (!uid || await client.isAdmin() !== true || auth.session?.user.id !== uid) throw new Error('沒有權限');
    const token = await auth.accessToken();
    if (!token || auth.session?.user.id !== uid) throw new Error('沒有權限');
    let response;
    try {
      response = await request(edge ? `${url.replace(/\/$/,'')}/functions/v1/line-webhook` : `${url.replace(/\/$/,'')}/rest/v1/rpc/${name}`, { method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new Error('回報服務暫時無法使用，請稍後重試'); }
    if (auth.session?.user.id !== uid) throw new Error('沒有權限');
    if (!response.ok) throw new Error([401,403].includes(response.status) ? '沒有權限' : '儲存失敗，請檢查必填欄位後重試');
    let result;
    try { result = await response.json(); } catch { throw new Error('回報服務暫時無法使用'); }
    if (auth.session?.user.id !== uid) throw new Error('沒有權限');
    if (result?.status === 'changed') throw new Error('這則回報已變動，請重新載入');
    return result;
  }
  return {
    list: (filters = {}, page = 1) => rpc('list_work_reports_admin', { p_filters: filters, p_page: page }),
    update: (row, patch) => rpc('update_work_report_admin', { p_id: row.id, p_revision: row.revision, p_patch: patch }),
    sync: (row, ref) => rpc('set_work_report_sync', { p_id: row.id, p_revision: row.revision, p_external_ref: ref }),
    history: (id) => rpc('work_report_history_admin', { p_id: id }),
    metadata: (data = {}) => rpc('work_poc_admin', { p_action: 'list', p_data: data }),
    project: (action, data) => rpc('work_poc_admin', { p_action: action, p_data: data }),
    purge: (confirmation) => rpc('', { action:'report_purge',confirmation },true),
    itemImages: (code) => rpc('', { action:'item_images',code },true),
    images: (id) => rpc('', { action:'report_images',id },true),
    cleanupImages: () => rpc('', { action:'report_image_cleanup' },true),
  };
}
const csvCell = (value) => {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+\-@\t\r]/u.test(text) ? "'" : '') + text.replaceAll('"','""')}"`;
};
// Explicit columns: never serialize entire rows into CSV.
export function reportsCSV(rows) {
  const columns = ['編號','事件碼','描述','專案','緊急','分類','狀態','回報者','來源','負責人','備註','理由','重複編號','送出時間','已同步時間','外部單號','附圖'];
  return '\ufeff' + [columns, ...rows.map((r) => [r.report_no,r.event_code,r.body,r.project_unsure ? '不確定' : r.project_code,
    REPORT_URGENCY[r.urgency],REPORT_CATEGORY[r.category],REPORT_STATUS[r.status],r.reporter,r.source,r.assignee,
    r.note,r.reason,r.duplicate_of_no,r.submitted_at,r.synced_at,r.external_ref,`附圖 ${r.image_count ?? 0} 張`])].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export async function purgeWorkPoc(client, { confirm = globalThis.confirm, prompt = globalThis.prompt } = {}) {
  if (!confirm('確定清空所有測試事項、回報、附圖、專案、成員、群組綁定、同意與代稱，並將全部群組重設為休閒群？事件碼計數保留、不重用。')) return null;
  const answer = prompt('此動作無法復原，請輸入「清空」確認');
  if (answer !== '清空') return null;
  return client.purge(answer);
}
export function initReportsPanel({ doc, auth, client, confirm = globalThis.confirm, prompt = globalThis.prompt, onDenied = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  const node = (tag, content) => { const el = doc.createElement(tag); if (content !== undefined) el.textContent = content; return el; };
  const uid = auth.session?.user.id;
  let epoch = 0; let loaded = false; let page = 1; let busy = false; let meta = { projects: [], members: [], admins: [] };
  const imageClosers=new Set();
  const closeAllImages=() => { for (const close of imageClosers) close(); imageClosers.clear(); };
  const current = (stamp) => stamp === epoch && auth.session?.user.id === uid;
  const options = (values, selected = '', empty = '未選') => {
    const select = node('select');
    for (const [value,label] of [['',empty],...Object.entries(values)]) { const option = node('option',label); option.value = value; select.append(option); }
    select.value = selected ?? ''; return select;
  };
  const label = (name, input) => { const el = node('label',name); el.append(input); return el; };
  const button = (name, action) => { const el = node('button',name); el.type='button'; el.className='btn'; el.addEventListener('click',action); return el; };
  const filters = () => Object.fromEntries(['project','status','urgency','category','synced','keyword'].map((f) => [f,$(`reports-filter-${f}`).value]));
  const clear = () => {
    closeAllImages();
    ++epoch; loaded=false; busy=false; page=1; meta={ projects: [], members: [], admins: [] };
    $('item-images-result')?.replaceChildren();
    if ($('item-images-code')) $('item-images-code').value='';
    for (const id of ['reports-rows','reports-projects','reports-members']) $(id).replaceChildren();
    for (const id of ['reports-status','reports-page','reports-invite']) $(id).textContent='';
    for (const id of ['reports-project-code','reports-project-name','reports-filter-keyword']) $(id).value='';
    const select=$('reports-filter-project'); select.replaceChildren(node('option','全部專案')); select.value='';
  };
  const error = (err, stamp) => { if (current(stamp)) { $('reports-status').textContent=err.message; if (err.message.startsWith('沒有權限')) { clear(); onDenied(); } } };
  async function mutate(action, success = '已儲存') {
    if (busy || auth.session?.user.id !== uid) return;
    busy=true; const stamp=epoch;
    try {
      const result=await action(); if (!current(stamp)) return;
      if (result?.invite_code) $('reports-invite').textContent=`邀請碼（只顯示一次，離開前請自行保存）：${result.invite_code}`;
      busy=false; if (await load(false)) $('reports-status').textContent=typeof success==='function' ? success(result) : success;
    } catch (err) { error(err,stamp); }
    finally { if (current(stamp)) busy=false; }
  }
  function renderProjects() {
    $('reports-projects').replaceChildren(); $('reports-members').replaceChildren();
    for (const p of meta.projects) {
      const article=node('article'); article.append(node('p',`${p.code} · ${p.name} · ${p.active ? '啟用' : '停用'}`),
        button(p.active ? '停用' : '啟用',() => mutate(() => client.project('active',{ id:p.id,active:!p.active }))),
        button('重產邀請碼',() => { if (confirm('舊邀請碼將立即失效，確定重產？')) return mutate(() => client.project('invite',{ id:p.id })); }));
      $('reports-projects').append(article);
    }
    for (const m of meta.members) {
      const item=node('p',`${meta.projects.find((p) => p.id===m.project_id)?.code ?? ''} · ${m.name} · 加入途徑：${m.joined_via==='group' ? m.via_group_name || '群組' : '邀請碼'}`);
      item.append(button('移除成員',() => { if (confirm(`移除「${m.name}」的專案資格？`)) return mutate(() => client.project('remove_member',{ id:m.id })); }));
      $('reports-members').append(item);
    }
  }
  function renderReports(rows) {
    closeAllImages();
    $('reports-rows').replaceChildren();
    if (!rows.length) $('reports-rows').append(node('p','目前沒有符合條件的回報。'));
    for (const r of rows) {
      const card=node('article'); card.className='admin-card';
      const images=node('div'); let imageTimer; let imageEpoch=0;
      const removeImages=() => { ++imageEpoch; clearTimeout(imageTimer); images.replaceChildren(); };
      imageClosers.add(removeImages);
      card.append(node('p',`附圖 ${r.image_count ?? 0} 張`),button('看圖',async () => {
        removeImages(); const stamp=epoch; const imageStamp=imageEpoch;
        try {
          const result=await client.images(r.id); if (!current(stamp) || imageStamp!==imageEpoch) return;
          for (const url of result.images) {
            const img=node('img'); img.referrerPolicy='no-referrer'; img.alt='回報附圖'; img.style.maxWidth='100%'; img.src=url; images.append(img);
          }
          // URLs exist only in the visible DOM for this session; never persist/export them.
          imageTimer=setTimeout(removeImages,60000);
        } catch (err) { error(err,stamp); }
      }),button('關閉圖片',removeImages),images);
      card.append(node('h3',`${r.event_code ? `${r.event_code} · ` : ''}#${r.report_no} · ${REPORT_STATUS[r.status]}`),node('p',r.body),
        node('p',`${r.reporter} · ${r.source} · ${r.submitted_at}`));
      const fields={};
      fields.status=options(Object.fromEntries(Object.entries(REPORT_STATUS).filter(([s]) => !['draft','cancelled'].includes(s))),r.status);
      fields.project_id=options(Object.fromEntries([...meta.projects.filter((p) => p.active || p.id===r.project_id)
        .map((p) => [p.id,`${p.code}${p.active ? '' : '（停用）'}`]),['unsure','不確定']]),r.project_unsure ? 'unsure' : r.project_id);
      fields.urgency=options(REPORT_URGENCY,r.urgency); fields.category=options(REPORT_CATEGORY,r.category);
      fields.assignee_id=options(Object.fromEntries(meta.admins.map((a) => [a.id,a.name])),r.assignee_id,'未指派');
      for (const [key,name] of [['status','狀態'],['project_id','專案'],['urgency','緊急'],['category','分類'],['assignee_id','負責人']]) card.append(label(name,fields[key]));
      for (const [key,name] of [['note','備註（需要更多資訊必填）'],['reason','理由（不處理必填）'],['duplicate_of_no','重複回報編號（重複必填）']]) {
        fields[key]=node(key==='duplicate_of_no' ? 'input' : 'textarea'); fields[key].value=r[key] ?? ''; fields[key].maxLength=1000;
        card.append(label(name,fields[key]));
      }
      const save=button('儲存',() => mutate(() => {
        const patch=Object.fromEntries(Object.entries(fields).map(([k,input]) => [k,input.value || (['note','reason'].includes(k) ? '' : null)]));
        patch.project_unsure=patch.project_id==='unsure'; if (patch.project_unsure) patch.project_id=null;
        patch.duplicate_of_no=patch.duplicate_of_no ? Number(patch.duplicate_of_no) : null;
        const changes=Object.fromEntries(Object.entries(patch).filter(([key,value]) =>
          value !== (r[key] ?? (['note','reason'].includes(key) ? '' : key==='project_unsure' ? false : null))));
        return client.update(r,changes);
      }));
      const ref=node('input'); ref.value=r.external_ref ?? ''; ref.maxLength=50;
      const sync=button('標為已同步',() => {
        if (!ref.value.trim()) { $('reports-status').textContent='請填寫外部單號（1～50 字）'; return; }
        return mutate(() => client.sync(r,ref.value.trim()));
      });
      const unsync=button('清除同步標記',() => mutate(() => client.sync(r,null)));
      const history=node('details'); history.append(node('summary','歷程')); const entries=node('div'); history.append(entries);
      history.addEventListener('toggle',async () => {
        if (!history.open) return; const stamp=epoch;
        try {
          const result=await client.history(r.id); if (!current(stamp)) return;
          entries.replaceChildren(...result.map((e) => node('p',`${e.at} · ${e.actor_kind} · ${e.field} · ${REPORT_STATUS[e.from_status]} → ${REPORT_STATUS[e.to_status]} · ${e.note}`)));
        } catch (err) { error(err,stamp); }
      });
      if (r.status==='cancelled') { for (const input of Object.values(fields)) input.disabled=true; save.disabled=true; sync.disabled=true; unsync.disabled=true; }
      card.append(save,label('外部單號（只用假資料）',ref),node('p',r.synced_at ? `已同步：${r.synced_at}` : '未同步'),sync,unsync,history);
      $('reports-rows').append(card);
    }
  }
  async function load(clearInvite = true) {
    const stamp=++epoch; busy=true; $('reports-status').textContent='載入中…';
    if (clearInvite) $('reports-invite').textContent='';
    try {
      const data=await client.metadata(); if (!current(stamp)) return;
      const result=await client.list(filters(),page); if (!current(stamp)) return;
      meta=data; renderProjects(); renderReports(result.rows);
      const selected=$('reports-filter-project').value;
      const select=options(Object.fromEntries(meta.projects.map((p) => [p.id,p.code])),selected,'全部專案');
      $('reports-filter-project').replaceChildren(...Array.from(select.children)); $('reports-filter-project').value=selected;
      $('reports-page').textContent=`第 ${page} 頁 · 共 ${result.total} 則`;
      $('reports-prev').disabled=page<=1; $('reports-next').disabled=page*50>=result.total;
      $('reports-status').textContent=''; loaded=true; return true;
    } catch (err) { error(err,stamp); }
    finally { if (current(stamp)) busy=false; }
  }
  for (const [field,values] of [['status',REPORT_STATUS],['urgency',REPORT_URGENCY],['category',REPORT_CATEGORY]]) {
    const select=options(Object.fromEntries(Object.entries(values).filter(([s]) => s!=='draft')),'','全部');
    $(`reports-filter-${field}`).replaceChildren(...Array.from(select.children));
  }
  let itemImageTimer; let itemImageEpoch=0;
  const closeItemImages=() => { ++itemImageEpoch; clearTimeout(itemImageTimer); $('item-images-result')?.replaceChildren(); };
  imageClosers.add(closeItemImages);
  $('item-images-search')?.addEventListener('click',async () => {
    closeItemImages(); imageClosers.add(closeItemImages); const stamp=epoch; const imageStamp=itemImageEpoch;
    try {
      const result=await client.itemImages($('item-images-code').value.trim());
      if (!current(stamp) || imageStamp!==itemImageEpoch) return;
      const box=$('item-images-result');
      box.append(node('p',result.status==='missing' ? '查不到這個事件碼' : `${result.event_code} · ${result.body} · 附圖 ${result.images.length} 張`));
      // IR72:圖片放進圖庫格線(版面由 admin/index.html 的 .item-images-gallery 控制)。
      const gallery=node('div'); gallery.className='item-images-gallery';
      const urls=result.images ?? [];
      urls.forEach((url,i) => { const img=node('img'); img.referrerPolicy='no-referrer'; img.alt=`事項補充附圖 ${i+1}/${urls.length}`; img.loading='lazy'; img.src=url; gallery.append(img); });
      if (result.images?.length) box.append(gallery);
      itemImageTimer=setTimeout(closeItemImages,60000);
    } catch (err) { error(err,stamp); }
  });
  $('item-images-close')?.addEventListener('click',closeItemImages);
  $('reports-reload').addEventListener('click',() => load());
  $('reports-cleanup-images').addEventListener('click',() => mutate(() => client.cleanupImages(),
    (result) => `已清除 ${result.cleanup.deleted} 張到期附圖${result.cleanup.pending ? '；部分檔案待後續重試' : ''}`));
  $('reports-search').addEventListener('click',() => { page=1; return load(); });
  $('reports-prev').addEventListener('click',() => { if (page>1 && !busy) { --page; return load(); } });
  $('reports-next').addEventListener('click',() => { if (!busy) { ++page; return load(); } });
  $('reports-create-project').addEventListener('click',() => mutate(() => client.project('create',
    { code:$('reports-project-code').value.trim(),name:$('reports-project-name').value.trim() })));
  $('reports-purge').addEventListener('click',() => mutate(async () => {
    const result=await purgeWorkPoc(client,{ confirm,prompt });
    if (result) { $('reports-invite').textContent=''; return result; }
  },(result) => result ? `已清空 ${result.reports} 則回報、${result.events ?? 0} 筆歷程、${result.images} 張附圖${result.cleanup?.pending ? '（部分附圖待後續重試刪檔）' : ''}、${result.projects ?? 0} 個專案、${result.members ?? 0} 位成員、${result.bindings ?? 0} 筆綁定、${result.consents ?? 0} 筆同意、${result.aliases ?? 0} 個代稱、${result.group_aliases ?? 0} 個本群代稱、${result.purge_due ?? 0} 筆清除倒數、${result.notices ?? 0} 筆提醒、${result.items ?? 0} 則事項、${result.people ?? 0} 筆相關人、${result.item_events ?? 0} 筆事項歷程、${result.queries ?? 0} 筆查詢配額；保留 ${result.counters_retained ?? 0} 筆事件碼計數、不重用；群組已重設為休閒群` : '已取消清空'));
  $('reports-export').addEventListener('click',async () => {
    if (busy) return; const stamp=epoch; busy=true;
    try {
      const selected=filters(); const rows=[];
      for (let n=1;;n++) {
        const result=await client.list(selected,n); if (!current(stamp)) return;
        rows.push(...result.rows); if (n*50>=result.total || !result.rows.length) break;
      }
      const url=URL.createObjectURL(new Blob([reportsCSV(rows)],{ type:'text/csv;charset=utf-8' }));
      const link=node('a'); link.href=url; link.download='work-reports.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
      $('reports-status').textContent=`已匯出 ${rows.length} 則`;
    } catch (err) { error(err,stamp); } finally { if (current(stamp)) busy=false; }
  });
  return { open: () => loaded ? undefined : load(), load, clear };
}
