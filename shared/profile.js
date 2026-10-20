// 個人紀錄 API(RS1):遊戲與畫面只用這裡。規則一律呼叫 progress.js,這裡只串接 store。
// 主體在 profile-core.js;本檔加上各遊戲的存檔格式檢查(讀存檔、匯入驗證用)。大廳只讀摘要,改用 profile-core.js 以免載入全部遊戲的 logic.js(IR46)。
import { createProfile as createProfileCore } from './profile-core.js?v=e848582';
import { isValidState as valid2048 } from '../games/2048/logic.js?v=e848582';
import { isValidState as validTictactoe } from '../games/tictactoe/logic.js?v=e848582';
import { isValidState as validSnake } from '../games/snake/logic.js?v=e848582';
import { isValidState as validMinesweeper } from '../games/minesweeper/logic.js?v=e848582';
import { isValidState as validSudoku } from '../games/sudoku/logic.js?v=e848582';
import { isValidState as validWordle } from '../games/wordle/logic.js?v=e848582';
import { isValidState as validKeeper } from '../games/keeper/logic.js?v=e848582';
import { isValidState as validStairs } from '../games/stairs/logic.js?v=e848582';
import { isValidState as validMoto } from '../games/moto/logic.js?v=e848582';
import { isValidState as validMoto2 } from '../games/moto2/logic.js?v=e848582';
import { isValidState as validMemory } from '../games/memory/logic.js?v=e848582';
import { isValidState as validReversi } from '../games/reversi/logic.js?v=e848582';
import { isValidState as validBridge } from '../games/bridge/logic.js?v=e848582';
import { isValidState as validArchery } from '../games/archery/logic.js?v=e848582';
import { isValidState as validPeg } from '../games/peg/logic.js?v=e848582';
import { isValidState as validIdiom } from '../games/idiom/logic.js?v=e848582';

// 各遊戲存檔 state 的格式檢查(匯入驗證用)。
export const STATE_VALIDATORS = { 2048: valid2048, tictactoe: validTictactoe, snake: validSnake, minesweeper: validMinesweeper, sudoku: validSudoku, wordle: validWordle, keeper: validKeeper, stairs: validStairs, moto: validMoto, moto2: validMoto2, reversi: validReversi, memory: validMemory, archery: validArchery, idiom: validIdiom };
STATE_VALIDATORS['wordle-daily'] = validWordle;
STATE_VALIDATORS['sudoku-daily'] = validSudoku;
STATE_VALIDATORS['minesweeper-daily'] = validMinesweeper;
STATE_VALIDATORS['memory-daily'] = validMemory;
STATE_VALIDATORS.bridge = validBridge;
STATE_VALIDATORS.peg = validPeg;

// 與 profile-core.js 相同,只是 stateValidators 預設為 STATE_VALIDATORS(未傳或傳 undefined 時)。
export function createProfile(options = {}) {
  return createProfileCore({ ...options, stateValidators: options.stateValidators === undefined ? STATE_VALIDATORS : options.stateValidators });
}
