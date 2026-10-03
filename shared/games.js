// 遊戲清單:大廳與各遊戲頁共用。status = 'active'(開發中/可玩)或 'planned'(規劃中)。
export const GAMES = [
  { id: '2048', code: 'G1', title: '2048', icon: '🔢', desc: '滑動合併數字方塊', status: 'active' },
  { id: 'minesweeper', code: 'G2', title: '踩地雷', icon: '💣', desc: '連鎖展開找出地雷', status: 'active' },
  { id: 'wordle', code: 'G3', title: 'Wordle', icon: '🔤', desc: '六次內猜中單字', status: 'active' },
  { id: 'tictactoe', code: 'G4', title: '井字棋', icon: '⭕', desc: '挑戰無敵 AI', status: 'active' },
  { id: 'sudoku', code: 'G5', title: '數獨', icon: '🧩', desc: '三種難度隨機出題', status: 'active' },
  { id: 'snake', code: 'G6', title: '貪食蛇', icon: '🐍', desc: '越吃越長別撞牆', status: 'active' },
  { id: 'stairs', code: 'G7', title: '下樓梯', icon: '🪜', desc: '一路往下別碰頂刺', status: 'active' },
  { id: 'keeper', code: 'G8', title: '足球守門員', icon: '🧤', desc: '撲出小朋友的射門', status: 'active' },
];
