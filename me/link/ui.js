import { createAuth } from '../../shared/auth.js?v=32c428b';
import { createLineLinkClient, LINK_STATUS } from '../../shared/line-link.js?v=32c428b';
import { displayName } from '../../shared/feedback.js?v=32c428b';

export async function initLinkPage({ doc = globalThis.document, auth = createAuth(),
  client = createLineLinkClient({ auth }), location = globalThis.location, history = globalThis.history } = {}) {
  const $ = (id) => doc.getElementById(id);
  const token = new URL(location.href).searchParams.get('t') ?? '';
  let epoch = 0;
  let readyUser = null;
  let busy = false;
  let finished = false;
  const hideConfirmation = () => {
    readyUser = null;
    for (const id of ['link-question', 'link-warning', 'link-confirm']) $(id).hidden = true;
    $('link-question').textContent = '';
  };
  const render = async () => {
    const current = ++epoch;
    hideConfirmation();
    $('link-login').hidden = true;
    if (finished) return;
    if (!/^[0-9a-f]{64}$/.test(token)) { $('link-message').textContent = LINK_STATUS.invalid; return; }
    const owner = auth.session?.user.id;
    if (!owner) {
      $('link-message').textContent = '請先用 Google 或 GitHub 登入,登入後回到本頁確認綁定。';
      $('link-login').hidden = false;
      return;
    }
    $('link-message').textContent = '正在確認綁定連結…';
    try {
      const result = await client.preview(token);
      if (current !== epoch || auth.session?.user.id !== owner) return;
      if (result?.status !== 'ready') { $('link-message').textContent = LINK_STATUS[result?.status] ?? LINK_STATUS.invalid; return; }
      const meta = auth.session.user.user_metadata ?? {};
      const name = displayName(meta.user_name || meta.preferred_username || meta.name);
      $('link-question').textContent = `要把 LINE〔${result.display_name || '玩家'}〕綁定到遊戲帳號〔${name}〕嗎?`;
      for (const id of ['link-question', 'link-warning', 'link-confirm']) $(id).hidden = false;
      $('link-message').textContent = '確認名稱後,按下「確認綁定」才會綁定。';
      readyUser = owner;
    } catch (err) { if (current === epoch) $('link-message').textContent = err.message; }
  };
  for (const provider of ['google', 'github']) $('link-' + provider).addEventListener('click', async () => {
    try { await auth.signIn(location.href, provider); } catch (err) { $('link-message').textContent = err.message; }
  });
  $('link-confirm').addEventListener('click', async () => {
    if (busy || !readyUser || auth.session?.user.id !== readyUser) return;
    busy = true; $('link-confirm').disabled = true;
    const current = epoch;
    try {
      const result = await client.claim(token);
      if (current !== epoch) return;
      hideConfirmation();
      $('link-message').textContent = LINK_STATUS[result?.status] ?? LINK_STATUS.invalid;
      finished = true;
      // Stop retaining a consumed or invalid bearer token in the current address bar.
      const clean = new URL(location.href); clean.searchParams.delete('t');
      try { history.replaceState(null, '', clean.href); } catch { /* 綁定已完成,不覆蓋成功訊息 */ }
    } catch (err) { if (current === epoch) $('link-message').textContent = err.message; }
    finally { busy = false; $('link-confirm').disabled = false; }
  });
  await auth.init();
  const unsubscribe = auth.subscribe(render);
  await render();
  return unsubscribe;
}

if (globalThis.document) {
  const { bindThemeToggle } = await import('../../shared/theme.js?v=32c428b');
  bindThemeToggle(document.getElementById('theme'));
  initLinkPage().catch(() => { document.getElementById('link-message').textContent = '帳號功能暫時無法使用,請稍後重試'; });
}
