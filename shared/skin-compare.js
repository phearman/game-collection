// 大廳「主題樣板比較」區塊(RS19 第一期):列出各主題,一鍵切換;選定後隨 SKIN_COMPARE_PHASE 收起。
import { SKINS, SKIN_EVENT, SKIN_COMPARE_PHASE, currentSkin, setSkin } from './skin.js?v=678a533';

const box = document.getElementById('skin-compare');
const list = document.getElementById('skin-compare-list');
if (box && list) {
  const picks = SKINS.map((skin) => {
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'skin-pick'; pick.dataset.skin = skin.id;
    const name = document.createElement('strong'); name.textContent = skin.label;
    const note = document.createElement('span'); note.textContent = skin.note;
    pick.append(name, note);
    pick.addEventListener('click', () => setSkin(skin.id));
    list.append(pick);
    return pick;
  });
  const sync = () => {
    picks.forEach((pick) => pick.setAttribute('aria-pressed', String(pick.dataset.skin === currentSkin())));
    box.hidden = !(SKIN_COMPARE_PHASE || currentSkin() !== 'classic');
  };
  document.addEventListener(SKIN_EVENT, sync);
  sync();
}
