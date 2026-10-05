// 結算包裝(IR6):各遊戲 ui.js 用 settlePlay 取代直接呼叫 profile.finishPlay。
// profile.finishPlay 是一次提交:失敗會把已寫的紀錄整批還原再丟錯。這裡接住錯誤,跳出共用對話框
// 「重試 / 不存了,再玩一次」,不讓畫面停在「結算中」。重試 = 從目前的資料重新算一次;不存了 = 什麼都不記、開新局。

export const FAIL_TEXT = '紀錄沒存成功(可能是儲存空間已滿或被瀏覽器封鎖)';
export const ROLLBACK_TEXT = '紀錄沒存成功,原本的紀錄也還沒還原完成。請先再試一次還原;一直失敗時,請到「我的紀錄」匯出備份';

// → finishPlay 的結果;使用者選「不存了」⇒ null(呼叫端開新局)。
// ask(err):失敗時詢問使用者,回傳 'retry' 或 'abandon'(預設為共用對話框;測試可注入)。
// askRestore(err):原紀錄還原失敗時,只能「再試一次還原」(R3:還原成功前不准重試結算或放棄,免得重複記錄)。
export async function settlePlay(profile, gameId, args, { ask = askRetry, askRestore = askRestoreOnly } = {}) {
  for (;;) {
    try {
      return await profile.finishPlay(gameId, args);
    } catch (e) {
      let err = e;
      console.error(err);
      while (err?.rollbackFailed && err.retryRestore) {
        await askRestore(err);
        err = err.retryRestore();
        if (err?.rollbackFailed) console.error(err);
      }
      if ((await ask(err)) === 'retry') continue;
      try {
        await profile.abandonFinish(gameId);
      } catch (e) {
        console.error(e); // 連清存檔都失敗:照樣開新局;紀錄已還原,重載後再結算也只會記一次
      }
      return null;
    }
  }
}

let dlg = null;

function dialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'help confirm settle-fail';
  dlg.setAttribute('aria-labelledby', 'settle-fail-title');
  dlg.innerHTML = `<h2 class="help-title" id="settle-fail-title">結算失敗</h2>
    <p id="settle-fail-text"></p>
    <div class="confirm-actions">
      <button class="btn" type="button" data-act="abandon">不存了,再玩一次</button>
      <button class="btn" type="button" data-act="retry" autofocus>重試</button>
    </div>`;
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc 不關:一定要選一個,不然又卡在結算中
  document.body.append(dlg);
  return dlg;
}

export function askRetry() {
  return show(FAIL_TEXT, false);
}

// 還原也失敗(極少見):只留「再試一次還原」,並提醒先匯出備份。
export function askRestoreOnly() {
  return show(ROLLBACK_TEXT, true);
}

function show(text, restoreOnly) {
  const d = dialog();
  d.querySelector('#settle-fail-text').textContent = text;
  d.querySelector('[data-act="abandon"]').hidden = restoreOnly;
  d.querySelector('[data-act="retry"]').textContent = restoreOnly ? '再試一次還原' : '重試';
  return new Promise((resolve) => {
    const onClick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      d.removeEventListener('click', onClick);
      d.close();
      resolve(act);
    };
    d.addEventListener('click', onClick);
    d.showModal();
  });
}
