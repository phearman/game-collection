// SupabaseStore:第二期(RS2)實作,第一期只放介面說明(D40)。
//
// store 介面(MemoryStore / LocalStore / SupabaseStore 共同遵守;所有方法回傳 Promise;
// put* / addPlay / deleteSave resolve 為 false 表示未寫入,profile.js 會改以記憶體資料為準):
//   getProfile() → profile | null          putProfile(profile)
//   getSave(gameId) → save | null(save.live = 本局即時獎勵明細,選填)          putSave(save)   deleteSave(gameId)   listSaves() → save[]
//   addPlay(play)                          只保留最近 50 筆,超過丟最舊
//   listPlays({ gameId?, limit? }) → play[]   新到舊
//   getStats(gameId) → stats | null        putStats(stats)   listStats() → { [game_id]: stats }
//   exportAll() → { profile, stats, plays, saves }
//   importAll(data)                        整份覆蓋;失敗須丟錯且原資料不變
//   isImportKey(key) → boolean(選填,同步)  storage 事件的 key 是否為「整份匯入」標記;profile 據此讓快取全部作廢
//   legacyBest(gameId) → number            RS1 前舊最佳分數(只有本機有;雲端實作回 0)
//
// 資料欄位(snake_case,與第二期 Postgres 欄位同名)見 workbook/plans/profile.md §3。

export class SupabaseStore {
  constructor() {
    throw new Error('RS2');
  }
}
