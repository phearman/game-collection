// 畫面 C「我的」:等級、成就、各遊戲統計、最近 50 局、匯出/匯入。只顯示 profile.summary(),不寫規則。
import { createProfile } from '../shared/profile.js';
import { LocalStore } from '../shared/stores/local.js';
import { bindThemeToggle } from '../shared/theme.js';
import { ACHIEVEMENTS, xpBreakdown } from '../shared/progress.js';
import { XP_EXAMPLES, signedXp } from '../shared/xp-explain.js';

const $ = (id) => document.getElementById(id);
const profile = await createProfile({ store: new LocalStore() });
const RESULT = { win: '勝', lose: '敗', quit: '放棄' };

const pad = (n) => String(n).padStart(2, '0');
const hm = (sec) => `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}`;
const ms = (sec) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
const md = (isoStr) => { const d = new Date(isoStr); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; };
const mdhm = (isoStr) => { const d = new Date(isoStr); return `${md(isoStr)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function table(head, rows, empty) {
  if (rows.length === 0) return `<p class="me-empty">${empty}</p>`;
  const th = head.map(([label, num]) => `<th${num ? ' class="num"' : ''}>${label}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((v, i) => `<td${head[i][1] ? ' class="num"' : ''}>${v}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

async function render() {
  const s = await profile.summary();
  const titles = Object.fromEntries(s.games.map((g) => [g.id, `${g.icon} ${g.title}`]));

  $('lv').textContent = `Lv ${s.level}`;
  $('bar').firstElementChild.style.width = `${(s.current / s.need) * 100}%`;
  $('bar').setAttribute('aria-valuenow', s.current);
  $('bar').setAttribute('aria-valuemax', s.need);
  $('xp-num').textContent = `${s.current} / ${s.need} XP`;
  $('sub').textContent = `總局數 ${s.plays_count} · 總時間 ${hm(s.total_sec)} · 連玩 ${s.streak.current} 天(最長 ${s.streak.longest})`;

  const got = s.achievements.filter((a) => a.unlocked_at).length;
  $('ach-title').textContent = `成就 ${got} / ${s.achievements.length}`;
  $('ach').innerHTML = s.achievements.map((a) => `
    <div class="ach-item${a.unlocked_at ? '' : ' is-locked'}" title="${esc(a.cond)}">
      <div class="ach-icon" aria-hidden="true">${a.unlocked_at ? a.icon : '🔒'}</div>
      <div class="ach-name">${esc(a.name)}</div>
      <div class="ach-note">${a.unlocked_at ? md(a.unlocked_at) : esc(a.cond)}</div>
    </div>`).join('');

  $('games').innerHTML = table(
    [['遊戲'], ['局數', 1], ['勝', 1], ['最佳', 1], ['時間', 1], ['最近']],
    s.games.filter((g) => g.stats).map(({ id, stats: st }) => [
      titles[id], st.plays_count, st.wins_count, st.best_score.toLocaleString(), hm(st.total_sec),
      st.last_played_at ? mdhm(st.last_played_at) : '—',
    ]),
    '還沒有紀錄,去玩一局吧!',
  );

  $('plays').innerHTML = table(
    [['時間'], ['遊戲'], ['結果'], ['分數', 1], ['時長', 1], ['XP', 1]],
    s.plays.map((p) => [
      mdhm(p.ended_at), titles[p.game_id] ?? esc(p.game_id), (RESULT[p.result] ?? esc(p.result)) + (p.is_best ? ' 🎉' : '') + (p.detail?.assist ? ' · 輔助' : ''),
      p.score.toLocaleString(), ms(p.duration_sec), `+${p.xp_gained}`,
    ]),
    '還沒有紀錄。',
  );
}

function message(text, error = false) {
  $('msg').textContent = text;
  $('msg').classList.toggle('is-error', error);
}

async function download() {
  const { name, data } = await profile.exportFile();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(`已匯出 ${name}`);
}

let pending = null; // 待確認的匯入檔內容

$('export').addEventListener('click', download);
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  $('file').value = '';
  if (!file) return;
  const check = profile.checkImport(await file.text());
  if (!check.ok) {
    message(`匯入失敗:${check.error}。目前紀錄未變動。`, true);
    return;
  }
  pending = check.data;
  const { level, plays_count, achievements } = check.summary;
  $('import-summary').innerHTML = `<p>檔案:${esc(file.name)}</p><p>等級 Lv ${level} · 局數 ${plays_count} · 成就 ${achievements} / ${ACHIEVEMENTS.length}</p>`;
  $('import-dlg').showModal();
});
$('import-dlg').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'export') await download();
  if (act === 'cancel') { pending = null; $('import-dlg').close(); }
  if (act === 'confirm' && pending) {
    const r = await profile.importFile(pending);
    pending = null;
    $('import-dlg').close();
    message(r.ok ? '已匯入紀錄。' : `匯入失敗:${r.error}`, !r.ok);
    await render();
  }
});

bindThemeToggle($('theme'));
await render();

// 「XP 怎麼算?」(RS5):範例由 xpBreakdown 實算;網址帶 #xp 時自動展開並捲到該處。
$('xp-examples').innerHTML = XP_EXAMPLES.map(({ title, args }) => {
  const b = xpBreakdown(args);
  return `<li>${title}<br><span class="xp-help-calc">${b.items.map((it) => `${it.label} ${signedXp(it.xp)}`).join(' + ')} = <b>${b.total} XP</b></span></li>`;
}).join('');
const openXpHelp = () => {
  if (location.hash !== '#xp') return;
  $('xp').open = true;
  $('xp').scrollIntoView({ block: 'start' });
};
openXpHelp();
addEventListener('hashchange', openXpHelp);
