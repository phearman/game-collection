// CSV is generated entirely in the browser. Quote fields and neutralize spreadsheet formulas.
const cell = (value) => {
  let s=String(value ?? '');
  if (/^[\s\uFEFF]*[=+@\-]/u.test(s)) s=`'${s}`;
  return `"${s.replaceAll('"','""')}"`;
};
export function ledgerCSV(entries) {
  return '\uFEFF'+[['日期','品項','金額','付款人'],...entries.map((e) => [e.date,e.item,e.amount,e.payer])]
    .map((row) => row.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function renderLedger(doc,l) {
  const set=(id,value) => {doc.getElementById(id).textContent=value;};
  const money=(n) => `$${Number(n).toLocaleString('en-US')}`;
  set('name',l.name); set('notice','');
  set('meta',`${l.code} · ${l.status==='settled' ? '已結帳' : '進行中'} · ${l.source_type==='user' ? '個人' : l.group_name || '群組帳本'}`);
  set('retention',`保存到 ${l.preserve_until},要留存請下載 CSV`);
  set('total',`共 ${money(l.total)} · ${l.count} 人`);
  set('remainder',l.remainder ? `零頭 ${money(l.remainder)} 由建立人吸收` : '');
  const list=(id,values) => {
    const node=doc.getElementById(id); node.replaceChildren();
    for (const value of values) { const li=doc.createElement('li'); li.textContent=value; node.append(li); }
  };
  list('people',l.participants.map((p) => `${p.name} · 已付 ${money(p.paid)} · 應攤 ${money(p.share)} · ${p.net>=0 ? '多付' : '少付'} ${money(Math.abs(p.net))}`));
  list('transfers',l.transfers.length ? l.transfers.map((t) => `${t.from} → ${t.to} ${money(t.amount)}`) : ['目前不需轉帳']);
  list('entries',l.entries.map((e) => `${e.date} · ${e.item} · ${money(e.amount)} · ${e.payer}付`));
  doc.getElementById('detail').hidden=false;
}
