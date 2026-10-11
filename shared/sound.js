// 全站短音效：只合成音波，不載入音檔；首次真實操作才建立音訊環境。
export const SOUNDS = Object.freeze(Object.fromEntries(Object.entries({
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
}).map(([name, [type, from, to, duration]]) => [name, Object.freeze({ type, from, to, duration })])));

const KEY = 'gc:sound';
// 可注入瀏覽器環境，測試不用真正的音訊裝置或全域 DOM。
export function createSound(env = globalThis) {
  const doc = env.document;
  let enabled = true, context = null, output = null, resuming = false;
  const buttons = new Set(), voices = new Set();
  try { enabled = env.localStorage?.getItem(KEY) !== 'false'; } catch { /* 儲存不可用時預設開 */ }
  const audible = () => enabled && doc?.visibilityState !== 'hidden';
  const silence = () => {
    for (const voice of voices) {
      try { voice.stop(); } catch { /* 已停止 */ }
    }
    voices.clear();
  };
  const label = (btn) => {
    btn.textContent = enabled ? '🔊' : '🔇';
    btn.title = enabled ? '關閉音效' : '開啟音效';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(enabled));
  };
  function setEnabled(value) {
    enabled = Boolean(value);
    try { env.localStorage?.setItem(KEY, String(enabled)); } catch { /* 仍可切換本頁狀態 */ }
    if (!enabled) silence();
    buttons.forEach(label);
  }
  function unlock(event) {
    if (!event.isTrusted || !audible()) return;
    try {
      if (!context) {
        const Audio = env.AudioContext || env.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        output = context.createGain();
        output.gain.setValueAtTime(0.055, context.currentTime);
        output.connect(context.destination);
      }
      if (context.state === 'suspended' && !resuming) {
        resuming = true;
        Promise.resolve(context.resume()).catch(() => {}).finally(() => { resuming = false; });
      }
    } catch { /* 不支援或瀏覽器拒絕時靜默 */ }
  }
  for (const name of ['pointerdown', 'keydown', 'click']) doc?.addEventListener(name, unlock, true);
  doc?.addEventListener('visibilitychange', () => { if (!audible()) silence(); });
  env.addEventListener?.('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return;
    enabled = event.key === null || event.newValue !== 'false';
    if (!enabled) silence();
    buttons.forEach(label);
  });
  function play(name) {
    const tone = Object.hasOwn(SOUNDS, name) ? SOUNDS[name] : null;
    if (!tone || !audible() || !output || context.state !== 'running' || voices.size >= 8) return;
    let oscillator, gain;
    try {
      const at = context.currentTime;
      oscillator = context.createOscillator();
      gain = context.createGain();
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.from, at);
      oscillator.frequency.exponentialRampToValueAtTime(tone.to, at + tone.duration);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, at + tone.duration);
      oscillator.connect(gain); gain.connect(output);
      oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      voices.add(oscillator);
      oscillator.start(at); oscillator.stop(at + tone.duration);
    } catch {
      voices.delete(oscillator);
      try { oscillator?.stop(); oscillator?.disconnect(); gain?.disconnect(); } catch { /* 音訊失敗不影響遊戲 */ }
    }
  }
  function bindSoundToggle(btn) {
    if (buttons.has(btn)) return;
    buttons.add(btn); label(btn);
    btn.addEventListener('click', (event) => {
      setEnabled(!enabled);
      unlock(event);
    });
  }
  return { play, bindSoundToggle, setEnabled, isEnabled: () => enabled };
}

const sound = createSound();
export const play = sound.play;
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
