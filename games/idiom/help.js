import { initState, answerState, currentQuestion, cellsOf, questionScore } from './logic.js?v=32c428b';

export const HELP_RULES = [
  '一局 10 題,從 6 個候選字中選字填空。',
  '入門、一般挖 1 字;挑戰挖 2 字,依亮框由左至右填。',
  '答錯會標紅,可再選;全題答對後可查看《成語典》。有典故漫畫的成語另有「📖 看漫畫」。',
  '「典故漫畫」題組只出有漫畫的成語(挖 1 字),不足 10 題時有幾題出幾題。',
  '每題 100 分,每錯一次扣 30 分,最低 10 分;時間另記。',
  '填完 10 題即勝利,結算分數、錯誤數與時間。',
];

export function demoSteps() {
  const before = initState('easy', { seed: 'idiom-help' });
  const q = currentQuestion(before);
  const correct = [...q.word][q.blanks[0]];
  const wrong = q.choices[0].find((ch) => ch !== correct);
  const missed = answerState(before, wrong);
  const solved = answerState(missed, correct);
  return [
    { before, after: missed, letter: wrong, kind: 'fail', caption: `試選「${wrong}」`, result: '這格標紅,錯誤 +1,可以再選。' },
    { before: missed, after: solved, letter: correct, kind: 'ok', caption: `改選「${correct}」`, result: `答對了!本題 ${questionScore(solved.errors[0])} 分。` },
  ];
}

export const renderDemo = (s) => `<div class="idiom-cells demo">${cellsOf(s).map((cell) =>
  `<span class="idiom-cell${cell.active ? ' active' : ''}${cell.wrong ? ' wrong' : ''}">${cell.text}</span>`).join('')}</div>`;
