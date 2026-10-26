// 遊戲清單:大廳與各遊戲頁共用。status = 'active'(開發中/可玩)或 'planned'(規劃中)。
// category(RS38,必填):puzzle 益智 / word 文字 / board 棋類 / action 動作 / sport 運動競速。
// featured(RS38 精選,選填,最多 3 款):{ order, note };note 為卡片上的一句說明(10 字內),由 PM 改檔隨發佈生效。
export const GAMES = [
  { id: '2048', code: 'G1', version: '1.5', title: '2048', icon: '🔢', desc: '滑動合併數字方塊', category: 'puzzle', status: 'active' },
  { id: 'minesweeper', code: 'G2', version: '1.2', title: '踩地雷', icon: '💣', desc: '連鎖展開找出地雷', category: 'puzzle', status: 'active' },
  { id: 'wordle', code: 'G3', version: '1.6', title: 'Wordle', icon: '🔤', desc: '六次內猜中單字', category: 'word', status: 'active' },
  { id: 'tictactoe', code: 'G4', version: '1.2', title: '井字棋', icon: '⭕', desc: '挑戰無敵 AI', category: 'board', status: 'active' },
  { id: 'sudoku', code: 'G5', version: '1.8', title: '數獨', icon: '🧩', desc: '五種難度隨機出題', category: 'puzzle', status: 'active' },
  { id: 'snake', code: 'G6', version: '1.2', title: '貪食蛇', icon: '🐍', desc: '越吃越長別撞牆', category: 'action', status: 'active' },
  { id: 'stairs', code: 'G7', version: '1.6', title: '下樓梯', icon: '🪜', desc: '一路往下別碰頂刺', category: 'action', status: 'active' },
  { id: 'keeper', code: 'G8', version: '1.3', title: '足球守門員', icon: '🧤', desc: '撲出小朋友的射門', category: 'sport', status: 'active' },
  { id: 'moto', code: 'G9', version: '1.2', title: '越野機車', icon: '🏍️', desc: '加速閃障礙,衝過終點', category: 'sport', status: 'active' },
  { id: 'moto2', code: 'G10', version: '1.1', title: '越野機車 橫向版', icon: '🏁', desc: '飛越跳台,小心引擎過熱', category: 'sport', status: 'active' },
  { id: 'memory', code: 'G11', version: '1.2', title: '翻翻樂', icon: '🃏', desc: '翻牌配對考記憶', category: 'puzzle', status: 'active' },
  { id: 'reversi', code: 'G12', version: '1.0', title: '黑白棋', icon: '⚫', desc: '夾住翻轉,子多者勝', category: 'board', status: 'active' },
  { id: 'bridge', code: 'G13', version: '1.0', title: '小人過橋', icon: '🌉', desc: '按住搭橋,剛好就過', category: 'action', status: 'active' },
  { id: 'archery', code: 'G14', version: '1.1', title: '弓箭射擊', icon: '🏹', desc: '拉弓射靶,看風出手', category: 'sport', status: 'active' },
  { id: 'peg', code: 'G15', version: '1.0', title: '孔明棋', icon: '🔵', desc: '跳子吃子,剩一顆最強', category: 'puzzle', featured: { order: 1, note: '新遊戲' }, status: 'active' },
  { id: 'idiom', code: 'G16', version: '1.2', title: '成語填空', icon: '📜', desc: '四字成語選字填空', category: 'word', status: 'active' },
];
