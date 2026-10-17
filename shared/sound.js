// 全站音效與背景音樂：只合成音波，不載入音檔；首次真實操作才建立音訊環境。
// 音色欄位：type 波形、from/to 起訖頻率(Hz)、duration 秒；可選 gain(0~1)與 steps(半音位移，依序跳音)。
const tone = ([type, from, to, duration, extra = {}]) => Object.freeze({ type, from, to, duration, ...extra });
const table = (entries) => Object.freeze(Object.fromEntries(Object.entries(entries).map(([name, spec]) => [name, tone(spec)])));

export const SOUNDS = table({
  tap: ['sine', 620, 420, 0.07],
  move: ['triangle', 260, 390, 0.10],
  score: ['sine', 440, 880, 0.18],
  coin: ['sine', 880, 1320, 0.16],
  hurt: ['triangle', 180, 80, 0.22],
  jump: ['triangle', 220, 660, 0.16],
  land: ['sine', 150, 65, 0.10],
  win: ['triangle', 523, 1046, 0.45],
  lose: ['triangle', 330, 110, 0.40],
  countdown: ['sine', 440, 440, 0.12],
  go: ['triangle', 660, 990, 0.25],
  crash: ['sawtooth', 120, 40, 0.24],
  save: ['sine', 350, 700, 0.20],
  goal: ['triangle', 660, 1320, 0.35],
});

// 各遊戲專屬音色(PL56)：只列與預設不同的音；遊戲頁依網址 games/{id}/ 自動套用。
export const THEMES = Object.freeze({
  '2048': table({ // 圓潤水泡聲，合併是上行三和弦
    tap: ['sine', 330, 300, 0.05, { gain: 0.6 }],
    score: ['sine', 523, 523, 0.16, { steps: [0, 4, 7] }],
  }),
  minesweeper: table({ // 機械按鍵聲；踩雷低沉
    tap: ['square', 900, 700, 0.03, { gain: 0.35 }],
    move: ['triangle', 700, 1050, 0.08],
    win: ['triangle', 523, 523, 0.40, { steps: [0, 4, 7, 12] }],
    lose: ['sawtooth', 200, 50, 0.45, { gain: 0.6 }],
  }),
  wordle: table({ // 打字機答答聲
    tap: ['square', 1400, 1200, 0.025, { gain: 0.3 }],
    win: ['sine', 659, 659, 0.45, { steps: [0, 2, 4, 7, 12] }],
    lose: ['triangle', 392, 262, 0.40],
  }),
  tictactoe: table({ // 粉筆輕敲
    tap: ['triangle', 330, 300, 0.06, { gain: 0.8 }],
    win: ['triangle', 440, 440, 0.40, { steps: [0, 5, 9, 12] }],
    lose: ['triangle', 330, 330, 0.40, { steps: [0, -3, -7] }],
  }),
  sudoku: table({ // 鉛筆輕響小鈴
    tap: ['sine', 1047, 1000, 0.06, { gain: 0.5 }],
    win: ['sine', 523, 523, 0.50, { steps: [0, 4, 7, 11, 12] }],
  }),
  memory: table({ // 翻牌唰聲，配對成功雙音
    tap: ['triangle', 600, 800, 0.06, { gain: 0.7 }],
    move: ['sine', 659, 659, 0.16, { steps: [0, 7] }],
    win: ['sine', 784, 784, 0.45, { steps: [0, 4, 7, 12] }],
  }),
  reversi: table({ // 棋子落盤喀聲
    tap: ['triangle', 220, 180, 0.07],
    score: ['sine', 330, 330, 0.15, { steps: [0, 12] }],
    win: ['triangle', 392, 392, 0.45, { steps: [0, 4, 7, 12] }],
    lose: ['triangle', 392, 392, 0.45, { steps: [0, -4, -7] }],
  }),
  stairs: table({ // 塔內冒險：方波金幣、下墜收尾
    land: ['triangle', 140, 70, 0.08],
    coin: ['square', 988, 988, 0.16, { gain: 0.75, steps: [0, 7, 12] }], // IR47:要壓得過 BGM
    hurt: ['sawtooth', 260, 90, 0.22, { gain: 0.6 }],
    win: ['square', 523, 523, 0.50, { gain: 0.7, steps: [0, 4, 7, 12, 16] }],
    lose: ['triangle', 392, 392, 0.55, { steps: [0, -2, -5, -12] }],
  }),
  bridge: table({ // 木橋伸長、清脆落點
    tap: ['sine', 300, 420, 0.08],
    score: ['sine', 784, 784, 0.18, { steps: [0, 7] }],
    lose: ['triangle', 300, 60, 0.50],
  }),
});

// 背景音樂曲庫(PL56 試點 → RS68 共用曲庫)：一格=八分音符；音名(A4、C#5)起音、- 延長上一音、. 休止。
// 各聲部格數相同、尾接頭可迴圈；每首三聲部=主旋律+低音+鼓。一首可多款遊戲共用(GAME_MUSIC)。
const bars = (...items) => items.join(' ');
const song = (title, bpm, tracks) => Object.freeze({ title, bpm, tracks });
export const SONGS = Object.freeze({
  adventure: Object.freeze({ // 冒險：小調下行動機(原下樓梯曲)
    title: '冒險', bpm: 140,
    tracks: [
      { type: 'square', gain: 0.22, notes: bars(
        'A4 . C5 A4 E4 . A4 .', 'G4 . B4 G4 D4 . G4 .', 'F4 . A4 F4 C4 . F4 .', 'E4 . G#4 B4 E5 - . .',
        'A4 C5 E5 . D5 C5 B4 .', 'G4 B4 D5 . C5 B4 A4 .', 'F4 A4 C5 . B4 A4 G#4 .', 'A4 - - . E4 . A4 .') },
      { type: 'square', gain: 0.28, notes: bars( // 方波低音：手機喇叭也聽得到泛音
        'A2 . A2 . A2 . E2 .', 'G2 . G2 . G2 . D2 .', 'F2 . F2 . F2 . C3 .', 'E2 . E2 . E2 . G#2 .',
        'A2 . A2 . A2 . E2 .', 'G2 . G2 . G2 . D2 .', 'F2 . F2 . E2 . E2 .', 'A2 . E2 . A2 . A2 .') },
      { type: 'drums', gain: 0.5, notes: bars( // 四拍鼓點，第 4、8 小節加花
        'K . H . S . H .', 'K . H K S . H .', 'K . H . S . H .', 'K . H K S S S S',
        'K . H . S . H .', 'K . H K S . H .', 'K . H . S . H .', 'K . S . K S S S') },
    ],
  }),
  zen: Object.freeze({ // 悠閒：五聲音階慢板，安靜不催促(原小人過橋曲)
    title: '悠閒', bpm: 92,
    tracks: [
      { type: 'sine', gain: 0.28, notes: bars(
        'E5 - D5 - C5 - G4 -', 'A4 - C5 - D5 - - -', 'E5 - G5 - E5 - D5 -', 'C5 - - - . . . .',
        'A4 - C5 - D5 - E5 -', 'G5 - E5 - D5 - C5 -', 'D5 - E5 - D5 - A4 -', 'C5 - - - . . . .') },
      { type: 'triangle', gain: 0.4, notes: bars(
        'C3 . G3 . C3 . G3 .', 'A2 . E3 . A2 . E3 .', 'C3 . G3 . C3 . G3 .', 'F2 . C3 . G2 . D3 .',
        'A2 . E3 . A2 . E3 .', 'C3 . G3 . C3 . G3 .', 'F2 . C3 . G2 . D3 .', 'C3 . G3 . C3 . . .') },
      { type: 'drums', gain: 0.32, notes: bars( // 輕鼓：只標拍子，不催促
        'K . . . H . . .', 'K . . . H . . .', 'K . . . H . . .', 'K . . . H . H .',
        'K . . . H . . .', 'K . . . H . . .', 'K . . . H . . .', 'K . . . H . H .') },
    ],
  }),
  bright: song('輕快', 132, [ // C 大調跳躍主題
    { type: 'triangle', gain: 0.34, notes: bars(
      'C5 . E5 G5 E5 . C5 .', 'D5 . F5 A5 F5 . D5 .', 'E5 . G5 C6 B5 . G5 .', 'A5 G5 F5 E5 D5 - . .',
      'C5 . E5 G5 E5 . C5 .', 'F5 . A5 C6 A5 . F5 .', 'G5 F5 E5 D5 B4 . D5 .', 'C5 - - . G4 . C5 .') },
    { type: 'square', gain: 0.22, notes: bars(
      'C3 . G2 . C3 . G2 .', 'D3 . A2 . D3 . A2 .', 'C3 . G2 . E3 . C3 .', 'F2 . F2 . G2 . G2 .',
      'C3 . G2 . C3 . G2 .', 'F2 . C3 . F2 . C3 .', 'G2 . D3 . G2 . B2 .', 'C3 . G2 . C3 . . .') },
    { type: 'drums', gain: 0.4, notes: bars(
      'K . H . S . H .', 'K . H . S . H .', 'K . H . S . H .', 'K . H . S . S S',
      'K . H . S . H .', 'K . H . S . H .', 'K . H . S . H .', 'K . H K S S S S') },
  ]),
  ponder: song('沉思', 84, [ // A 小調長音，給益智遊戲：慢、留白、鼓只點拍子
    { type: 'sine', gain: 0.26, notes: bars(
      'A4 - - - C5 - E5 -', 'D5 - - - C5 - A4 -', 'G4 - - - A4 - C5 -', 'B4 - - - - - . .',
      'A4 - - - E5 - D5 -', 'C5 - - - D5 - E5 -', 'G5 - E5 - D5 - B4 -', 'A4 - - - - - . .') },
    { type: 'triangle', gain: 0.36, notes: bars(
      'A2 . E3 . A2 . E3 .', 'F2 . C3 . F2 . C3 .', 'C3 . G3 . C3 . G3 .', 'E2 . B2 . E2 . B2 .',
      'A2 . E3 . A2 . E3 .', 'F2 . C3 . F2 . C3 .', 'G2 . D3 . G2 . D3 .', 'A2 . E3 . A2 . . .') },
    { type: 'drums', gain: 0.22, notes: bars(
      'K . . . H . . .', 'K . . . H . . .', 'K . . . H . . .', 'K . . . H . . .',
      'K . . . H . . .', 'K . . . H . . .', 'K . . . H . . .', 'K . . . H . H .') },
  ]),
  action: song('緊張', 150, [ // D 小調，八分音符推進的低音
    { type: 'square', gain: 0.2, notes: bars(
      'D5 . D5 F5 . D5 A5 .', 'G5 F5 E5 . C5 . E5 .', 'D5 . D5 F5 . D5 A5 .', 'C6 A5 G5 . A5 - . .',
      'Bb4 . D5 F5 . D5 Bb5 .', 'A5 G5 F5 . E5 . C5 .', 'D5 F5 A5 . G5 F5 E5 .', 'D5 - - . A4 . D5 .') },
    { type: 'square', gain: 0.2, notes: bars(
      'D2 D2 D3 D2 D2 D2 D3 D2', 'C2 C2 C3 C2 C2 C2 C3 C2', 'D2 D2 D3 D2 D2 D2 D3 D2', 'A1 A1 A2 A1 A1 A1 A2 A1',
      'Bb1 Bb1 Bb2 Bb1 Bb1 Bb1 Bb2 Bb1', 'F2 F2 F3 F2 C2 C2 C3 C2', 'D2 D2 D3 D2 A1 A1 A2 A1', 'D2 D2 D3 D2 D2 . D2 .') },
    { type: 'drums', gain: 0.5, notes: bars(
      'K . H K S . H .', 'K . H K S . H .', 'K . H K S . H .', 'K . H K S S S S',
      'K . H K S . H .', 'K . H K S . H .', 'K . H K S . H .', 'K K S K S S S S') },
  ]),
  race: song('競速', 168, [ // E 小調琶音，一路往前衝
    { type: 'square', gain: 0.17, notes: bars(
      'E5 G5 B5 G5 E5 G5 B5 G5', 'D5 F#5 A5 F#5 D5 F#5 A5 F#5', 'C5 E5 G5 E5 C5 E5 G5 E5', 'B4 D#5 F#5 D#5 B4 - . .',
      'E5 G5 B5 G5 E6 - B5 .', 'D5 F#5 A5 F#5 D6 - A5 .', 'C5 E5 G5 C6 B5 A5 G5 F#5', 'E5 - - . B4 . E5 .') },
    { type: 'square', gain: 0.2, notes: bars(
      'E2 . E2 E3 E2 . E2 E3', 'D2 . D2 D3 D2 . D2 D3', 'C2 . C2 C3 C2 . C2 C3', 'B1 . B1 B2 B1 . B1 B2',
      'E2 . E2 E3 E2 . E2 E3', 'D2 . D2 D3 D2 . D2 D3', 'C2 . C2 C3 C2 . C2 C3', 'B1 . B1 B2 E2 . E2 .') },
    { type: 'drums', gain: 0.45, notes: bars(
      'K H S H K H S H', 'K H S H K H S H', 'K H S H K H S H', 'K H S H K S S S',
      'K H S H K H S H', 'K H S H K H S H', 'K H S H K H S H', 'K H S S K S S S') },
  ]),
  warm: song('溫馨', 100, [ // F 大調搖籃曲感
    { type: 'triangle', gain: 0.32, notes: bars(
      'A4 - C5 - F5 - E5 -', 'D5 - - - C5 - . .', 'Bb4 - D5 - G5 - F5 -', 'E5 - - - C5 - . .',
      'A4 - C5 - F5 - A5 -', 'G5 - F5 - E5 - D5 -', 'C5 - D5 - E5 - G5 -', 'F5 - - - . . . .') },
    { type: 'triangle', gain: 0.4, notes: bars(
      'F2 . C3 . A2 . C3 .', 'D2 . A2 . F2 . A2 .', 'Bb1 . F2 . D2 . F2 .', 'C2 . G2 . E2 . G2 .',
      'F2 . C3 . A2 . C3 .', 'Bb1 . F2 . C2 . G2 .', 'C2 . G2 . C2 . E2 .', 'F2 . C3 . F2 . . .') },
    { type: 'drums', gain: 0.28, notes: bars(
      'K . . . S . . .', 'K . . . S . . .', 'K . . . S . . .', 'K . . . S . . .',
      'K . . . S . . .', 'K . . . S . . .', 'K . . . S . . .', 'K . . . S . S .') },
  ]),
  mystery: song('懸疑', 96, [ // E 小調半音、低音持續音
    { type: 'sine', gain: 0.32, notes: bars(
      'E5 - - - F5 - - -', 'E5 - - - . . B4 -', 'C5 - - - B4 - - -', 'A4 - - - G#4 - - -',
      'E5 - - - F5 - - -', 'G5 - - - F5 - E5 -', 'D#5 - - - F#5 - - -', 'E5 - - - - - . .') },
    { type: 'square', gain: 0.22, notes: bars(
      'E2 . B2 . E2 . B2 .', 'E2 . B2 . E2 . B2 .', 'A1 . E2 . A1 . E2 .', 'E2 . B2 . E2 . B2 .',
      'E2 . B2 . E2 . B2 .', 'C2 . G2 . C2 . G2 .', 'B1 . F#2 . B1 . F#2 .', 'E2 . B2 . E2 . . .') },
    { type: 'drums', gain: 0.35, notes: bars(
      'K . . K . . H .', 'K . . K . . H .', 'K . . K . . H .', 'K . . K . . H .',
      'K . . K . . H .', 'K . . K . . H .', 'K . . K . . H .', 'K . . K . H H H') },
  ]),
});

// 每款遊戲的預設曲(RS68)：玩家可在「? 玩法」改成別首或關閉；沒列到的新遊戲用 DEFAULT_SONG。
export const DEFAULT_SONG = 'bright';
export const GAME_MUSIC = Object.freeze({
  '2048': 'bright', minesweeper: 'mystery', wordle: 'ponder', tictactoe: 'bright', sudoku: 'ponder',
  snake: 'action', stairs: 'adventure', keeper: 'action', moto: 'race', moto2: 'race',
  memory: 'warm', reversi: 'zen', bridge: 'zen', archery: 'warm', peg: 'ponder',
});

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFrequency(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  const midi = (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

// 鼓點(IR47)：鼓聲部的格子用 K 大鼓、S 小鼓、H 腳踏鈸；全部程式合成(大鼓=正弦下滑，小鼓/鈸=雜訊)。
export const DRUMS = Object.freeze({
  K: Object.freeze({ type: 'sine', from: 150, to: 45, duration: 0.16, gain: 1 }),
  S: Object.freeze({ noise: 1200, duration: 0.14, gain: 0.55, body: 190 }),
  H: Object.freeze({ noise: 7000, duration: 0.045, gain: 0.3 }),
});

// 把字串譜轉成 { steps, notes:[{ step, length, freq }|{ step, length, hit }] }；音名錯誤時丟錯(由測試把關)。
export function parseTrack(notes) {
  const cells = notes.trim().split(/\s+/), out = [];
  cells.forEach((cell, step) => {
    if (cell === '.') return;
    if (Object.hasOwn(DRUMS, cell)) { out.push({ step, length: 1, hit: cell }); return; }
    if (cell === '-') { if (out.length && !out.at(-1).hit && out.at(-1).step + out.at(-1).length === step) out.at(-1).length++; return; }
    const freq = noteFrequency(cell);
    if (!freq) throw new Error(`未知音名 ${cell}`);
    out.push({ step, length: 1, freq });
  });
  return { steps: cells.length, notes: out };
}

// 選曲(RS68)：全站預設存 gc:bgm；各遊戲自己的選擇存 gc:bgm:{遊戲 id}，遊戲的選擇優先。
const SOUND_KEY = 'gc:sound', MUSIC_KEY = 'gc:music', GLOBAL_KEY = 'gc:bgm', CHOICE_KEY = 'gc:bgm:';
// 音量(IR47 實測校準)：單一音效峰值約 -10 dBFS；BGM 整體 RMS 比音效中位數低約 3~4 dB；總線後接限幅器防削波。
export const LEVELS = Object.freeze({ master: 0.3, music: 0.75 });
const SUSTAIN = 0.7, CUT = 0.008, MASTER = LEVELS.master, MUSIC_LEVEL = LEVELS.music, FADE_IN = 1.2, FADE_OUT = 0.4, LOOKAHEAD = 0.25, TICK_MS = 60;
// 軟限幅：|x| ≤ knee 原樣通過(平常的音效與音樂都在這區)；超過才平滑壓縮，輸出永遠 < 1 ⇒ 疊音也不削波。
// WaveShaper 只吃 ±1、超界取端點(=硬削波)⇒ 總線先縮小 range 倍送進去，曲線再放大回原音量；
// range 4(+12 dBFS)涵蓋最壞疊音：8 個滿音量音效 2.4 + 音樂 0.23。
// ⛔ 不用 Web Audio 內建的動態壓縮器節點：實測它會吃掉短音效的起音(-10 dB)又自動補增益，音量變得不可預期。
// width=門檻以上的壓縮寬度：1 ⇒ 振幅 1、1.8、2.4、2.7 → 0.75、0.93、0.98、0.99，整段都還有層次(不截平)。
export const LIMITER = Object.freeze({ knee: 0.6, width: 1, range: 4, size: 4097 });
export const softLimit = (u, { knee, width } = LIMITER) => {
  const a = Math.abs(u);
  return a <= knee ? u : Math.sign(u) * (knee + (1 - knee) * Math.tanh((a - knee) / width));
};
// 曲線第 i 點對應 WaveShaper 輸入 x∈[-1,1]，也就是實際振幅 u = x × range。
export function limiterCurve({ knee, width, range, size } = LIMITER) {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) curve[i] = softLimit(((i / (size - 1)) * 2 - 1) * range, { knee, width });
  return curve;
}
// 🔊 三段循環：全開(🎵)→ 只音效(🔊)→ 靜音(🔇)→ 全開。BGM 預設關(PM 10-14 裁)。
const NEXT = { all: 'sfx', sfx: 'off', off: 'all' };
const LABEL = {
  all: ['🎵', '音效與音樂(選曲在 ? 玩法；點一下只留音效)'],
  sfx: ['🔊', '只有音效(點一下靜音)'],
  off: ['🔇', '靜音(點一下開啟音效與音樂)'],
};
const pageGame = (env) => /\/games\/([^/]+)\//.exec(env.location?.pathname ?? '')?.[1];

// 可注入瀏覽器環境，測試不用真正的音訊裝置或全域 DOM。
export function createSound(env = globalThis) {
  const doc = env.document;
  let sfxOn = true, musicOn = false, context = null, output = null, resuming = false;
  let theme = THEMES[pageGame(env)] ?? null;
  const game = pageGame(env);
  let wanted = null, track = null; // wanted=頁面要求(true=依選曲、曲名=指定)；track=正在排程的曲子
  const buttons = new Set(), voices = new Set();
  const read = () => {
    try {
      sfxOn = env.localStorage?.getItem(SOUND_KEY) !== 'false';
      musicOn = env.localStorage?.getItem(MUSIC_KEY) === 'true';
    } catch { /* 儲存不可用時沿用目前值 */ }
  };
  read();
  const mode = () => (!sfxOn ? 'off' : musicOn ? 'all' : 'sfx');
  const audible = () => sfxOn && doc?.visibilityState !== 'hidden';
  const silence = () => {
    for (const voice of voices) {
      try { voice.stop(); } catch { /* 已停止 */ }
    }
    voices.clear();
  };
  const label = (btn) => {
    const [icon, title] = LABEL[mode()];
    btn.textContent = icon;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', String(sfxOn));
  };
  const store = (key, value) => {
    try { env.localStorage?.setItem(key, String(value)); } catch { /* 仍可切換本頁狀態 */ }
  };
  function apply() {
    if (!sfxOn) silence();
    syncMusic();
    buttons.forEach(label);
  }
  function setEnabled(value) {
    sfxOn = Boolean(value); store(SOUND_KEY, sfxOn); apply();
  }
  function setMode(next) {
    if (!Object.hasOwn(LABEL, next)) return;
    sfxOn = next !== 'off'; musicOn = next === 'all';
    store(SOUND_KEY, sfxOn); store(MUSIC_KEY, musicOn); apply();
  }
  function unlock(event) {
    if (!event.isTrusted || !audible()) return;
    try {
      if (!context) {
        const Audio = env.AudioContext || env.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        output = context.createGain();
        const limiter = context.createWaveShaper?.();
        // 有限幅器時總線先縮小 range 倍(曲線會放大回來)，整體音量仍是 MASTER
        output.gain.setValueAtTime(limiter ? MASTER / LIMITER.range : MASTER, context.currentTime);
        if (limiter) {
          limiter.curve = limiterCurve();
          output.connect(limiter); limiter.connect(context.destination);
        } else output.connect(context.destination);
      }
      if (context.state === 'suspended' && !resuming) {
        resuming = true;
        Promise.resolve(context.resume()).catch(() => {}).finally(() => { resuming = false; syncMusic(); });
      }
    } catch { /* 不支援或瀏覽器拒絕時靜默 */ }
    syncMusic();
  }
  for (const name of ['pointerdown', 'keydown', 'click']) doc?.addEventListener(name, unlock, true);
  doc?.addEventListener('visibilitychange', () => { if (!audible()) silence(); syncMusic(); });
  // 對話框開/關不一定觸發遊戲重畫 ⇒ 監看 open 屬性，開關當下就重算要不要播
  try {
    if (env.MutationObserver && doc?.documentElement) {
      new env.MutationObserver(() => syncMusic()).observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
    }
  } catch { /* 不支援時只靠遊戲重畫 */ }
  env.addEventListener?.('storage', (event) => {
    if (event.key?.startsWith(GLOBAL_KEY)) { memo.delete(event.key); syncMusic(); return; } // 別頁改了選曲：改讀本機新值
    if (event.key !== SOUND_KEY && event.key !== MUSIC_KEY && event.key !== null) return;
    if (event.key === null) { sfxOn = true; musicOn = false; memo.clear(); }
    else if (event.key === SOUND_KEY) sfxOn = event.newValue !== 'false';
    else musicOn = event.newValue === 'true';
    apply();
  });

  // 一個音：steps 存在時以同一個振盪器依序跳音，否則從 from 滑到 to。
  function voice(spec, at, out, peak = 1) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    const level = peak * (spec.gain ?? 1), end = at + spec.duration;
    oscillator.type = spec.type;
    if (spec.steps) {
      const each = spec.duration / spec.steps.length;
      spec.steps.forEach((step, i) => oscillator.frequency.setValueAtTime(spec.from * 2 ** (step / 12), at + i * each));
    } else {
      oscillator.frequency.setValueAtTime(spec.from, at);
      oscillator.frequency.exponentialRampToValueAtTime(spec.to, end);
    }
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    oscillator.connect(gain); gain.connect(out);
    oscillator.start(at); oscillator.stop(end);
    return { oscillator, gain };
  }
  // 音樂音符(IR47)：起音後維持在 SUSTAIN 直到音尾才收，長音不會一下就消失 ⇒ 旋律聽得出來。
  function note(type, freq, at, length, out, level) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    const end = at + length, peakAt = at + 0.01, settle = peakAt + Math.min(0.08, length * 0.3), fall = end - Math.min(0.06, length * 0.3);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, peakAt);
    gain.gain.linearRampToValueAtTime(level * SUSTAIN, settle);
    if (fall > settle) gain.gain.setValueAtTime(level * SUSTAIN, fall);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain); gain.connect(out);
    oscillator.start(at); oscillator.stop(end);
    return { oscillator, gain };
  }
  // 雜訊只產生一次(固定種子，每次聽起來一樣)；不支援 createBuffer 時鼓點只剩大鼓。
  let noiseBuffer = null;
  function noise() {
    if (!noiseBuffer) {
      const rate = context.sampleRate || 44100;
      noiseBuffer = context.createBuffer(1, Math.floor(rate * 0.25), rate);
      const data = noiseBuffer.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
    }
    return noiseBuffer;
  }
  function hit(name, at, out, level) {
    const drum = DRUMS[name], made = [];
    if (drum.type) made.push(voice(drum, at, out, level));
    if (drum.body) made.push(voice({ type: 'triangle', from: drum.body, to: drum.body * 0.6, duration: 0.08 }, at, out, level * drum.gain));
    if (drum.noise && context.createBuffer && context.createBufferSource) {
      const source = context.createBufferSource(), gain = context.createGain(), filter = context.createBiquadFilter?.() ?? null;
      const end = at + drum.duration;
      source.buffer = noise();
      if (filter) {
        filter.type = 'highpass'; filter.frequency.setValueAtTime(drum.noise, at);
        source.connect(filter); filter.connect(gain);
      } else source.connect(gain);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level * drum.gain, at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      gain.connect(out);
      source.start(at); source.stop(end);
      made.push({ oscillator: source, gain, filter });
    }
    return made;
  }
  function play(name) {
    const spec = theme && Object.hasOwn(theme, name) ? theme[name] : Object.hasOwn(SOUNDS, name) ? SOUNDS[name] : null;
    if (!spec || !audible() || !output || context.state !== 'running' || voices.size >= 8) return;
    let nodes;
    try {
      nodes = voice(spec, context.currentTime, output);
      const { oscillator, gain } = nodes;
      oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      voices.add(oscillator);
    } catch {
      try { nodes?.oscillator.stop(); nodes?.oscillator.disconnect(); nodes?.gain.disconnect(); } catch { /* 音訊失敗不影響遊戲 */ }
    }
  }

  // ---- 背景音樂：前瞻排程(每 60ms 排未來 0.25 秒的音)，淡入淡出 ----
  const fading = new Set(); // 已停止、正在淡出的舊曲；重新開曲前立即收掉，避免兩首疊在一起
  function release(t) {
    fading.delete(t);
    if (t.cleanup !== null) env.clearTimeout?.(t.cleanup);
    try { t.bus.disconnect(); } catch { /* 已斷開 */ }
  }
  // 立即收掉淡出中的舊曲：從當下音量用 CUT 秒短淡出到 0 再停(直接歸零會有喀聲)，結束後才斷開。
  function cut(t) {
    fading.delete(t);
    if (t.cleanup !== null) env.clearTimeout?.(t.cleanup);
    try {
      const now = context.currentTime;
      t.bus.gain.cancelScheduledValues?.(now);
      t.bus.gain.setValueAtTime(t.bus.gain.value ?? MUSIC_LEVEL, now);
      t.bus.gain.linearRampToValueAtTime(0, now + CUT);
      for (const osc of t.live) {
        try { osc.stop(now + CUT); } catch { /* 已停止 */ }
      }
    } catch { /* 停止失敗不影響遊戲 */ }
    t.cleanup = env.setTimeout?.(() => { t.cleanup = null; release(t); }, CUT * 1000 + 30) ?? null;
    if (t.cleanup === null) release(t);
  }
  function startTrack(name) {
    for (const old of [...fading]) cut(old);
    const song = SONGS[name];
    const parts = song.tracks.map((t) => ({ ...t, ...parseTrack(t.notes) }));
    const step = 30 / song.bpm, at = context.currentTime + 0.05;
    const bus = context.createGain();
    bus.gain.setValueAtTime(0, at);
    bus.gain.linearRampToValueAtTime(MUSIC_LEVEL, at + FADE_IN);
    bus.connect(output);
    track = { name, parts, step, steps: parts[0].steps, bus, next: 0, at, live: new Set(), timer: null, cleanup: null };
    tick();
  }
  function tick() {
    const t = track;
    if (!t) return;
    try {
      // 計時器被延遲(背景節流、卡頓)時，已過時的格子直接跳過，只排未來的音，⛔ 一次補排一堆
      const due = Math.ceil((context.currentTime - t.at) / t.step);
      if (due > t.next) t.next = due;
      while (t.at + t.next * t.step < context.currentTime + LOOKAHEAD) {
        const index = t.next % t.steps, when = t.at + t.next * t.step;
        for (const part of t.parts) {
          for (const n of part.notes) {
            if (n.step !== index) continue;
            const made = n.hit ? hit(n.hit, when, t.bus, part.gain) : [note(part.type, n.freq, when, n.length * t.step * 0.92, t.bus, part.gain)];
            for (const { oscillator, gain, filter } of made) {
              t.live.add(oscillator);
              oscillator.onended = () => { t.live.delete(oscillator); oscillator.disconnect(); gain.disconnect(); filter?.disconnect(); };
            }
          }
        }
        t.next++;
      }
    } catch { stopTrack(); return; }
    t.timer = env.setTimeout?.(tick, TICK_MS) ?? null;
  }
  function stopTrack() {
    const t = track;
    if (!t) return;
    track = null;
    if (t.timer !== null) env.clearTimeout?.(t.timer);
    try {
      const now = context.currentTime;
      t.bus.gain.cancelScheduledValues?.(now);
      t.bus.gain.setValueAtTime(t.bus.gain.value ?? MUSIC_LEVEL, now);
      t.bus.gain.linearRampToValueAtTime(0, now + FADE_OUT);
      for (const osc of t.live) {
        try { osc.stop(now + FADE_OUT); } catch { /* 已停止 */ }
      }
    } catch { /* 停止失敗不影響遊戲 */ }
    fading.add(t);
    t.cleanup = env.setTimeout?.(() => { t.cleanup = null; release(t); }, FADE_OUT * 1000 + 50) ?? null;
  }
  // 選曲(RS68)：每款遊戲各記一個值 'auto'(依遊戲預設)/曲名/'none'(關閉)，存在本機。
  const pick = (value) => value === 'none' || (value && Object.hasOwn(SONGS, value));
  // 選曲先記在本頁記憶體(memo)再嘗試寫入本機；寫入失敗或讀取拋錯時本頁仍照玩家的選擇播(審查 #150-1)。
  const memo = new Map(); // 鍵 → 值；null=已清除
  const readKey = (key) => {
    if (memo.has(key)) return memo.get(key);
    try { return env.localStorage?.getItem(key) ?? null; } catch { return null; } // 儲存不可用時當作沒選
  };
  const writeKey = (key, value) => {
    memo.set(key, value);
    try {
      if (value === null) env.localStorage?.removeItem(key);
      else env.localStorage?.setItem(key, value);
    } catch { /* 只有本頁記得 */ }
  };
  // 全站預設：'auto'(依遊戲預設)/曲名/'none'(關閉)
  function globalMusicChoice() {
    const value = readKey(GLOBAL_KEY);
    return pick(value) ? value : 'auto';
  }
  function setGlobalMusicChoice(value) {
    if (value !== 'auto' && !pick(value)) return;
    writeKey(GLOBAL_KEY, value);
    syncMusic();
  }
  // 各遊戲自己的選擇：'default'(沒選、跟全站預設)/曲名/'none'
  function musicChoice(id = game) {
    const value = id ? readKey(CHOICE_KEY + id) : null;
    return pick(value) ? value : 'default';
  }
  function setMusicChoice(value, id = game) {
    if (!id || (value !== 'default' && !pick(value))) return;
    writeKey(CHOICE_KEY + id, value === 'default' ? null : value);
    syncMusic();
  }
  // 這款遊戲實際要播哪首：遊戲自己的選擇 → 全站預設 → 依遊戲預設(GAME_MUSIC；新遊戲沒列到用 DEFAULT_SONG)；關閉=null。
  function songFor(id = game) {
    let choice = musicChoice(id);
    if (choice === 'default') choice = globalMusicChoice();
    if (choice === 'none') return null;
    return choice !== 'auto' ? choice : (id && GAME_MUSIC[id]) || DEFAULT_SONG;
  }
  // 任何對話框(玩法說明、放棄確認、意見回饋…)開著就不算遊玩中(審查 #150-2)
  const modalOpen = () => { try { return !!doc?.querySelector?.('dialog[open]'); } catch { return false; } };
  function syncMusic() {
    const name = wanted === true ? songFor() : wanted;
    const want = name && musicOn && audible() && !modalOpen() && output && context.state === 'running' ? name : null;
    if (track && track.name !== want) stopTrack();
    if (want && !track) {
      try { startTrack(want); } catch { track = null; }
    }
  }
  // 頁面告訴音效模組「現在該不該有背景音樂」；重複呼叫無副作用。
  // true=依本遊戲選曲(預設曲/指定曲/關閉)；字串=指定曲庫曲名(試聽、測試用)。
  function music(on) {
    wanted = on === true ? (game ? true : null) : on && Object.hasOwn(SONGS, on) ? on : null;
    syncMusic();
  }

  function bindSoundToggle(btn) {
    if (buttons.has(btn)) return;
    buttons.add(btn); label(btn);
    btn.addEventListener('click', (event) => {
      setMode(NEXT[mode()]);
      unlock(event);
    });
  }
  return {
    play, music, bindSoundToggle, setEnabled, setMode, mode, musicChoice, setMusicChoice, globalMusicChoice, setGlobalMusicChoice, songFor,
    setTheme: (id) => { theme = Object.hasOwn(THEMES, id) ? THEMES[id] : null; },
    isEnabled: () => sfxOn, isMusicPlaying: () => !!track,
  };
}

const sound = createSound();
export const play = sound.play;
export const music = sound.music;
export const bindSoundToggle = sound.bindSoundToggle;
export const musicChoice = sound.musicChoice;
export const setMusicChoice = sound.setMusicChoice;
export const songFor = sound.songFor;
export const globalMusicChoice = sound.globalMusicChoice;
export const setGlobalMusicChoice = sound.setGlobalMusicChoice;

// 所有頁面已有深淺色鈕；共用入口把音效鈕放在它旁邊。
export function mountSoundToggle(themeButton) {
  const doc = themeButton.ownerDocument;
  let button = doc.getElementById('sound');
  if (!button) {
    const group = doc.createElement('span');
    group.className = 'topbar-toggles';
    button = doc.createElement('button');
    button.id = 'sound'; button.type = 'button'; button.className = 'btn';
    themeButton.before(group);
    group.append(button, themeButton);
  }
  bindSoundToggle(button);
}
