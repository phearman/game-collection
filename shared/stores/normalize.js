// 數獨舊版與成語入門(含典故漫畫)紀錄使用 easy;只在送雲端時轉成共用難度。
// 建立新物件,不回寫登入合併所讀取的本機資料。
export function normalizePlay(play) {
  if (play?.game_id === 'idiom' && play.difficulty === 'easy') {
    return { ...play, difficulty: 'normal',
      detail: { idiom_difficulty: 'easy', ...play.detail } };
  }
  if (play?.game_id !== 'sudoku' || play.difficulty !== 'easy') return play;
  return { ...play, difficulty: 'normal',
    detail: { sudoku_difficulty: 'easy', ...play.detail } };
}
