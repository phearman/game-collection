import { bindThemeToggle } from '../shared/theme.js?v=09d8276';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/supabase-config.js?v=09d8276';
import { ledgerCSV, renderLedger } from './logic.js?v=09d8276';

bindThemeToggle(document.getElementById('theme'));
const token=new URL(location.href).searchParams.get('t');
// Remove the bearer from the address/history before rendering or following another link.
history.replaceState(null,'',location.pathname);
async function load() {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token ?? '')) throw new Error('gone');
    const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/ledger_detail`,{
      method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({p_token:token}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)});
    const answer=await response.json();
    if (!response.ok || answer.status!=='ok') throw new Error('gone');
    const ledger=answer.ledger;
    renderLedger(document,ledger);
    document.getElementById('csv').addEventListener('click',() => {
      const url=URL.createObjectURL(new Blob([ledgerCSV(ledger.entries)],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a'); a.href=url; a.download=`${ledger.code}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    });
  } catch { document.getElementById('notice').textContent='連結已失效'; document.getElementById('detail').hidden=true; }
}
load();
