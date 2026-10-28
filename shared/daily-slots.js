// Slot dates are supplied by daily RPCs, never derived from the device's day.
export function validDailyDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith('0000')) return false;
  const stamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day;
}
export const legacyDailySlot = (game) => `${game}-daily`;
export function dailySlot(game, day) {
  if (!['sudoku', 'minesweeper', 'memory'].includes(game) || !validDailyDay(day)) throw new Error('Invalid daily slot');
  return `${game}-daily-${day}`;
}
export function parseDailySlot(slot) {
  const match = /^(sudoku|minesweeper|memory)-daily-(\d{4}-\d{2}-\d{2})$/.exec(slot);
  return match && validDailyDay(match[2]) ? { game: match[1], day: match[2] } : null;
}
export const DAILY_GRACE_HOURS = 36;
export const dailySlotDeadline = (day) => Date.parse(`${day}T00:00:00+08:00`) + DAILY_GRACE_HOURS * 3600000;

// Shared by local and cloud stores. Write the dated copy successfully before removing legacy.
// An existing dated copy always wins, including when a still-open old tab writes legacy again.
export async function migrateDailySlot(store, slot) {
  const parsed = parseDailySlot(slot);
  if (!parsed) return;
  const legacy = legacyDailySlot(parsed.game);
  const old = await store.getSave(legacy);
  if (old?.state?.daily !== parsed.day) return;
  const current = await store.getSave(slot);
  if (!current) {
    const save = { ...old, game_id: slot };
    let result;
    // Offline cloud write throws: keep playing the cached legacy board (pre-IR81 behaviour) and retry later.
    try { result = await (store.putSaveIfMissing ?? store.putSave).call(store, save); }
    catch (error) { return { save, persisted: false, failure: { ok: false, error } }; }
    // Local quota failure must not turn an existing board into a missing save.
    // Profile retains this copy in memory and retries writing the dated slot.
    if (result === false || result?.ok === false) return { save, persisted: false, failure: result };
  }
  // Once dated exists it wins even if deleting legacy fails: ignoring legacy is safe.
  try {
    await (store.deleteLegacyDailySlot ? store.deleteLegacyDailySlot(parsed.game, parsed.day) : store.deleteSave(legacy));
  } catch { /* Retry cleanup on the next load; the dated copy remains authoritative. */ }
}
