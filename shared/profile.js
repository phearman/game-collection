// 個人紀錄 API(RS1):遊戲與畫面只用這裡。規則一律呼叫 progress.js,這裡只串接 store。
// 主體在 profile-core.js;本檔加上各遊戲的存檔格式檢查(讀存檔、匯入驗證用)。大廳只讀摘要,改用 profile-core.js 以免載入全部遊戲的 logic.js(IR46)。
import { createProfile as createProfileCore } from './profile-core.js?v=32c428b';
import { isValidState as valid2048 } from '../games/2048/logic.js?v=32c428b';
import { isValidState as validTictactoe } from '../games/tictactoe/logic.js?v=32c428b';
import { isValidState as validSnake } from '../games/snake/logic.js?v=32c428b';
import { isValidState as validMinesweeper } from '../games/minesweeper/logic.js?v=32c428b';
import { isValidState as validSudoku } from '../games/sudoku/logic.js?v=32c428b';
import { isValidState as validWordle } from '../games/wordle/logic.js?v=32c428b';
import { isValidState as validKeeper } from '../games/keeper/logic.js?v=32c428b';
import { isValidState as validStairs } from '../games/stairs/logic.js?v=32c428b';
import { isValidState as validMoto } from '../games/moto/logic.js?v=32c428b';
import { isValidState as validMoto2 } from '../games/moto2/logic.js?v=32c428b';
import { isValidState as validMemory } from '../games/memory/logic.js?v=32c428b';
import { isValidState as validReversi } from '../games/reversi/logic.js?v=32c428b';
import { isValidState as validBridge } from '../games/bridge/logic.js?v=32c428b';
import { isValidState as validArchery } from '../games/archery/logic.js?v=32c428b';
import { isValidState as validPeg } from '../games/peg/logic.js?v=32c428b';
import { isValidState as validIdiom } from '../games/idiom/logic.js?v=32c428b';

// 各遊戲存檔 state 的格式檢查(匯入驗證用)。
export const STATE_VALIDATORS = { 2048: valid2048, tictactoe: validTictactoe, snake: validSnake, minesweeper: validMinesweeper, sudoku: validSudoku, wordle: validWordle, keeper: validKeeper, stairs: validStairs, moto: validMoto, moto2: validMoto2, reversi: validReversi, memory: validMemory, archery: validArchery, idiom: validIdiom };
STATE_VALIDATORS['wordle-daily'] = validWordle;
STATE_VALIDATORS['sudoku-daily'] = validSudoku;
STATE_VALIDATORS['minesweeper-daily'] = validMinesweeper;
STATE_VALIDATORS['memory-daily'] = validMemory;
// IR81:日期槽由 progress.stateValidatorFor 嚴格解析後對應這三款 daily validator。
// RS91:往日題目練習各有獨立存檔槽,不碰一般局與今日挑戰的存檔。
STATE_VALIDATORS['sudoku-practice'] = validSudoku;
STATE_VALIDATORS['minesweeper-practice'] = validMinesweeper;
STATE_VALIDATORS['memory-practice'] = validMemory;
STATE_VALIDATORS.bridge = validBridge;
STATE_VALIDATORS.peg = validPeg;

// 與 profile-core.js 相同,只是 stateValidators 預設為 STATE_VALIDATORS(未傳或傳 undefined 時)。
export function createProfile(options = {}) {
  return createProfileCore({ ...options, stateValidators: options.stateValidators === undefined ? STATE_VALIDATORS : options.stateValidators });
}
