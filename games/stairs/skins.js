// 下樓梯的美術主題色票(RS19):純函式,⛔ 不碰 DOM、不改 logic.js。
// 基底色票來自 CSS 變數(draw.js readPalette);主題只覆蓋「牆/柱/平台/角色/描邊」等色,
// 其餘(愛心、刺、彈跳墊的形狀與紅綠辨識色)維持原值,形狀辨識不靠主題色。
// 關卡場景色(forest-bg 等)往主題色混合,保留各關差異又與主題一致。
const OVERRIDES = {
  storybook: {
    light: {
      ink: 'rgba(90, 58, 34, 0.9)', 'wall-top': '#f2d9a8', 'wall-bot': '#e8c88c', 'brick-a': '#f8e6bf', 'brick-b': '#f0d6a3',
      pillar: '#d9b27c', 'pillar-hi': '#f0d3a2', hat: '#ff5a4d', scarf: '#ffc83d', coat: '#3d8bff', sleeve: '#2468d6',
      wood: '#c98040', 'wood-hi': '#f0b87a', 'wood-dark': '#7a4720', text: '#3a2616',
    },
    dark: {
      ink: 'rgba(11, 7, 18, 0.92)', 'wall-top': '#2a1f3d', 'wall-bot': '#1f1730', 'brick-a': '#41325c', 'brick-b': '#382b52',
      pillar: '#2f2447', 'pillar-hi': '#54437a', hat: '#ff6a5c', scarf: '#ffcf55', coat: '#5a9bff', sleeve: '#3a78e0',
      wood: '#c98040', 'wood-hi': '#f0b87a', 'wood-dark': '#6a3c1a', text: '#fdf0dc',
    },
    mix: { light: ['#f4d9a0', 0.3], dark: ['#3a2a52', 0.35] },
  },
  neon: {
    light: {
      ink: 'rgba(23, 13, 51, 0.95)', 'wall-top': '#d9d2f2', 'wall-bot': '#cfc6ee', 'brick-a': '#e9e4fa', 'brick-b': '#ddd5f4',
      pillar: '#b9aae6', 'pillar-hi': '#d8cdf6', hat: '#ff2bd6', scarf: '#ffe600', coat: '#5b21b6', sleeve: '#3b1480', pants: '#170d33',
      wood: '#9b5cf0', 'wood-hi': '#d8b8ff', 'wood-dark': '#4c1d95', text: '#170d33',
    },
    dark: {
      ink: 'rgba(0, 0, 0, 0.95)', 'wall-top': '#0d0822', 'wall-bot': '#070415', 'brick-a': '#1b1245', 'brick-b': '#140c36',
      pillar: '#1e1450', 'pillar-hi': '#3a2a8c', glow: 'rgba(25, 230, 255, 0.35)', flame: '#19e6ff',
      hat: '#ff2bd6', scarf: '#19e6ff', coat: '#7c3aed', sleeve: '#5b21b6', pants: '#19e6ff',
      wood: '#a855f7', 'wood-hi': '#e9c9ff', 'wood-dark': '#4c1d95', text: '#f2ecff',
    },
    mix: { light: ['#cfc6ee', 0.4], dark: ['#0d0822', 0.55] },
  },
  paper: {
    light: {
      ink: 'rgba(90, 60, 110, 0.8)', 'wall-top': '#fbe9f0', 'wall-bot': '#f6dde8', 'brick-a': '#fff4f8', 'brick-b': '#fbe6ee',
      pillar: '#e8c8dc', 'pillar-hi': '#fbe6f0', hat: '#ff7aa8', scarf: '#ffd36a', coat: '#7ab8ff', sleeve: '#5a98e6', pants: '#9a8cc8', boot: '#6b5a8a',
      wood: '#f2b98a', 'wood-hi': '#ffe0c4', 'wood-dark': '#b98660', text: '#33293a',
    },
    dark: {
      ink: 'rgba(10, 6, 20, 0.85)', 'wall-top': '#2a2540', 'wall-bot': '#221d36', 'brick-a': '#3b3459', 'brick-b': '#332d4e',
      pillar: '#3a3257', 'pillar-hi': '#5a4f85', hat: '#ff8fb5', scarf: '#ffd98a', coat: '#8cc4ff', sleeve: '#6aa8f0', pants: '#b8aee0', boot: '#8a78b0',
      wood: '#e8a878', 'wood-hi': '#ffd9b8', 'wood-dark': '#8a5f40', text: '#f6eefc',
    },
    mix: { light: ['#fbe6ee', 0.4], dark: ['#2a2540', 0.4] },
  },
};
export const SKIN_IDS = Object.freeze(Object.keys(OVERRIDES));

const HEX = /^#[0-9a-f]{6}$/i;
const STAGE_PART = /^(forest|cave|ice|factory|sky|tower)-(bg|scenery|board|hi|dark)$/;
// 平台材質色:關卡底色往主題的木板色靠 60%,平台才看得出主題(辨識仍靠形狀)。
const BOARD_FROM = { board: 'wood', hi: 'wood-hi', dark: 'wood-dark' };

// 把 hex 色往目標色混合 amount(0~1);非 #rrggbb(例如 rgba)原樣返回。
export function mixHex(from, to, amount) {
  if (!HEX.test(from) || !HEX.test(to)) return from;
  const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(from, i) + (ch(to, i) - ch(from, i)) * amount).toString(16).padStart(2, '0')).join('')}`;
}

// 依主題與深淺色取得色票;classic 或未知主題原樣返回(行為與現況完全相同)。
export function skinPalette(base, skin, dark) {
  if (!Object.hasOwn(OVERRIDES, skin)) return base;
  const set = OVERRIDES[skin];
  const out = { ...base, ...set[dark ? 'dark' : 'light'] };
  const [to, amount] = set.mix[dark ? 'dark' : 'light'];
  for (const key of Object.keys(base)) {
    const part = STAGE_PART.exec(key);
    if (!part) continue;
    out[key] = Object.hasOwn(BOARD_FROM, part[2])
      ? mixHex(mixHex(base[key], to, amount), out[BOARD_FROM[part[2]]], 0.6)
      : mixHex(base[key], to, amount);
  }
  return out;
}
