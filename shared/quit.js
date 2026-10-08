// 放棄前的最佳分數提示與共用確認框。分數由各遊戲既有計分函式提供。
export function needsQuitBestConfirm({ score, best, assist }) {
  return !assist && score > 0 && score > best;
}

export function quitBestNote(args) {
  return needsQuitBestConfirm(args)
    ? `目前 ${args.score} 分超過最佳,放棄的局不計最佳分數`
    : '放棄的局不計最佳分數';
}

let dlg = null;
function dialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'help confirm quit-best';
  dlg.setAttribute('aria-labelledby', 'quit-best-title');
  dlg.setAttribute('aria-describedby', 'quit-best-text');
  // 固定骨架;含分數的文字一律用 textContent。
  dlg.innerHTML = `<h2 class="help-title" id="quit-best-title">放棄這局?</h2>
    <p id="quit-best-text"></p>
    <div class="confirm-actions">
      <button class="btn" type="button" data-act="quit">放棄</button>
      <button class="btn" type="button" data-act="keep" autofocus>繼續玩</button>
    </div>`;
  document.body.append(dlg);
  return dlg;
}

// true = 放棄;false = 繼續玩(Esc 或其他關閉方式也視為繼續)。
export function confirmQuitBest(args) {
  const d = dialog();
  d.querySelector('#quit-best-text').textContent = quitBestNote(args);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (quit) => {
      if (settled) return;
      settled = true;
      d.removeEventListener('click', onClick);
      d.removeEventListener('close', onClose);
      resolve(quit);
    };
    const onClick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act !== 'quit' && act !== 'keep') return;
      settle(act === 'quit');
      d.close();
    };
    const onClose = () => {
      settle(false);
    };
    d.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
    d.showModal();
  });
}
