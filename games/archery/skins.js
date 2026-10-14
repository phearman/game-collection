// 弓箭射擊的美術主題色票(比照下樓梯 RS19):純函式,⛔ 不碰 DOM、不改 logic.js。
// 基底色票來自 CSS 變數(draw.js readPalette);主題只覆蓋天空、地面、角色與木頭色,靶環配色維持原值(辨識不靠主題色)。
const OVERRIDES = {
  storybook: {
    light: { 'sky-a': '#f6dca8', 'sky-b': '#fbefd2', hill: '#d9b27c', ground: '#c98f4a', 'ground-dark': '#8a5a2b', wood: '#c98040', 'wood-dark': '#7a4720', hat: '#ff5a4d', coat: '#3d8bff', text: '#3a2616' },
    dark: { 'sky-a': '#1f1730', 'sky-b': '#382b52', hill: '#2f2447', ground: '#5a3f2a', 'ground-dark': '#3a2716', wood: '#c98040', 'wood-dark': '#6a3c1a', hat: '#ff6a5c', coat: '#5a9bff', text: '#fdf0dc' },
  },
  neon: {
    light: { 'sky-a': '#d9d2f2', 'sky-b': '#f2eefc', hill: '#b9aae6', ground: '#9b5cf0', 'ground-dark': '#4c1d95', wood: '#9b5cf0', 'wood-dark': '#4c1d95', hat: '#ff2bd6', coat: '#5b21b6', text: '#170d33' },
    dark: { 'sky-a': '#070415', 'sky-b': '#1b1245', hill: '#1e1450', ground: '#3a2a8c', 'ground-dark': '#19e6ff', wood: '#a855f7', 'wood-dark': '#4c1d95', hat: '#ff2bd6', coat: '#7c3aed', text: '#f2ecff' },
  },
  paper: {
    light: { 'sky-a': '#fbe9f0', 'sky-b': '#fff6fa', hill: '#e8c8dc', ground: '#b8d8a8', 'ground-dark': '#88a878', wood: '#f2b98a', 'wood-dark': '#b98660', hat: '#ff7aa8', coat: '#7ab8ff', text: '#33293a' },
    dark: { 'sky-a': '#221d36', 'sky-b': '#3b3459', hill: '#3a3257', ground: '#4a5a48', 'ground-dark': '#2e3a2c', wood: '#e8a878', 'wood-dark': '#8a5f40', hat: '#ff8fb5', coat: '#8cc4ff', text: '#f6eefc' },
  },
};
export const SKIN_IDS = Object.freeze(Object.keys(OVERRIDES));

// 依主題與深淺色取得色票;classic 或未知主題原樣返回。
export function skinPalette(base, skin, dark) {
  if (!Object.hasOwn(OVERRIDES, skin)) return base;
  return { ...base, ...OVERRIDES[skin][dark ? 'dark' : 'light'] };
}
