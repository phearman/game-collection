// MemoryStore:store 介面的記憶體實作(測試用)。介面說明見 supabase.js。
import { PLAYS_LIMIT, pushPlay, mergeFinished } from '../progress.js?v=be1ebb6';

const copy = (v) => (v === undefined ? v : structuredClone(v));

export class MemoryStore {
  // legacy:模擬舊 localStorage 的最佳分數 { [game_id]: best }(舊資料遷移測試用)
  constructor({ legacy = {}, now = Date.now } = {}) {
    this.legacy = { ...legacy };
    this.profile = null;
    this.saves = new Map();
    this.plays = [];
    this.stats = {};
    this.finished = [];
    this.now = now;
  }
  get finishFromBaseline() { return true; }
  async listFinished() { return copy(mergeFinished(this.finished, [], this.now())); }

  async getProfile() { return copy(this.profile); }
  async putProfile(profile) { this.profile = copy(profile); return true; }

  async getSave(gameId) { return copy(this.saves.get(gameId) ?? null); }
  async putSave(save) { this.saves.set(save.game_id, copy(save)); return true; }
  async deleteSave(gameId) { this.saves.delete(gameId); return true; }
  async listSaves() { return copy([...this.saves.values()]); }

  async addPlay(play) { this.plays = pushPlay(this.plays, copy(play)); return true; }
  async listPlays({ gameId, limit } = {}) {
    const list = gameId ? this.plays.filter((p) => p.game_id === gameId) : this.plays;
    return copy(limit ? list.slice(0, limit) : list);
  }

  async getStats(gameId) { return copy(this.stats[gameId] ?? null); }
  async putStats(stats) { this.stats[stats.game_id] = copy(stats); return true; }
  async listStats() { return copy(this.stats); }

  async exportAll() {
    const finished = await this.listFinished();
    return { profile: copy(this.profile), stats: copy(this.stats), plays: copy(this.plays), saves: await this.listSaves(),
      ...(finished.length ? { finished } : {}) };
  }
  async importAll({ profile, stats, plays, saves, finished = [] }) {
    this.finished = mergeFinished(this.finished, finished, this.now());
    this.profile = copy(profile);
    this.stats = copy(stats);
    this.plays = copy(plays).slice(0, PLAYS_LIMIT);
    this.saves = new Map(copy(saves).map((s) => [s.game_id, s]));
  }

  // 結算一次提交(IR6):記憶體寫入不會失敗。
  async commitFinish({ gameId, saveId = gameId, profile, stats, play, prepare }) {
    const finished = mergeFinished(this.finished, [], this.now());
    if (finished.some((r) => r.id === play.id)) {
      this.saves.delete(saveId);
      return { duplicate: true, profile: copy(this.profile) };
    }
    const out = prepare?.(copy(this.profile), copy(this.stats));
    if (out) {
      profile = out.profile;
      play = out.play;
      stats = out.stats[gameId];
    }
    this.saves.delete(saveId);
    this.profile = copy(profile);
    this.stats[stats.game_id] = copy(stats);
    this.plays = pushPlay(this.plays, copy(play));
    this.finished = mergeFinished([{ id: play.id, finished_at: new Date(this.now()).toISOString() }], finished, this.now());
    return { duplicate: false, out };
  }

  async legacyBest(gameId) { return Number(this.legacy[gameId]) || 0; }
}
