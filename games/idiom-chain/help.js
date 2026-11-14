import { initState, chooseState, currentWord, answerOf, currentChoices, cardsOf, stepScore } from './logic.js?v=c687ae3e';

const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export const HELP_RULES = [
  '看目前成語的最後一個字,從 4 張卡中找出第一個字相同的那張。',
  '一局接 10 步,每步只有 1 張接得上。',
  '答錯的卡會標紅、不能再按,可以再選;答對後可查看《成語典》,再按「下一步」。',
  '每步 100 分,每錯一次扣 30 分,最低 10 分;時間另記。',
  '接完 10 步結算,列出整條接龍。',
];

// R1:授權標示沿用 G16(說明頁註明詞表來源並連到 G16 的 THUOCL 授權檔)。
export const HELP_SOURCE = '詞表沿用成語填空:THUOCL 成語(<a href="../idiom/LICENSE-THUOCL.txt" target="_blank" rel="noopener noreferrer">MIT 授權</a>)與教育部《成語典》詞目交集。';

// R9:示範盤面以 logic 固定種子實算(⛔ 手寫)。
export function demoSteps() {
  const before = initState({ seed: 'idiom-chain-help' });
  const answer = answerOf(before), end = [...currentWord(before)].at(-1);
  const wrong = currentChoices(before).find((word) => word !== answer);
  const missed = chooseState(before, wrong);
  const solved = chooseState(missed, answer);
  return [
    { before, after: missed, word: wrong, kind: 'fail', caption: `試選「${wrong}」`,
      result: `它的第一個字不是「${end}」,這張標紅,錯誤 +1,可以再選。` },
    { before: missed, after: solved, word: answer, kind: 'ok', caption: `改選「${answer}」`,
      result: `「${end}」接上了!這一步 ${stepScore(solved.errors[0])} 分。` },
  ];
}

export const renderDemo = (s) => {
  const word = [...currentWord(s)];
  return `<div class="chain-current demo">${word.map((ch, i) => `<span class="chain-char${i === word.length - 1 ? ' tail' : ''}">${esc(ch)}</span>`).join('')}</div>`
    + `<div class="chain-cards demo">${cardsOf(s).map((card) =>
      `<span class="chain-card${card.right ? ' right' : ''}${card.wrong ? ' wrong' : ''}">${esc(card.word)}</span>`).join('')}</div>`;
};
