// 手勢方向判斷:以位移較大的軸為準,未超過門檻不算滑動。
export function classifySwipe(dx, dy, threshold = 18) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= threshold) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

// 綁在棋盤或外框,子元素上的 pointer 事件也會冒泡到這裡。
export function swipe(el, onDir, { threshold = 18 } = {}) {
  let press = null;
  const down = (e) => {
    if (e.isPrimary === false || e.button !== 0) return;
    // 新的主要指標按壓取代漏收 up/cancel/leave 後殘留的狀態。
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
    // 解除觸控的隱式 capture,讓離開棋盤能收到 pointerleave。
    if (e.target.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!press || e.pointerId !== press.id || press.fired) return;
    const dir = classifySwipe(e.clientX - press.x, e.clientY - press.y, threshold);
    if (!dir) return;
    press.fired = true;
    onDir(dir);
  };
  const reset = (e) => {
    if (press && e.pointerId === press.id) press = null;
  };
  const up = (e) => { move(e); reset(e); };
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: reset, pointerleave: reset };
  for (const [type, fn] of Object.entries(handlers)) el.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of Object.entries(handlers)) el.removeEventListener(type, fn);
    press = null;
  };
}

export function dpad(container, onDir) {
  const pad = container.ownerDocument.createElement('div');
  pad.className = 'touch-dpad';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', '方向鍵');
  for (const [dir, symbol, label] of [
    ['up', '↑', '向上'], ['left', '←', '向左'], ['right', '→', '向右'], ['down', '↓', '向下'],
  ]) {
    const button = container.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = `btn touch-dpad-key touch-dpad-${dir}`;
    button.textContent = symbol;
    button.setAttribute('aria-label', label);
    let held = false;
    button.addEventListener('pointerdown', (e) => {
      if (e.isPrimary === false || e.button !== 0 || held) return;
      held = true;
      onDir(dir);
    });
    const release = () => { held = false; };
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) button.addEventListener(type, release);
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // 避免瀏覽器按住 Enter 時重複 click。
      if (held || e.repeat) return;
      held = true;
      onDir(dir);
    });
    button.addEventListener('keyup', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      release();
    });
    // 輔助技術可直接啟用按鈕;pointer 產生的 click 不再觸發一次。
    button.addEventListener('click', (e) => { if (e.detail === 0 && !held) onDir(dir); });
    pad.append(button);
  }
  container.append(pad);
  return () => pad.remove();
}
