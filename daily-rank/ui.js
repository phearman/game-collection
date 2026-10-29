import { bindThemeToggle } from '../shared/theme.js?v=09d8276';
import { createDailyPublicClient, mountDailyRank, initDailyPublicNotice } from '../shared/daily-public.js?v=09d8276';
import { cloudEnabled } from '../shared/supabase-config.js?v=09d8276';

bindThemeToggle(document.getElementById('theme'));

// 未登入也能看(R9);雲端未開放時仍顯示頁面,錯誤訊息放在空狀態。
let auth = null;
if (cloudEnabled) {
  try { ({ auth } = await (await import('../shared/auth.js?v=09d8276')).getCloudRuntime()); } catch { auth = null; }
}
const client = createDailyPublicClient({ auth });
if (auth) initDailyPublicNotice({ doc: document, auth, client });
const view = mountDailyRank({ doc: document, client, loggedIn: () => Boolean(auth?.session) });
auth?.subscribe?.(() => { if (view.current) void view.select(view.current); });
