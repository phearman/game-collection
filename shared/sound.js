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
    coin: ['square', 988, 988, 0.16, { gain: 0.45, steps: [0, 7, 12] }],
    hurt: ['sawtooth', 260, 90, 0.22, { gain: 0.55 }],
    win: ['square', 523, 523, 0.50, { gain: 0.45, steps: [0, 4, 7, 12, 16] }],
    lose: ['triangle', 392, 392, 0.55, { steps: [0, -2, -5, -12] }],
  }),
  bridge: table({ // 木橋伸長、清脆落點
    tap: ['sine', 300, 420, 0.08],
    score: ['sine', 784, 784, 0.18, { steps: [0, 7] }],
    lose: ['triangle', 300, 60, 0.50],
  }),
});

// 背景音樂(PL56 試點)：一格=八分音符；音名(A4、C#5)起音、- 延長上一音、. 休止。各聲部格數相同、尾接頭可迴圈。
const bars = (...items) => items.join(' ');
export const SONGS = Object.freeze({
  stairs: Object.freeze({ // 小調下行動機，配合一路往下的塔內冒險
    bpm: 140,
    tracks: [
      { type: 'square', gain: 0.22, notes: bars(
        'A4 . C5 A4 E4 . A4 .', 'G4 . B4 G4 D4 . G4 .', 'F4 . A4 F4 C4 . F4 .', 'E4 . G#4 B4 E5 - . .',
        'A4 C5 E5 . D5 C5 B4 .', 'G4 B4 D5 . C5 B4 A4 .', 'F4 A4 C5 . B4 A4 G#4 .', 'A4 - - . E4 . A4 .') },
      { type: 'triangle', gain: 0.5, notes: bars(
        'A2 . A2 . A2 . E2 .', 'G2 . G2 . G2 . D2 .', 'F2 . F2 . F2 . C3 .', 'E2 . E2 . E2 . G#2 .',
        'A2 . A2 . A2 . E2 .', 'G2 . G2 . G2 . D2 .', 'F2 . F2 . E2 . E2 .', 'A2 . E2 . A2 . A2 .') },
    ],
  }),
  bridge: Object.freeze({ // 五聲音階慢板，安靜不催促
    bpm: 92,
    tracks: [
      { type: 'sine', gain: 0.32, notes: bars(
        'E5 - D5 - C5 - G4 -', 'A4 - C5 - D5 - - -', 'E5 - G5 - E5 - D5 -', 'C5 - - - . . . .',
        'A4 - C5 - D5 - E5 -', 'G5 - E5 - D5 - C5 -', 'D5 - E5 - D5 - A4 -', 'C5 - - - . . . .') },
      { type: 'triangle', gain: 0.4, notes: bars(
        'C3 . G3 . C3 . G3 .', 'A2 . E3 . A2 . E3 .', 'C3 . G3 . C3 . G3 .', 'F2 . C3 . G2 . D3 .',
        'A2 . E3 . A2 . E3 .', 'C3 . G3 . C3 . G3 .', 'F2 . C3 . G2 . D3 .', 'C3 . G3 . C3 . . .') },
    ],
  }),
});

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFrequency(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  const midi = (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

// 把字串譜轉成 { steps, notes:[{ step, length, freq }] }；音名錯誤時丟錯(由測試把關)。
export function parseTrack(notes) {
  const cells = notes.trim().split(/\s+/), out = [];
  cells.forEach((cell, step) => {
    if (cell === '.') return;
    if (cell === '-') { if (out.length && out.at(-1).step + out.at(-1).length === step) out.at(-1).length++; return; }
    const freq = noteFrequency(cell);
    if (!freq) throw new Error(`未知音名 ${cell}`);
    out.push({ step, length: 1, freq });
  });
  return { steps: cells.length, notes: out };
}

const SOUND_KEY = 'gc:sound', MUSIC_KEY = 'gc:music';
const MASTER = 0.055, MUSIC_LEVEL = 0.45, FADE_IN = 1.2, FADE_OUT = 0.4, LOOKAHEAD = 0.25, TICK_MS = 60;
// 🔊 三段循環：全開(🎵)→ 只音效(🔊)→ 靜音(🔇)→ 全開。BGM 預設關(PM 10-14 裁)。
const NEXT = { all: 'sfx', sfx: 'off', off: 'all' };
const LABEL = {
  all: ['🎵', '音效與音樂(點一下只留音效)'],
  sfx: ['🔊', '只有音效(點一下靜音)'],
  off: ['🔇', '靜音(點一下開啟音效與音樂)'],
};
const pageGame = (env) => /\/games\/([^/]+)\//.exec(env.location?.pathname ?? '')?.[1];

// 可注入瀏覽器環境，測試不用真正的音訊裝置或全域 DOM。
export function createSound(env = globalThis) {
  const doc = env.document;
  let sfxOn = true, musicOn = false, context = null, output = null, resuming = false;
  let theme = THEMES[pageGame(env)] ?? null;
  let wanted = null, track = null; // wanted=頁面要播的曲名；track=正在排程的曲子
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
        output.gain.setValueAtTime(MASTER, context.currentTime);
        output.connect(context.destination);
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
  env.addEventListener?.('storage', (event) => {
    if (event.key !== SOUND_KEY && event.key !== MUSIC_KEY && event.key !== null) return;
    if (event.key === null) { sfxOn = true; musicOn = false; }
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
  function cut(t) {
    try {
      const now = context.currentTime;
      t.bus.gain.cancelScheduledValues?.(now);
      t.bus.gain.setValueAtTime(0, now);
      for (const osc of t.live) {
        try { osc.stop(now); } catch { /* 已停止 */ }
      }
    } catch { /* 停止失敗不影響遊戲 */ }
    release(t);
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
            const spec = { type: part.type, from: n.freq, duration: n.length * t.step * 0.9, steps: [0] };
            const { oscillator, gain } = voice(spec, when, t.bus, part.gain);
            t.live.add(oscillator);
            oscillator.onended = () => { t.live.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
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
  function syncMusic() {
    const want = wanted && musicOn && audible() && output && context.state === 'running' ? wanted : null;
    if (track && track.name !== want) stopTrack();
    if (want && !track) {
      try { startTrack(want); } catch { track = null; }
    }
  }
  // 頁面告訴音效模組「現在該不該有背景音樂」；重複呼叫無副作用。true=本頁遊戲的曲目。
  function music(on) {
    const name = on === true ? pageGame(env) : on || null;
    wanted = name && Object.hasOwn(SONGS, name) ? name : null;
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
    play, music, bindSoundToggle, setEnabled, setMode, mode,
    setTheme: (id) => { theme = Object.hasOwn(THEMES, id) ? THEMES[id] : null; },
    isEnabled: () => sfxOn, isMusicPlaying: () => !!track,
  };
}

const sound = createSound();
export const play = sound.play;
export const music = sound.music;
export const bindSoundToggle = sound.bindSoundToggle;

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
