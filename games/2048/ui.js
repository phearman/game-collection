// 2048 畫面層:狀態、渲染、輸入。規則一律呼叫 logic.js,這裡不寫規則。
import { move, newBoard, addRandomTile, canMove, hasWon, cloneBoard, overlayFor } from './logic.js';
import { getBest, updateBest } from '../../shared/storage.js';
import { bindThemeToggle } from '../../shared/theme.js';
import { setupHelp } from '../../shared/help.js';

const GAME_ID = '2048';
const $ = (id) => document.getElementById(id);

let state;

function start() {
  state = { board: newBoard(), score: 0, prev: null, won: false, keepPlaying: false, over: false, fresh: null };
  render();
}

function step(dir) {
  if (state.over || (state.won && !state.keepPlaying)) return;
  const r = move(state.board, dir);
  if (!r.moved) return;
  const before = cloneBoard(state.board);
  const placed = addRandomTile(r.board);
  state.prev = { board: before, score: state.score, won: state.won };
  state.board = placed;
  state.score += r.gained;
  state.fresh = findNewTile(r.board, placed);
  if (!state.won && hasWon(placed)) state.won = true;
  state.over = !canMove(placed);
  render();
}

function findNewTile(beforeAdd, afterAdd) {
  for (let r = 0; r < afterAdd.length; r++) {
    for (let c = 0; c < afterAdd.length; c++) {
      if (beforeAdd[r][c] === 0 && afterAdd[r][c] !== 0) return `${r},${c}`;
    }
  }
  return null;
}

function undo() {
  if (!state.prev) return;
  state.board = state.prev.board;
  state.score = state.prev.score;
  state.won = state.prev.won;
  state.over = false;
  state.prev = null;
  state.fresh = null;
  render();
}

function tileClass(v) {
  if (v === 0) return 'tile';
  const color = v > 2048 ? 'vbig' : `v${v}`;
  return `tile ${color}${v >= 1024 ? ' big' : ''}`;
}

function render() {
  $('board').innerHTML = state.board.flatMap((row, r) => row.map((v, c) => {
    const pop = state.fresh === `${r},${c}` ? ' pop' : '';
    return `<div class="${tileClass(v)}${pop}" role="gridcell">${v || ''}</div>`;
  })).join('');
  $('score').textContent = state.score.toLocaleString();
  $('best').textContent = updateBest(GAME_ID, state.score).toLocaleString();
  $('undo').disabled = !state.prev;
  renderOverlay();
}

function renderOverlay() {
  const overlay = $('overlay');
  const actions = $('overlay-actions');
  const kind = overlayFor(state);
  if (kind === 'over') {
    $('overlay-title').textContent = '遊戲結束';
    actions.innerHTML = '<button class="btn" data-act="new">再玩一次</button>';
  } else if (kind === 'won') {
    $('overlay-title').textContent = '達成 2048!';
    actions.innerHTML = '<button class="btn" data-act="continue">繼續玩</button><button class="btn" data-act="new">新遊戲</button>';
  } else if (kind === 'won-over') {
    $('overlay-title').textContent = '達成 2048!';
    actions.innerHTML = '<button class="btn" data-act="new">新遊戲</button>';
  } else {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
}

const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
};

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  const dir = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!dir) return;
  e.preventDefault();
  step(dir);
});

let touch = null;
$('board').addEventListener('pointerdown', (e) => { touch = { x: e.clientX, y: e.clientY }; });
$('board').addEventListener('pointerup', (e) => {
  if (!touch) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  touch = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});

$('new').addEventListener('click', start);
$('undo').addEventListener('click', undo);
$('overlay-actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (act === 'new') start();
  if (act === 'continue') { state.keepPlaying = true; render(); }
});

bindThemeToggle($('theme'));
$('best').textContent = getBest(GAME_ID).toLocaleString();
start();

// 示範用固定盤面:直接呼叫 logic.move,示範結果與實際規則一致(不放新方塊,避免畫面跳動)。
const row = (cells) => [cells, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const demoStep = (before, dir, caption, result) => ({ before, after: move(before, dir).board, caption, result });
setupHelp({
  gameId: GAME_ID,
  title: '2048 玩法',
  mountAfter: document.querySelector('.topbar .btn'),
  rules: `
    <ol>
      <li>按方向鍵或 W/A/S/D(手機在棋盤上滑動),<b>所有方塊</b>一起往該方向滑到底。</li>
      <li>兩個<b>相同數字</b>撞在一起會合成一個(2+2→4),合出的數字加進分數。</li>
      <li>每移動一次,空格會冒出一個新的 2(偶爾是 4)。</li>
      <li>合出 <b>2048</b> 就勝利,可以選擇繼續玩;棋盤滿了又無法合併,遊戲結束。</li>
      <li>「復原」可退回上一步;「新遊戲」重新開局。</li>
    </ol>
    <p>訣竅:把最大的方塊固定在一個角落,盡量只用兩、三個方向。</p>`,
  demo: {
    render: (board) => `<div class="board">${board.flatMap((r) => r.map((v) => `<div class="${tileClass(v)}">${v || ''}</div>`)).join('')}</div>`,
    steps: [
      demoStep(row([2, 2, 0, 0]), 'left', '按 ← :兩個 2 往左滑…', '…撞在一起合成 4,分數 +4'),
      demoStep(row([2, 2, 2, 2]), 'left', '四個 2 往左…', '…兩兩合併成 4、4,不會一次合成 8'),
      demoStep(row([4, 0, 4, 4]), 'left', '4、空、4、4 往左…', '…先合靠左的兩個 4,得到 8、4'),
      demoStep([[0, 0, 0, 2], [0, 0, 0, 2], [0, 0, 0, 4], [0, 0, 0, 8]], 'down', '按 ↓ :直的一排也能合…', '…2+2→4,大數字留在右下角'),
    ],
  },
});
