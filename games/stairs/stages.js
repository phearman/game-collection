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
  return `${s.floors} / ${st.target} 層${st.goal === 'flag' ? ' · 找到旗子' : ''}`;
}
export function stageComplete(s) {
  if (s.mode !== 'adventure' || s.over || s.lives <= 0) return false;
  const st = stageFor(s);
  return st.goal === 'time' ? s.time >= st.target
    : st.goal === 'coins' ? s.stageCoins >= st.target
      : st.goal === 'flag' ? s.flagReached : s.floors >= st.target;
}
