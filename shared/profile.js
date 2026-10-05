// 個人紀錄 API(RS1):遊戲與畫面只用這裡。規則一律呼叫 progress.js,這裡只串接 store。
import { GAMES } from './games.js';
import {
  emptyProfile, migrateLegacyBest, applyFinish, applyUnlock, levelProgress, ACHIEVEMENTS, ACHIEVEMENT_XP, recentOrder,
  timerInit, timerEvent, timerSeconds, validateImport, isValidGameSave, pushPlay, exportData, exportFileName, iso, PLAYS_LIMIT,
} from './progress.js';
import { isValidState as valid2048 } from '../games/2048/logic.js';
import { isValidState as validTictactoe } from '../games/tictactoe/logic.js';
import { isValidState as validSnake } from '../games/snake/logic.js';
import { isValidState as validMinesweeper } from '../games/minesweeper/logic.js';
import { isValidState as validSudoku } from '../games/sudoku/logic.js';
import { isValidState as validWordle } from '../games/wordle/logic.js';
import { isValidState as validKeeper } from '../games/keeper/logic.js';
import { isValidState as validStairs } from '../games/stairs/logic.js';

// 各遊戲存檔 state 的格式檢查(匯入驗證用)。
export const STATE_VALIDATORS = { 2048: valid2048, tictactoe: validTictactoe, snake: validSnake, minesweeper: validMinesweeper, sudoku: validSudoku, wordle: validWordle, keeper: validKeeper, stairs: validStairs };

// randomUUID 只在安全來源(https / localhost)可用;其他情況退回 getRandomValues 組 v4 UUID。
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const noLive = () => ({ xp: 0, achievements: [] });

// store:store 介面實作;now:時鐘(毫秒,可注入)。
// doc / win:有 document / window 時自動接 visibilitychange / pagehide / storage(測試可注入假物件或傳 null)。
export async function createProfile({
  store, now = Date.now, gameList = GAMES, doc = globalThis.document, win = globalThis.window,
  stateValidators = STATE_VALIDATORS,
} = {}) {
  // 首次載入(尚無 profile)才做舊資料遷移;之後的匯入覆蓋不會被舊 key 再蓋回去。
  let mem = await store.getProfile();
  let memDirty = false; // profile 最近一次寫入失敗 ⇒ 以記憶體為準(避免讀回舊資料重複發成就/XP)
  const statsMem = {}; // 寫入失敗的 stats,以記憶體為準
  const putProfile = async (profile) => {
    mem = profile;
    memDirty = (await store.putProfile(profile)) === false;
  };
  const putStats = async (stats) => {
    if ((await store.putStats(stats)) === false) statsMem[stats.game_id] = stats;
    else delete statsMem[stats.game_id];
  };
  const playsMem = []; // 寫入失敗的局紀錄(新到舊)
  const getProfile = async () => (memDirty ? mem : ((await store.getProfile()) ?? mem));
  const listStats = async () => ({ ...(await store.listStats()), ...statsMem });
  const addPlay = async (play) => {
    if ((await store.addPlay(play)) === false) playsMem.unshift(play);
  };
  const listPlays = async () => {
    const stored = await store.listPlays();
    const ids = new Set(stored.map((p) => p.id));
    return [...playsMem.filter((p) => !ids.has(p.id)), ...stored]
      .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))
      .reduceRight((list, p) => pushPlay(list, p), []);
  };

  if (!mem) {
    let stats = await store.listStats();
    for (const g of gameList) stats = migrateLegacyBest(stats, g.id, await store.legacyBest(g.id));
    for (const s of Object.values(stats)) await putStats(s);
    await putProfile(emptyProfile(uuid()));
  }

  // 計時:一次只計一款遊戲(一頁一款)。
  let timer = null; // { gameId, startedAt, t: progress timer }
  const loaded = new Map(); // gameId → 最近一次讀到/寫入的存檔(接續秒數與開局時間)
  const savesDirty = new Set(); // 最近一次寫入失敗的存檔 gameId ⇒ 快照以 loaded 為準
  const live = new Map(); // gameId → 本局即時獎勵明細 { xp, achievements }(隨存檔保存)
  const stored = new Set(); // 存檔曾成功寫入 store(或從 store 讀到)的 gameId:用來區分「從未存成功」與「被其他分頁刪除」(IR9)
  // 只疊入未成功寫入的存檔;已寫入的以 store 為準(其他分頁可能已覆蓋或刪除,IR3)。
  const listSaves = async () => {
    const all = new Map((await store.listSaves()).map((sv) => [sv.game_id, sv]));
    for (const id of savesDirty) if (loaded.has(id)) all.set(id, loaded.get(id));
    return [...all.values()];
  };

  // 其他分頁「整份匯入」(或清空 localStorage)⇒ 本頁快取全部作廢:記憶體疊加層、存檔快取、本局即時獎勵,
  // 計時器改從現在重新起算(IR3、PR #5 F1)。一般跨分頁寫入不走這裡:讀取本來就每次重讀 store,
  // 再疊上本頁寫入失敗的成果,所以不會丟掉未持久化的資料(F2)。
  const invalidateAll = () => {
    memDirty = false;
    for (const k of Object.keys(statsMem)) delete statsMem[k];
    playsMem.length = 0;
    savesDirty.clear();
    loaded.clear();
    live.clear();
    stored.clear();
    if (timer) {
      const t = now();
      timer = { gameId: timer.gameId, startedAt: t, t: timerInit(t, 0) };
      if (doc?.visibilityState === 'hidden') event('hidden');
    }
  };

  // summary 與匯出共用的一致快照:store 內容疊上寫入失敗而只在記憶體的資料。
  const snapshot = async () => ({
    profile: await getProfile(),
    stats: await listStats(),
    plays: await listPlays(),
    saves: await listSaves(),
  });

  const event = (type) => {
    if (timer) timer.t = timerEvent(timer.t, { t: now(), type });
  };
  const elapsed = () => (timer ? timerSeconds(timer.t, now()) : 0);

  const writeSave = async (gameId, state) => {
    const prev = loaded.get(gameId);
    const t = now();
    const running = timer?.gameId === gameId;
    const save = {
      game_id: gameId,
      state,
      active_sec: running ? elapsed() : (prev?.active_sec ?? 0),
      started_at: running ? iso(timer.startedAt) : (prev?.started_at ?? iso(t)),
      updated_at: iso(t),
      version: (prev?.version ?? 0) + 1,
    };
    if (live.get(gameId)?.achievements.length) save.live = live.get(gameId);
    loaded.set(gameId, save);
    if ((await store.putSave(save)) === false) savesDirty.add(gameId);
    else {
      savesDirty.delete(gameId);
      stored.add(gameId);
    }
  };

  // 分頁隱藏或離頁時,把最新秒數寫進存檔(還沒有存檔 = 還沒有效操作,不寫)。
  // store 裡的存檔若已被其他分頁替換(開局時間不同、版本較新)或刪除,就不寫回,免得舊存檔「復活」(F1)。
  // 從未成功寫入過的存檔(例:首次寫入就配額不足)store 裡本來就沒有 ⇒ 不是被刪,保留並重試寫入(IR9-1)。
  const flush = async () => {
    const id = timer?.gameId;
    const save = id && loaded.get(id);
    if (!save) return;
    const cur = await store.getSave(id);
    if (loaded.get(id) !== save) return; // 等待期間已被另一次 flush/結算處理(隱藏與離頁常連發)
    const removedElsewhere = !cur && stored.has(id);
    if (removedElsewhere || (cur && (cur.started_at !== save.started_at || cur.version > save.version))) {
      loaded.delete(id);
      savesDirty.delete(id);
      stored.delete(id);
      return;
    }
    await writeSave(id, save.state);
  };

  doc?.addEventListener?.('visibilitychange', () => {
    const hidden = doc.visibilityState === 'hidden';
    event(hidden ? 'hidden' : 'visible');
    if (hidden) flush();
  });
  win?.addEventListener?.('pagehide', flush);
  // storage 事件只在「其他」分頁改動時觸發;key 為 null 表示整個 localStorage 被清空。
  win?.addEventListener?.('storage', (e) => {
    if (e?.key == null || store.isImportKey?.(e.key)) invalidateAll();
  });

  const api = {
    async loadSave(gameId) {
      const save = await store.getSave(gameId);
      // 沒有、壞掉、或 game_id 與請求不符的存檔 ⇒ 開新局,且不建立 loaded/live 快取(IR3)
      if (save?.game_id !== gameId || !isValidGameSave(save, stateValidators)) return null;
      loaded.set(gameId, save);
      live.set(gameId, save.live ?? noLive());
      stored.add(gameId);
      return save.state;
    },

    saveState(gameId, state) {
      return writeSave(gameId, state);
    },

    // 丟棄不記錄的局(例:Wordle 只用了提示、沒猜過就重開):刪存檔、清快取與計時,下一局從 0 起算。
    async discardSave(gameId) {
      loaded.delete(gameId);
      savesDirty.delete(gameId);
      stored.delete(gameId);
      live.delete(gameId);
      if (timer?.gameId === gameId) timer = null;
      await store.deleteSave(gameId);
    },

    // 開始計時:有載入的存檔就接著它的秒數與開局時間,否則從 0 起算。分頁目前隱藏就先暫停。
    startTimer(gameId) {
      const save = loaded.get(gameId);
      const t = now();
      timer = {
        gameId,
        startedAt: save ? Date.parse(save.started_at) : t,
        t: timerInit(t, save?.active_sec ?? 0),
      };
      if (doc?.visibilityState === 'hidden') event('hidden');
    },

    input() { event('input'); },

    // 外部通知分頁可見性(瀏覽器會自動接 visibilitychange;測試或特殊頁面可手動呼叫)。
    setVisible(visible) {
      event(visible ? 'visible' : 'hidden');
      if (!visible) flush();
    },

    // 本局已即時入帳的獎勵(續玩還原後也在)。
    liveRewards(gameId) {
      return structuredClone(live.get(gameId) ?? noLive());
    },

    // 結算 = 一次提交(IR6):store.commitFinish 刪存檔並寫 profile/stats/局紀錄,任一步失敗就整批還原並丟錯
    // (結算路徑不走記憶體備援)。失敗時本頁狀態完全不動,重試會從目前的資料重新計算(其他分頁匯入後也正確)。
    // 基準一律是「持久」的 profile/stats(R2):其他分頁期間的入帳不會被本頁記憶體裡的舊 profile 蓋掉;
    // 本局即時成就若當時沒寫進去(持久 profile 裡沒有),就在新基準上補入帳。
    async finishPlay(gameId, { result, score = 0, difficulty = 'normal', detail = {}, assist = false }) {
      const t = now();
      const save = loaded.get(gameId);
      const running = timer?.gameId === gameId;
      const lv = live.get(gameId);
      const base = (await store.getProfile()) ?? emptyProfile(mem.device_id);
      const missing = (lv?.achievements ?? []).filter((id) => !base.achievements?.[id]);
      const profile = missing.length
        ? {
          ...base,
          achievements: { ...base.achievements, ...Object.fromEntries(missing.map((id) => [id, iso(t)])) },
          xp: (base.xp ?? 0) + ACHIEVEMENT_XP * missing.length,
        }
        : base;
      const out = applyFinish({
        profile,
        stats: await store.listStats(),
        gameId, result, score, difficulty, detail, assist,
        startedAt: running ? timer.startedAt : (save ? Date.parse(save.started_at) : t),
        endedAt: t,
        durationSec: running ? elapsed() : (save?.active_sec ?? 0),
        id: uuid(),
        live: lv,
      });
      await store.commitFinish({ gameId, profile: out.profile, stats: out.stats[gameId], play: out.play });
      mem = out.profile;
      memDirty = false;
      delete statsMem[gameId];
      loaded.delete(gameId);
      savesDirty.delete(gameId);
      stored.delete(gameId);
      live.delete(gameId);
      if (timer?.gameId === gameId) timer = null;
      return { play: out.play, xpGained: out.xpGained, xpBreakdown: out.xpBreakdown, newAchievements: out.newAchievements, level: out.level };
    },

    // 結算失敗後使用者選「不存了」:紀錄已整批還原(什麼都沒記);丟掉本局存檔與快取,下一局從 0 起算(IR6)。
    async abandonFinish(gameId) {
      await api.discardSave(gameId);
    },

    async unlock(gameId, ev) {
      const out = applyUnlock({ profile: await getProfile(), stats: await listStats(), gameId, event: ev, now: now() });
      if (out.newAchievements.length) {
        await putProfile(out.profile);
        const cur = live.get(gameId) ?? noLive();
        live.set(gameId, { xp: cur.xp + out.xpGained, achievements: [...cur.achievements, ...out.newAchievements] });
        const save = loaded.get(gameId);
        if (save) await writeSave(gameId, save.state);
      }
      return { xpGained: out.xpGained, newAchievements: out.newAchievements, level: out.level };
    },

    async best(gameId) {
      return (await listStats())[gameId]?.best_score ?? 0;
    },

    async summary() {
      const { profile, stats, plays, saves } = await snapshot();
      const all = Object.values(stats);
      return {
        device_id: profile.device_id,
        xp: profile.xp,
        ...levelProgress(profile.xp),
        plays_count: all.reduce((n, s) => n + s.plays_count, 0),
        total_sec: all.reduce((n, s) => n + s.total_sec, 0),
        streak: profile.streak,
        achievements: ACHIEVEMENTS.map(({ id, name, icon, cond }) => ({ id, name, icon, cond, unlocked_at: profile.achievements[id] ?? null })),
        games: gameList.map((g) => ({ ...g, stats: stats[g.id] ?? null })),
        recent: recentOrder(gameList, stats, Object.fromEntries(saves.map((s) => [s.game_id, s]))).map((g) => g.id),
        plays: plays.slice(0, PLAYS_LIMIT),
        saves: saves.map((s) => s.game_id),
      };
    },

    async exportFile() {
      const t = now();
      return { name: exportFileName(t), data: exportData({ ...(await snapshot()), now: t }) };
    },

    // 只驗證、不寫入:→ { ok, error } 或 { ok, summary, data }
    checkImport(json) {
      let data;
      try {
        data = typeof json === 'string' ? JSON.parse(json) : json;
      } catch {
        return { ok: false, error: '檔案不是有效的 JSON' };
      }
      return validateImport(data, stateValidators);
    },

    // 驗證通過才整份覆蓋;不合格或寫入失敗都不動現有資料。
    async importFile(json) {
      const check = api.checkImport(json);
      if (!check.ok) return check;
      const { profile, stats, plays, saves } = check.data;
      try {
        await store.importAll({ profile, stats, plays, saves });
      } catch (err) {
        return {
          ok: false,
          error: err?.rollbackFailed
            ? '寫入失敗,且原紀錄無法完整還原(儲存空間不足或無法寫入)'
            : '寫入失敗(儲存空間不足或無法寫入),目前紀錄未變動',
        };
      }
      mem = profile;
      memDirty = false;
      for (const k of Object.keys(statsMem)) delete statsMem[k];
      playsMem.length = 0;
      loaded.clear();
      savesDirty.clear();
      stored.clear();
      live.clear();
      timer = null;
      return check;
    },
  };
  return api;
}
