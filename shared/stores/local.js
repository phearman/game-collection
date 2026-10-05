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

// 回滾:只處理本次寫入成功過、而且目前值≠備份的 key(⛔ 碰沒被改到的原值)——先全部移除(騰出新值占的空間),
// 再逐一寫回備份(null = 原本沒有)並讀回驗證。
// → 要丟出的錯誤:還原成功就是原錯誤;還原不了就是帶 rollbackFailed 的新錯誤(畫面明講「原紀錄可能不完整」),
//   並附 retryRestore():用同一份備份再還原一次,回傳同樣規則的錯誤(IR6 R3:還原成功前不准重試結算)。
function rollback(ls, touched, backup, err, label) {
  const same = (k) => {
    try { return ls.getItem(k) === (backup.get(k) ?? null); } catch { return false; }
  };
  const dirty = [...touched].filter((k) => !same(k));
  for (const k of dirty) {
    try { ls.removeItem(k); } catch { /* 下面逐一驗證 */ }
  }
  const failed = [];
  for (const k of dirty) {
    const v = backup.get(k) ?? null;
    if (v !== null) {
      try { ls.setItem(k, v); } catch { /* 下面驗證 */ }
    }
    if (!same(k)) failed.push(k);
  }
  if (!failed.length) return err;
  const e = new Error(`${label} rollback failed: ${failed.join(', ')}`, { cause: err });
  e.rollbackFailed = true;
  e.retryRestore = () => rollback(ls, touched, backup, err, label);
  return e;
}

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
  // 匯入通知標記不算資料:不備份、不刪、不回滾(否則失敗的匯入也會觸發其他分頁作廢,IR9-2);
  // 它是最後一步、寫不進去也算匯入失敗並回滾(否則其他分頁不知道要作廢,IR9-3)。
  async importAll({ profile, stats, plays, saves }) {
    const ls = this.ls(); // 不可用就直接丟錯,什麼都還沒動
    const ours = () => Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k) => k?.startsWith(V1) && k !== KEY.imported);
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
      // 通知其他分頁「整份換掉了」(值每次不同才會觸發 storage 事件);setItem 失敗不會改動該 key
      ls.setItem(KEY.imported, `${Date.now()}-${Math.random()}`);
    } catch (err) {
      throw rollback(ls, touched, backup, err, 'import');
    }
  }

  // 結算一次提交(IR6):刪存檔 → profile → stats → 局紀錄,任一步失敗就把動過的 key 還原成原值並丟錯。
  // 先刪存檔:之後失敗會還原,所以不會出現「紀錄寫了、存檔還在,重載又結算一次」。
  async commitFinish({ gameId, profile, stats, play }) {
    const ls = this.ls(); // 不可用就直接丟錯,什麼都還沒動
    const keys = [KEY.save(gameId), KEY.profile, KEY.stats, KEY.plays];
    const backup = new Map(keys.map((k) => [k, ls.getItem(k)]));
    const parse = (raw, fallback) => {
      try { return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; }
    };
    const allStats = parse(backup.get(KEY.stats), {});
    const plays = parse(backup.get(KEY.plays), []);
    const writes = [
      [KEY.save(gameId), null],
      [KEY.profile, JSON.stringify(profile)],
      [KEY.stats, JSON.stringify({ ...(allStats && typeof allStats === 'object' && !Array.isArray(allStats) ? allStats : {}), [stats.game_id]: stats })],
      [KEY.plays, JSON.stringify(pushPlay(Array.isArray(plays) ? plays : [], play))],
    ];
    const touched = [];
    try {
      for (const [k, v] of writes) {
        if (v === null) ls.removeItem(k);
        else ls.setItem(k, v);
        touched.push(k); // 寫入成功才算動過(失敗的 setItem 不會改動該 key,IR6 R1)
      }
    } catch (err) {
      throw rollback(ls, touched, backup, err, 'finish');
    }
  }

  // 整份匯入成功後寫入的標記 key:其他分頁收到它的 storage 事件就讓 profile 快取全部作廢。
  isImportKey(key) { return key === KEY.imported; }

  // RS1 前的舊最佳分數(shared/storage.js 的 best:{game}),只讀不刪。
  async legacyBest(gameId) { return Number(this.read(`${PREFIX}best:${gameId}`, 0)) || 0; }
}
