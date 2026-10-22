import { bindThemeToggle } from '../shared/theme.js?v=dd499c2';
import { createDailyPublicClient, mountDailyRank } from '../shared/daily-public.js?v=dd499c2';
import { cloudEnabled } from '../shared/supabase-config.js?v=dd499c2';

bindThemeToggle(document.getElementById('theme'));

// 未登入也能看(R9);雲端未開放時仍顯示頁面,錯誤訊息放在空狀態。
let auth = null;
if (cloudEnabled) {
  try { ({ auth } = await (await import('../shared/auth.js?v=dd499c2')).getCloudRuntime()); } catch { auth = null; }
}
const client = createDailyPublicClient({ auth });
const view = mountDailyRank({ doc: document, client, loggedIn: () => Boolean(auth?.session) });
auth?.subscribe?.(() => { if (view.current) void view.select(view.current); });
