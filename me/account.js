import { getCloudRuntime } from '../shared/auth.js';
import { exportData, exportFileName } from '../shared/progress.js';

const $ = (id) => document.getElementById(id);

// 清除帳號裡的雲端紀錄(RS25):整份覆蓋成空資料(既有 import_all RPC),本機紀錄不動。
export const CLEAR_ASK = [
  '要清除帳號裡的雲端紀錄嗎?這台裝置上的紀錄不受影響。',
  '清除後無法復原,其他裝置登入後也會看到空白紀錄。確定清除?',
];
// 二次確認,兩次都按「確定」才清除;→ true 已清除、false 已取消。失敗時丟錯(呼叫端顯示訊息)。
export async function clearCloudRecords(store, ask = (message) => globalThis.confirm(message)) {
  for (const message of CLEAR_ASK) if (!ask(message)) return false;
  await store.importAll({ profile: null, stats: {}, plays: [], saves: [] });
  return true;
}

export async function initAccount() {
  const rt = await getCloudRuntime();
  $('account').hidden = false;
  const render = () => {
    const meta = rt.auth.session?.user.user_metadata ?? {};
    $('account-name').textContent = rt.auth.session ? (meta.user_name || meta.preferred_username || meta.name || '帳號') : '未登入:紀錄只存在這台裝置';
    $('sign-in').hidden = Boolean(rt.auth.session);
    $('sign-in-google').hidden = Boolean(rt.auth.session);
    $('sign-out').hidden = !rt.auth.session;
    $('clear-cloud').hidden = !rt.auth.session;
    $('sync-status').textContent = rt.auth.session ? rt.store?.status ?? '同步中' : '';
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
  return () => {
    render();
    $('account-msg').textContent = rt.notice || oldNotice;
    renderBackups();
    rt.store?.subscribe(render);
  };
}
