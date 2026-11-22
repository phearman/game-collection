import { initQuiz, answerQuiz, currentQuestion, blankedLine, seededRng, POEM } from './logic.js?v=d8fded1c';

export const HELP_RULES = [
  '分四段:①故事 ②詞卡 ③四圖四句 ④看圖填空,上方頁籤可直接跳段,會記住上次看到哪一段。',
  '故事點畫面或「下一幕 ▶」換幕,可回上一幕;🔊 朗讀要按了才念。',
  '四圖四句:點詩句裡有框的字,看那個字的詞卡。',
  '看圖填空 8 題,一句一題,從 4 個字選出被挖掉的字;答錯標紅可再選。',
  '第一次就選對才得分,滿分 8 分;做完看答對幾題與錯題。',
];

// 示範一題(以 logic.js 實算):先選錯、再選對。
export function demoSteps() {
  const before = initQuiz(seededRng('poem-help'));
  const q = currentQuestion(before);
  const wrong = q.choices.find((ch) => ch !== q.answer);
  const missed = answerQuiz(before, wrong);
  const solved = answerQuiz(missed, q.answer);
  return [
    { before, after: missed, kind: 'fail', caption: `試選「${wrong}」`, result: '這個字標紅,這題就不算分了,但可以再選。' },
    { before: missed, after: solved, kind: 'ok', caption: `改選「${q.answer}」`, result: `答對了!句子是「${POEM.lines[q.line]}」。` },
  ];
}

export function renderDemo(s) {
  const q = currentQuestion(s);
  const solved = s.solved[s.index];
  const choices = q.choices.map((ch) => `<span class="btn${s.wrong[s.index].includes(ch) ? ' wrong' : ''}${solved && ch === q.answer ? ' right' : ''}">${ch}</span>`).join('');
  return `<div class="demo"><p class="quiz-line">${blankedLine(q, solved)}</p><div class="choices">${choices}</div></div>`;
}
