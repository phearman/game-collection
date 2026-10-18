// 結算包裝(IR6):各遊戲 ui.js 用 settlePlay 取代直接呼叫 profile.finishPlay。
// profile.finishPlay 是一次提交:失敗會把已寫的紀錄整批還原再丟錯。這裡接住錯誤,跳出共用對話框
// 「重試 / 不存了,再玩一次」,不讓畫面停在「結算中」。重試 = 從目前的資料重新算一次;不存了 = 什麼都不記、開新局。

import { isCloudOffline, OFFLINE_FINISH_TEXT } from './cloud-status.js?v=ef71b5f';
import { failureReason } from './stores/errors.js?v=ef71b5f';

export const STORAGE_WARNING_TEXT = '這台裝置的儲存空間不足或無法寫入,進度可能沒存到;請到「我的紀錄」匯出備份';
const storageWarned = new WeakSet();
// 空間提示同頁只提醒一次;每次匯入的略過結果都更新提示,關閉後會重新顯示。
export function showStorageWarning(doc = globalThis.document, skippedSaves = []) {
  if (!doc?.body || (!skippedSaves.length && storageWarned.has(doc))) return;
  let note = doc.getElementById?.('storage-warning');
  if (!note) {
    note = doc.createElement('p');
    note.id = 'storage-warning';
    note.setAttribute('role', 'status');
    note.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:calc(100vw - 32px);margin:0;'
      + 'padding:8px 12px;border-radius:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.25);font-size:13px;z-index:1000;';
    note.addEventListener('click', () => note.remove());
    doc.body.append(note);
  }
  note.textContent = skippedSaves.length
    ? `⚠ 已略過 ${skippedSaves.length} 個超過大小上限的存檔,其餘紀錄已匯入。`
    : `⚠ ${STORAGE_WARNING_TEXT}`;
  if (!skippedSaves.length) storageWarned.add(doc);
}

// 結算後的離線提示:畫面底部置中的狀態列(每頁一個,重複結算只更新文字),點一下關閉。
export function showOfflineFinish(doc = globalThis.document) {
  if (!doc?.body) return;
  let note = doc.getElementById('cloud-offline-finish');
  if (!note) {
    note = doc.createElement('p');
    note.id = 'cloud-offline-finish';
    note.setAttribute('role', 'status');
    note.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:calc(100vw - 32px);margin:0;'
      + 'padding:8px 12px;border-radius:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.25);font-size:13px;z-index:1000;';
    note.addEventListener('click', () => note.remove());
    doc.body.append(note);
  }
  note.textContent = `⚠ ${OFFLINE_FINISH_TEXT}`;
}

export const FAIL_TEXT ='紀錄沒存成功(可能是儲存空間已滿或被瀏覽器封鎖)';
export const CLOUD_FAIL_TEXT = '紀錄沒同步到雲端,請確認連線後再試一次';
export const ROLLBACK_TEXT = '紀錄沒存成功,原本的紀錄也還沒還原完成。請先再試一次還原;一直失敗時,請到「我的紀錄」匯出備份';

// 只顯示標準錯誤類別及有限的代碼,不可把 message、路徑或使用者識別碼帶到畫面。
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
  'EvalError', 'AggregateError', 'QuotaExceededError', 'SecurityError', 'InvalidStateError',
  'NotAllowedError', 'NotFoundError', 'DataError', 'UnknownError', 'AbortError', 'NetworkError', 'TimeoutError']);
export function settleErrorCode(error) {
  const source = error?.rollbackFailed ? error.cause ?? error : error;
  const name = ERROR_NAMES.has(source?.name) ? source.name : 'Error';
  const code = source?.code;
  let safeCode = '';
  if (Number.isSafeInteger(code) && code >= 0 && code <= 99999) safeCode = String(code);
  else if (code === 'LOCAL_DATA_LIMIT' || (typeof code === 'string' && /^(?:[0-9]{5}|[0-9]{2}[A-Z][0-9]{2}|P[0-9]{4})$/.test(code))) safeCode = code;
  return `錯誤代碼:${name}${safeCode ? ` / ${safeCode}` : ''}${error?.rollbackFailed ? ' / rollbackFailed' : ''}`;
}

// → finishPlay 的結果;使用者選「不存了」⇒ null(呼叫端開新局)。
// ask(err):失敗時詢問使用者,回傳 'retry' 或 'abandon'(預設為共用對話框;測試可注入)。
// askRestore(err):原紀錄還原失敗時,只能「再試一次還原」(R3:還原成功前不准重試結算或放棄,免得重複記錄)。
// notifyOffline():本頁雲端暫時不可用(IR30)時,結算成功後提示「這局沒有上傳到雲端」(測試可注入)。
export async function settlePlay(profile, gameId, args, { ask = askRetry, askRestore = askRestoreOnly, notifyOffline = showOfflineFinish } = {}) {
  for (;;) {
    try {
      const out = await profile.finishPlay(gameId, args);
      if (isCloudOffline()) notifyOffline();
      return out;
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
    <p style="font-size:12px;color:var(--text-sub)" id="settle-fail-code"></p>
    <p style="font-size:12px">可到「我的紀錄」匯出備份。</p>
    <div class="confirm-actions">
      <button class="btn" type="button" data-act="abandon">不存了,再玩一次</button>
      <button class="btn" type="button" data-act="retry" autofocus>重試</button>
    </div>`;
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc 不關:一定要選一個,不然又卡在結算中
  document.body.append(dlg);
  return dlg;
}

export function askRetry(error) {
  return show(['network', 'cloud'].includes(failureReason(error)) ? CLOUD_FAIL_TEXT : FAIL_TEXT, false, error);
}

// 還原也失敗(極少見):只留「再試一次還原」,並提醒先匯出備份。
export function askRestoreOnly(error) {
  return show(ROLLBACK_TEXT, true, error);
}

function show(text, restoreOnly, error) {
  const d = dialog();
  d.querySelector('#settle-fail-text').textContent = text;
  d.querySelector('#settle-fail-code').textContent = settleErrorCode(error);
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
