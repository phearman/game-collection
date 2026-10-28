// 共用「? 玩法」說明與示範(RS3)。每款遊戲提供規則文字與示範步驟,
// 第一次進入該遊戲自動開啟一次;之後由頂列的「? 玩法」按鈕開啟。
import { load, save } from './storage.js?v=be1ebb6';
import { GAMES } from './games.js?v=be1ebb6';
import { SONGS, GAME_MUSIC, DEFAULT_SONG, musicChoice, setMusicChoice, globalMusicChoice, setGlobalMusicChoice } from './sound.js?v=be1ebb6';

// 依遊戲 id 取編號(DV11;code 依 games.js 順序固定 G1 起、新遊戲往後編、不重排)。沒有 code 或查無此遊戲回 null。
export function gameCode(id) {
  return GAMES.find((g) => g.id === id)?.code ?? null;
}

export function gameVersion(id) {
  return GAMES.find((g) => g.id === id)?.version ?? null;
}

// 示範步驟的成功/失敗標籤(RS5):kind = 'ok' | 'fail';沒給就不顯示。靠文字與符號區分,不只靠顏色。
export function kindLabel(kind) {
  if (kind === 'ok') return '✅ 成功';
  if (kind === 'fail') return '❌ 失敗';
  return '';
}

// 配樂選單(RS68)。曲名一律來自曲庫常數,不含使用者輸入。
const songOption = (choice) => (value, text) => `<option value="${value}"${value === choice ? ' selected' : ''}>${text}</option>`;
const songTitle = (gameId) => SONGS[GAME_MUSIC[gameId] ?? DEFAULT_SONG].title;
// 全站預設這個值,放到某款遊戲時實際是什麼(給選單顯示用)
function globalLabel(gameId, global) {
  if (global === 'none') return '關閉';
  return global === 'auto' ? `依遊戲預設・${songTitle(gameId)}` : SONGS[global].title;
}
// 各遊戲選單(「? 玩法」):跟隨全站預設(標出目前會播什麼)/曲庫各曲/關閉;遊戲的選擇優先於全站預設。
export function musicOptions(gameId, choice = 'default', global = 'auto') {
  const option = songOption(choice);
  return [option('default', `跟隨全站預設(${globalLabel(gameId, global)})`),
    ...Object.entries(SONGS).map(([id, song]) => option(id, song.title)),
    option('none', '關閉')].join('');
}
// 全站預設選單(「我的紀錄」頁)的選項 [值, 文字]:依遊戲預設/曲庫各曲/關閉。該頁以 DOM 建立選項(不用 innerHTML)。
export function globalMusicEntries() {
  return [['auto', '依遊戲預設(每款遊戲各自的曲子)'], ...Object.entries(SONGS).map(([id, song]) => [id, song.title]), ['none', '關閉']];
}
// 綁定全站預設選單:建立選項、改選即存;別頁改了 gc:bgm(或清空網站資料)時同步顯示目前值(審查 #150 r2)。
export function bindGlobalMusicSelect(select, { win = globalThis, get = globalMusicChoice, set = setGlobalMusicChoice } = {}) {
  for (const [value, text] of globalMusicEntries()) select.append(new win.Option(text, value));
  select.value = get();
  select.addEventListener('change', () => set(select.value));
  win.addEventListener?.('storage', (event) => {
    if (event.key === 'gc:bgm' || event.key === null) select.value = get();
  });
}

// opts:
//   gameId     遊戲 id,用來記「看過說明了」
//   title      對話框標題
//   rules      規則 HTML(條列)
//   demo       選用:{ steps: [{ before, after, caption }], render(state) → HTML }
//   mountAfter 「? 玩法」按鈕插在哪個元素後面
//   onClose    選用:說明關閉(包含 Esc)時通知呼叫端
export function setupHelp({ gameId, title, rules, demo, mountAfter, onClose }) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.textContent = '? 玩法';
  btn.title = '玩法說明與示範';
  mountAfter.after(btn);

  // 遊戲編號(DV11):依 gameId 查 games.js,放在「← 大廳」與「? 玩法」之間;沒有編號就不顯示。
  // 頂列是 space-between,多一個項目會多佔一份間距而折行 ⇒ 三者包成同一組(頁面已有 .navigation 群組就直接放進去)。
  const code = gameCode(gameId);
  if (code) {
    const tag = document.createElement('span');
    tag.className = 'game-code';
    tag.textContent = code;
    tag.title = `遊戲編號 ${code}`;
    let group = mountAfter.parentElement;
    if (!group.classList.contains('navigation')) {
      group = document.createElement('div');
      group.className = 'navigation';
      mountAfter.before(group);
      group.append(mountAfter, btn);
    }
    mountAfter.after(tag);
    const version = gameVersion(gameId);
    if (version) {
      const link = document.createElement('a');
      link.className = 'game-version';
      link.textContent = `v${version}`;
      link.href = `../../changelog/?g=${encodeURIComponent(code)}`;
      link.title = `${code} v${version} 更新紀錄`;
      tag.after(link);
    }
  }

  const dlg = document.createElement('dialog');
  dlg.className = 'help';
  dlg.innerHTML = `
    <div class="help-head">
      <h2 class="help-title">${title}</h2>
      <button class="btn" type="button" data-close aria-label="關閉">✕</button>
    </div>
    <div class="help-rules">${rules}</div>
    <p class="help-rules">頂列 🔊 可切換：🎵 音效＋音樂 → 🔊 只有音效 → 🔇 靜音</p>
    <label class="help-music">🎼 配樂 <select data-music aria-label="配樂">${musicOptions(gameId, musicChoice(gameId), globalMusicChoice())}</select></label>
    ${demo ? `
      <div class="help-demo">
        <div class="help-demo-head">
          <strong>示範</strong>
          <button class="btn" type="button" data-play>▶ 播放</button>
        </div>
        <div class="help-stage" data-stage></div>
        <p class="help-caption" data-caption></p>
        <p class="help-step" data-step></p>
      </div>` : ''}
    <div class="help-foot"><button class="btn" type="button" data-feedback>💬 意見回饋</button><button class="btn" type="button" data-close>開始玩</button></div>`;
  document.body.append(dlg);

  const runner = demo ? demoRunner(dlg, demo) : null;
  const pick = dlg.querySelector?.('[data-music]');
  const open = () => {
    document.dispatchEvent(new CustomEvent('helpopen'));
    if (pick) pick.innerHTML = musicOptions(gameId, musicChoice(gameId), globalMusicChoice()); // 別頁可能改過選擇或全站預設
    dlg.showModal();
    runner?.reset();
    runner?.play();
  };
  const close = () => {
    runner?.stop();
    dlg.close();
  };

  pick?.addEventListener('change', (e) => setMusicChoice(e.target.value, gameId));
  btn.addEventListener('click', open);
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-feedback]')) {
      close();
      const { openFeedback } = await import('./feedback.js?v=be1ebb6');
      await openFeedback({ gameId, meHref: '../../me/' });
      return;
    }
    if (e.target.closest('[data-close]') || e.target === dlg) close();
  });
  dlg.addEventListener('cancel', () => runner?.stop());
  dlg.addEventListener('close', () => onClose?.());

  const seenKey = `help-seen:${gameId}`;
  if (!load(seenKey, false)) {
    save(seenKey, true);
    open();
  }
  return { open };
}

// 每一步:先顯示 before,停一下,再換成 after,然後進下一步;播完停在最後一格。
function demoRunner(dlg, { steps, render }) {
  const stage = dlg.querySelector('[data-stage]');
  const caption = dlg.querySelector('[data-caption]');
  const stepNo = dlg.querySelector('[data-step]');
  const playBtn = dlg.querySelector('[data-play]');
  let timers = [];

  const show = (i, phase) => {
    const s = steps[i];
    stage.innerHTML = render(phase === 'before' ? s.before : s.after);
    const label = kindLabel(s.kind);
    const text = phase === 'before' ? s.caption : (s.result || s.caption);
    caption.textContent = label ? `${label} ${text}` : text;
    stepNo.textContent = `${i + 1} / ${steps.length}`;
  };
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    playBtn.textContent = '▶ 重播';
  };
  const reset = () => {
    stop();
    show(0, 'before');
  };
  const play = () => {
    stop();
    playBtn.textContent = '■ 停止';
    let t = 0;
    steps.forEach((_, i) => {
      timers.push(setTimeout(() => show(i, 'before'), t));
      t += 1400;
      timers.push(setTimeout(() => show(i, 'after'), t));
      t += 1600;
    });
    timers.push(setTimeout(stop, t));
  };
  playBtn.addEventListener('click', () => (timers.length ? stop() : play()));
  return { play, stop, reset };
}
