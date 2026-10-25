import { getCloudRuntime } from '../shared/auth.js?v=3baa66c';
import { isCloudOffline } from '../shared/cloud-status.js?v=3baa66c';
import { exportData, exportFileName } from '../shared/progress.js?v=3baa66c';
import { createFeedbackClient, KINDS, playerFeedbackStatus, element, displayName } from '../shared/feedback.js?v=3baa66c';
import { GAMES } from '../shared/games.js?v=3baa66c';
import { initLineLinkStatus } from '../shared/line-link.js?v=3baa66c';
import { initAvatarPicker } from '../shared/avatars.js?v=3baa66c';
import { initDailyPublic } from '../shared/daily-public.js?v=3baa66c';

export function renderMyFeedback(doc, rows) {
  const items = doc.getElementById('feedback-items');
  items.replaceChildren();
  for (const row of rows) {
    const item = element(doc, 'li');
    const game = GAMES.find((g) => g.id === row.game_id)?.title ?? (row.game_id === 'lobby' ? '大廳' : row.game_id);
    item.append(element(doc, 'p', `${new Date(row.created_at).toLocaleString()} · ${game} · ${KINDS[row.kind] ?? row.kind} · ${playerFeedbackStatus(row)}`),
      element(doc, 'p', row.body));
    if (row.note) item.append(element(doc, 'p', `備註：${row.note}`));
    items.append(item);
  }
}

// 已登入時的同步狀態。雲端暫時連不上而降級本機(IR30)時沒有 store,⛔ 不顯示「同步中」。
export const syncStatusText = (store, offline) => store?.status ?? (offline ? '暫時只存本機' : '同步中');

// RPC 在單一交易清除帳號紀錄與自己的回饋，本機紀錄不動。
export const CLEAR_ASK = [
  '要清除帳號裡的雲端紀錄、每日挑戰成績和你送出的意見回饋嗎?當天每日挑戰只保留首次開始時間與已清除標記，不能重玩。這也會解除 LINE 綁定並退出所有群組排行,並清空網站今日排行暱稱;若你已關閉公開,會保留關閉選擇,其餘回到預設公開。這台裝置上的紀錄不受影響。',
  '清除紀錄和意見回饋後無法復原,其他裝置登入後也會看到空白紀錄。確定清除?',
];
// 二次確認,兩次都按「確定」才清除;→ true 已清除、false 已取消。失敗時丟錯(呼叫端顯示訊息)。
export async function clearCloudRecords(store, ask = (message) => globalThis.confirm(message)) {
  for (const message of CLEAR_ASK) if (!ask(message)) return false;
  await store.request('rpc/clear_cloud_records', { method: 'POST', body: {} });
  return true;
}

export async function initAccount({ doc = globalThis.document, runtime, client, lineClient, avatarClient, dailyPublicClient } = {}) {
  const $ = (id) => doc.getElementById(id);
  const rt = runtime ?? await getCloudRuntime();
  const feedback = client ?? createFeedbackClient({ auth: rt.auth });
  initLineLinkStatus({ doc, auth: rt.auth, client: lineClient });
  initAvatarPicker({ doc, auth: rt.auth, client: avatarClient });
  initDailyPublic({ doc, auth: rt.auth, client: dailyPublicClient }); // RS78 今日挑戰排行公開設定
  let adminEpoch = 0;
  const renderAdmin = async () => {
    const epoch = ++adminEpoch;
    const userId = rt.auth.session?.user.id;
    $('feedback-admin').hidden = true;
    if (!userId) return;
    try {
      const isAdmin = await feedback.isAdmin();
      if (epoch === adminEpoch && rt.auth.session?.user.id === userId) {
        $('feedback-admin').hidden = isAdmin !== true;
      }
    } catch { /* 資格檢查失敗視為非管理者，不顯示錯誤 */ }
  };
  rt.auth.subscribe(renderAdmin);
  let feedbackEpoch = 0;
  const renderFeedback = async () => {
    const epoch = ++feedbackEpoch;
    $('my-feedback').hidden = !rt.auth.session;
    $('feedback-items').replaceChildren();
    if (!rt.auth.session) return;
    $('feedback-message').textContent = '載入中…';
    try {
      const rows = await feedback.listMine();
      if (epoch !== feedbackEpoch) return;
      $('feedback-message').textContent = rows.length ? '最近 20 則' : '還沒有送出的意見。';
      renderMyFeedback(doc, rows);
    } catch (err) {
      if (epoch === feedbackEpoch) $('feedback-message').textContent = `讀取失敗:${err.message}。可按重新載入再試。`;
    }
  };
  $('feedback-reload').addEventListener('click', renderFeedback);
  rt.auth.subscribe(renderFeedback);
  $('account').hidden = false;
  const render = () => {
    const meta = rt.auth.session?.user.user_metadata ?? {};
    $('account-name').textContent = rt.auth.session ? displayName(meta.user_name || meta.preferred_username || meta.name || '帳號') : '未登入:紀錄只存在這台裝置';
    $('sign-in').hidden = Boolean(rt.auth.session);
    $('sign-in-google').hidden = Boolean(rt.auth.session);
    $('sign-out').hidden = !rt.auth.session;
    $('clear-cloud').hidden = !rt.auth.session;
    $('sync-status').textContent = rt.auth.session ? syncStatusText(rt.store, isCloudOffline()) : '';
    $('account-avatar').hidden = true;
    $('account-avatar').removeAttribute('src');
    if (rt.auth.session && meta.avatar_url) {
      try {
        const avatar = new URL(meta.avatar_url);
        if (avatar.protocol === 'https:') {
          $('account-avatar').src = avatar.href;
          $('account-avatar').hidden = false;
        }
      } catch { /* 不載入無效頭像 */ }
    }
  };
  $('sign-in').addEventListener('click', async () => {
    try { await rt.auth.signIn(location.href, 'github'); } catch (err) { $('account-msg').textContent = err.message; }
  });
  $('sign-in-google').addEventListener('click', async () => {
    try { await rt.auth.signIn(location.href, 'google'); } catch (err) { $('account-msg').textContent = err.message; }
  });
  $('sign-out').addEventListener('click', async () => {
    await rt.auth.signOut();
    location.reload();
  });
  $('clear-cloud').addEventListener('click', async () => {
    if (!rt.store) { $('account-msg').textContent = '帳號紀錄還沒載入,請重新整理後再試'; return; }
    try {
      if (!(await clearCloudRecords(rt.store))) return;
      try { sessionStorage.setItem('gc:auth-notice', '已清除帳號裡的雲端紀錄'); } catch { /* 網站儲存不可用 */ }
      location.reload();
    } catch (err) { $('account-msg').textContent = `清除失敗:${err.message}`; }
  });
  rt.auth.subscribe(render);
  let oldNotice = '';
  try {
    oldNotice = sessionStorage.getItem('gc:auth-notice') ?? '';
    sessionStorage.removeItem('gc:auth-notice');
  } catch { /* 網站儲存不可用 */ }
  $('account-msg').textContent = rt.notice || oldNotice;

  const backups = $('backups');
  const renderBackups = () => {
  backups.replaceChildren();
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((k) => /^gc:backup:\d+$/.test(k)).sort().reverse();
    for (const key of keys) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.type = 'button';
      const stamp = Number(key.slice('gc:backup:'.length));
      button.textContent = `匯出本機備份 · ${new Date(stamp).toLocaleString()}`;
      button.addEventListener('click', () => {
        try {
          const raw = JSON.parse(localStorage.getItem(key));
          const data = exportData({ ...raw, now: stamp });
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const link = Object.assign(document.createElement('a'), { href: url, download: exportFileName(stamp) });
          document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { $('account-msg').textContent = '備份無法匯出，請保留網站資料並稍後重試'; }
      });
      backups.append(button);
    }
  } catch { $('account-msg').textContent = '無法讀取本機備份'; }
  };
  render();
  renderAdmin();
  renderFeedback();
  return () => {
    render();
    $('account-msg').textContent = rt.notice || oldNotice;
    renderBackups();
    rt.store?.subscribe(render);
  };
}
