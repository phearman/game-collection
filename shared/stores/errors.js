// 一般寫入回傳失敗原因;交易保留原例外(含回滾資訊)。
export function failureReason(error) {
  const source = error?.rollbackFailed ? error.cause ?? error : error;
  if (source?.reason) return source.reason;
  if (source?.code === 'LOCAL_DATA_LIMIT') return 'limit';
  if (source?.name === 'QuotaExceededError') return 'quota';
  return 'write';
}

export const writeFailure = (error) => ({ ok: false, reason: failureReason(error) });

// 同時讀多份資料,但行為與依序 await 一致(IR32):等全部結束才回傳,有失敗時丟「排在最前面」那一份的錯誤,
// 不受回應先後影響(錯誤分類決定要不要登出);也不會提早返回而讓還在途的讀取事後才回來。
export async function allInOrder(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((r) => r.value);
}
