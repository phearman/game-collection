// LocalStore:store 介面的 localStorage 實作(第一期)。介面說明見 supabase.js。
// localStorage 可能不可用(隱私模式、封鎖網站資料、配額滿):讀失敗回空值、寫失敗略過並回傳 false,遊戲照常可玩。
// 例外:importAll 要整份覆蓋或完全不動,寫入失敗會還原原資料並丟錯。
import { PLAYS_LIMIT, pushPlay } from '../progress.js';

const PREFIX = 'game-collection:';
const V1 = `${PREFIX}v1:`;
const KEY = {
  profile: `${V1}profile`,
  save: (gameId) => `${V1}save:${gameId}`,
  plays: `${V1}plays`,
  stats: `${V1}stats`,
  imported: `${V1}imported`,
};

export class LocalStore {
  // storage:預設 globalThis.localStorage;測試可注入假物件。
  constructor({ storage } = {}) {
    this.storage = storage;
  }

  ls() { return this.storage ?? globalThis.localStorage; }

  read(key, fallback) {
    try {
      const raw = this.ls().getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  write(key, value) {
    try {
      this.ls().setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false; // 寫不進去就算了,由呼叫端決定要不要改用記憶體資料
    }
  }

  remove(key) {
    try { this.ls().removeItem(key); return true; } catch { return false; }
  }

  keys() {
    try {
      const ls = this.ls();
      return Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k) => k !== null);
    } catch {
      return [];
    }
  }

  async getProfile() { return this.read(KEY.profile, null); }
  async putProfile(profile) { return this.write(KEY.profile, profile); }

  async getSave(gameId) { return this.read(KEY.save(gameId), null); }
  async putSave(save) { return this.write(KEY.save(save.game_id), save); }
  async deleteSave(gameId) { return this.remove(KEY.save(gameId)); }
  async listSaves() {
    return this.keys().filter((k) => k.startsWith(KEY.save(''))).map((k) => this.read(k, null)).filter(Boolean);
  }

  async addPlay(play) {
    const plays = this.read(KEY.plays, []);
    return this.write(KEY.plays, pushPlay(Array.isArray(plays) ? plays : [], play));
  }
  async listPlays({ gameId, limit } = {}) {
    const plays = this.read(KEY.plays, []);
    const list = (Array.isArray(plays) ? plays : []).filter((p) => !gameId || p.game_id === gameId);
    return limit ? list.slice(0, limit) : list;
  }

  async getStats(gameId) { return (await this.listStats())[gameId] ?? null; }
  async putStats(stats) { return this.write(KEY.stats, { ...(await this.listStats()), [stats.game_id]: stats }); }
  async listStats() {
    const stats = this.read(KEY.stats, {});
    return stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : {};
  }

  async exportAll() {
    return { profile: await this.getProfile(), stats: await this.listStats(), plays: await this.listPlays(), saves: await this.listSaves() };
  }
  // 整份覆蓋:先備份本 app 的 v1 資料 → 寫入 → 任何一步失敗就回滾並丟錯(不會只覆蓋一部分)。
  // 回滾:只處理本次真的動過的 key——先全部移除(騰出新值占的空間),再逐一寫回備份並讀回驗證;
  // 仍還原不了就丟 rollbackFailed 錯誤,讓畫面明講「原紀錄可能不完整」。
  async importAll({ profile, stats, plays, saves }) {
    const ls = this.ls(); // 不可用就直接丟錯,什麼都還沒動
    const ours = () => Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k) => k?.startsWith(V1));
    const backup = new Map(ours().map((k) => [k, ls.getItem(k)]));
    const next = new Map([
      [KEY.profile, JSON.stringify(profile)],
      [KEY.stats, JSON.stringify(stats)],
      [KEY.plays, JSON.stringify(plays.slice(0, PLAYS_LIMIT))],
      ...saves.map((s) => [KEY.save(s.game_id), JSON.stringify(s)]),
    ]);
    const touched = new Set(); // 寫入/移除成功的 key(setItem 失敗不會改動該 key)
    try {
      for (const k of backup.keys()) if (!next.has(k)) { ls.removeItem(k); touched.add(k); }
      for (const [k, v] of next) { ls.setItem(k, v); touched.add(k); }
    } catch (err) {
      const failed = [];
      for (const k of touched) {
        try { ls.removeItem(k); } catch { /* 下面逐一驗證 */ }
      }
      for (const k of touched) {
        if (!backup.has(k)) {
          try { if (ls.getItem(k) !== null) failed.push(k); } catch { failed.push(k); }
          continue;
        }
        const v = backup.get(k);
        try { ls.setItem(k, v); } catch { /* 下面驗證 */ }
        try { if (ls.getItem(k) !== v) failed.push(k); } catch { failed.push(k); }
      }
      if (failed.length) {
        const e = new Error(`import rollback failed: ${failed.join(', ')}`, { cause: err });
        e.rollbackFailed = true;
        throw e;
      }
      throw err;
    }
    // 通知其他分頁「整份換掉了」(值每次不同才會觸發 storage 事件);寫不進去不影響匯入結果。
    this.write(KEY.imported, `${Date.now()}-${Math.random()}`);
  }

  // 整份匯入成功後寫入的標記 key:其他分頁收到它的 storage 事件就讓 profile 快取全部作廢。
  isImportKey(key) { return key === KEY.imported; }

  // RS1 前的舊最佳分數(shared/storage.js 的 best:{game}),只讀不刪。
  async legacyBest(gameId) { return Number(this.read(`${PREFIX}best:${gameId}`, 0)) || 0; }
}
