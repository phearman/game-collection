// 遊戲清單:大廳與各遊戲頁共用。status = 'active'(開發中/可玩)或 'planned'(規劃中)。
export const GAMES = [
  { id: '2048', title: '2048', icon: '🔢', desc: '滑動合併數字方塊', status: 'active' },
  { id: 'minesweeper', title: '踩地雷', icon: '💣', desc: '連鎖展開找出地雷', status: 'active' },
  { id: 'wordle', title: 'Wordle', icon: '🔤', desc: '六次內猜中單字', status: 'planned' },
  { id: 'tictactoe', title: '井字棋', icon: '⭕', desc: '挑戰無敵 AI', status: 'active' },
  { id: 'sudoku', title: '數獨', icon: '🧩', desc: '三種難度隨機出題', status: 'active' },
  { id: 'snake', title: '貪食蛇', icon: '🐍', desc: '越吃越長別撞牆', status: 'active' },
];
