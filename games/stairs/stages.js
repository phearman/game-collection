// 闖關常數表。平台權重與道具機率都由種子取樣，無 DOM 或外部狀態。
export const STAGES = Object.freeze([
  { name: '林間小徑', theme: 'forest', goal: 'floors', target: 15, direction: 1, speed: 1.5, kinds: [['bounce', .12]], coin: .7, heart: .06 },
  { name: '地底洞穴', theme: 'cave', goal: 'time', target: 40, direction: 1, speed: 2.1, kinds: [['moving', .35], ['bounce', .1]], coin: .55, heart: .06 },
  { name: '結冰湖', theme: 'ice', goal: 'coins', target: 12, direction: 1, speed: 1.6, kinds: [['ice', .65], ['moving', .15]], coin: .9, heart: .06 },
  { name: '機關工坊', theme: 'factory', goal: 'floors', target: 25, direction: 1, speed: 1.8, kinds: [['spike', .12], ['flip', .18], ['moving', .15]], coin: .55, heart: .06, shield: .14, enemy: .24 },
  { name: '雲上天梯', theme: 'sky', goal: 'floors', target: 20, direction: -1, speed: 1.6, kinds: [['bounce', .1], ['moving', .2]], coin: .45, heart: .06, cloud: .3 },
  { name: '星光高塔', theme: 'tower', goal: 'flag', target: 30, direction: 1, speed: 2, kinds: [['spike', .12], ['flip', .16], ['moving', .25], ['ice', .1], ['bounce', .08]], coin: .5, heart: .06, star: .15, shield: .08, cloud: .08, enemy: .22 },
].map((s) => Object.freeze({ ...s, kinds: Object.freeze(s.kinds.map((k) => Object.freeze(k))) })));

export const ADVENTURE = Object.freeze({
  movingSpeed: 1.2, iceAccel: 18, iceDrag: 3, enemySpeed: .8, enemySize: .65,
  // 雲(IR48):取得後 cloudSec 秒內駕雲自由飛(上下左右,flySpeed 單位/秒),最高只到 cloudTop(碰不到頂刺);
  // 可隨時下雲;時間到還在空中時,腳下生一朵靜止的雲(cloudUses 次)接住,cloudLife 秒後消散。
  stompBounce: 4.5, starSec: 6, cloudSec: 10, cloudUses: 1, cloudLife: 1.5,
  cloudWidth: 2, flySpeed: 5, cloudTop: 1.4, clearScore: 30, coinScore: 2, stompScore: 5,
});

export const stageFor = (s) => STAGES[s.stage - 1];
export const directionFor = (s) => s.mode === 'adventure' ? stageFor(s).direction : 1;
// 往上爬的關卡(第 5 關)畫面上下顛倒,進關時大字提醒(IR48 / G7-11)。
export const flipNotice = (s) => directionFor(s) === -1 ? '畫面倒過來了——就像把手機倒著拿！' : null;
export function goalText(s) {
  const st = stageFor(s);
  if (st.goal === 'time') return `存活 ${st.target} 秒`;
  if (st.goal === 'coins') return `收集 ${st.target} 枚金幣並活著`;
  if (st.goal === 'flag') return `抵達第 ${st.target} 層的終點旗`;
  return `${st.direction === -1 ? '這關往上爬！爬到' : '下到'}第 ${st.target} 層`;
}
export function goalProgress(s) {
  const st = stageFor(s);
  if (st.goal === 'time') return `⏱ ${Math.floor(s.time)} / ${st.target} 秒`;
  if (st.goal === 'coins') return `金幣 ${s.stageCoins} / ${st.target}`;
  return `${Math.min(s.floors, st.target)} / ${st.target} 層${st.goal === 'flag' ? ' · 找到旗子' : ''}`; // 掉過旗子不超過目標(RS39)
}
export function stageComplete(s) {
  if (s.mode !== 'adventure' || s.over || s.lives <= 0) return false;
  const st = stageFor(s);
  return st.goal === 'time' ? s.time >= st.target
    : st.goal === 'coins' ? s.stageCoins >= st.target
      : st.goal === 'flag' ? s.flagReached : s.floors >= st.target;
}

// ---- RS39 過關感:進度、最後階段、終點標示、過關演出(純函式,畫面層只讀)----

export const CLEAR_FX = Object.freeze({
  finalRatio: 0.2, // 剩下 ≤ 20% 進最後階段(進度條變色+大字提示,每關一次)
  approachRatio: 0.5, // 層數/旗子關:終點還沒進畫面時邊緣一直顯示小旗+剩餘層數;剩下 ≤ 50% 起由半透明轉為全亮
  portalSec: 10, // 存活時間關:最後 10 秒升起出口光門
  coinGlow: 3, // 收集關:差 3 枚以內,剩下的金幣加光暈+邊緣方向指示
  celebrateSec: 2, // 過關演出長度(1.5~2.5 秒)
  finalCelebrateSec: 3.5, // 6 關全過的最後演出(≤ 4 秒)
  skipAfter: 0.3, // 演出開始後這麼久才接受略過(避免還在連按方向鍵就誤略過)
});

const goalOf = (s) => (s.mode === 'adventure' ? stageFor(s) : null);
// 已達成量(層數/秒數/金幣),未取整。
function goalDone(s) {
  const st = stageFor(s);
  return st.goal === 'time' ? s.time : st.goal === 'coins' ? s.stageCoins : s.floors;
}
// 進度比例 0~1(進度條寬度);無盡模式 = null。
export function goalRatio(s) {
  const st = goalOf(s);
  if (!st) return null;
  return Math.min(1, Math.max(0, goalDone(s) / st.target));
}
// 剩下多少(整數;秒數無條件進位);無盡模式 = null。
export function goalRemaining(s) {
  const st = goalOf(s);
  if (!st) return null;
  return Math.max(0, Math.ceil(st.target - goalDone(s) - 1e-9));
}
// 最後階段:剩下 ≤ 20%(未過關、未結束)。
export function finalPhase(s) {
  const st = goalOf(s);
  if (!st || s.stageCleared || s.over) return false;
  return st.target - goalDone(s) <= st.target * CLEAR_FX.finalRatio + 1e-9;
}
export function finalText(s) {
  const st = goalOf(s);
  if (!st) return null;
  const n = goalRemaining(s);
  return st.goal === 'time' ? `最後 ${n} 秒！` : st.goal === 'coins' ? `還差 ${n} 枚！` : `最後 ${n} 層！`;
}
// 這一步剛進最後階段 ⇒ 提示字;否則 null。規則只會遞增(層數/秒數/金幣),所以每關只跳一次;
// 存檔還原時前一步已在最後階段,不會重跳。
export function finalCue(prev, next) {
  if (prev.mode !== 'adventure' || prev.stage !== next.stage) return null;
  return !finalPhase(prev) && finalPhase(next) ? finalText(next) : null;
}

// 終點標示:畫面層依此畫旗子/光門/金幣光暈。null = 本關現在不畫。
//   { kind: 'flag', n 終點層號, remaining 剩幾層, approach 是否已到「接近」(要顯示邊緣小旗)}
//   { kind: 'portal', rise 0~1 光門升起程度, remaining 剩幾秒, from 'bottom' | 'top'(畫面方向)}
//   { kind: 'coins', remaining 還差幾枚 }
export function goalMarker(s) {
  const st = goalOf(s);
  if (!st || s.over) return null;
  const remaining = goalRemaining(s);
  if (st.goal === 'floors' || st.goal === 'flag') {
    return { kind: 'flag', n: st.target, remaining, approach: remaining <= st.target * CLEAR_FX.approachRatio };
  }
  if (st.goal === 'time') {
    const left = st.target - s.time;
    if (left > CLEAR_FX.portalSec) return null;
    return { kind: 'portal', rise: Math.min(1, Math.max(0, 1 - left / CLEAR_FX.portalSec)), remaining, from: st.direction === -1 ? 'top' : 'bottom' };
  }
  return remaining <= CLEAR_FX.coinGlow && remaining > 0 ? { kind: 'coins', remaining } : null;
}

// 過關演出:剛過關時設定 celebrate(剩餘秒數)與 celebrateMax;演出不進存檔(重新整理 = 直接是過關畫面)。
export const celebrateLength = (s) => (s.won ? CLEAR_FX.finalCelebrateSec : CLEAR_FX.celebrateSec);
export const celebrating = (s) => (s.celebrate ?? 0) > 0;
export function tickCelebration(s, dt) {
  if (!celebrating(s)) return s;
  return { ...s, celebrate: Math.max(0, s.celebrate - dt) };
}
// 點畫面/按鍵略過演出;剛開始的 skipAfter 秒內不接受(連按方向鍵不會誤略過)。
export function skipCelebration(s) {
  if (!celebrating(s) || (s.celebrateMax ?? 0) - s.celebrate < CLEAR_FX.skipAfter) return s;
  return { ...s, celebrate: 0 };
}
