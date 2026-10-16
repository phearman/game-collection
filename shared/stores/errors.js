// 一般寫入回傳失敗原因;交易保留原例外(含回滾資訊)。
export function failureReason(error) {
  const source = error?.rollbackFailed ? error.cause ?? error : error;
  if (source?.reason) return source.reason;
  if (source?.code === 'LOCAL_DATA_LIMIT') return 'limit';
  if (source?.name === 'QuotaExceededError') return 'quota';
  return 'write';
}

export const writeFailure = (error) => ({ ok: false, reason: failureReason(error) });
