// 舊版數獨入門紀錄使用 easy;雲端 difficulty 只接受共用難度。
// 建立新物件,不回寫登入合併所讀取的本機資料。
export function normalizePlay(play) {
  if (play?.game_id !== 'sudoku' || play.difficulty !== 'easy') return play;
  return { ...play, difficulty: 'normal',
    detail: { sudoku_difficulty: 'easy', ...play.detail } };
}
