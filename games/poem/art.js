// G18 分鏡畫面(R9):全部 SVG 程式繪製,⛔ 外部圖檔。顏色走 CSS 變數(style.css 依深淺色主題定義)。
// 每幕回傳一段 <svg> 字串;動畫用 class(.drift 雲飄、.walk 走動、.bob 晃動),prefers-reduced-motion 時 style.css 關掉只留淡入。

const VIEW = '0 0 320 200';
const stroke = 'stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"';

const sky = (dusk = false) => `<rect width="320" height="200" fill="var(${dusk ? '--sky-dusk' : '--sky'})"/>`;
const sun = (x, y, dusk = false) => `<circle cx="${x}" cy="${y}" r="16" fill="var(${dusk ? '--sun-dusk' : '--sun'})"/>`;
const cloud = (x, y, s = 1) => `<g class="drift" transform="translate(${x} ${y}) scale(${s})"><path d="M0 14 q0-12 14-12 q6-10 18-4 q12-2 14 10 q8 2 6 10 h-50 q-4-2-2-4z" fill="var(--cloud)" ${stroke}/></g>`;
const ground = (y = 150, color = '--grass') => `<rect y="${y}" width="320" height="${200 - y}" fill="var(${color})"/>`;
const tree = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-4" y="0" width="8" height="18" fill="var(--wood)" ${stroke}/><circle cx="0" cy="-8" r="16" fill="var(--leaf)" ${stroke}/></g>`;
const house = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-26" y="-22" width="52" height="34" fill="var(--wall)" ${stroke}/><path d="M-34-20 L0-46 L34-20z" fill="var(--roof)" ${stroke}/><rect x="-7" y="-6" width="14" height="18" fill="var(--wood)" ${stroke}/></g>`;

// Q 版人物:大頭、圓身。kind=grandpa(白髮鬍子)/chen(戴帽)/kid(小禾,綁兩個小髮髻)。
function person(x, y, kind, { s = 1, cls = '', arm = 'down', cup = false } = {}) {
  const hair = kind === 'kid'
    ? `<circle cx="-12" cy="-40" r="6" fill="var(--hair)" ${stroke}/><circle cx="12" cy="-40" r="6" fill="var(--hair)" ${stroke}/>`
    : kind === 'chen' ? `<path d="M-17-38 q17-16 34 0z" fill="var(--hat)" ${stroke}/>` : `<path d="M-15-36 q15-12 30 0" fill="none" stroke="var(--white-hair)" stroke-width="5"/>`;
  const beard = kind === 'kid' ? '' : `<path d="M-7-18 q7 10 14 0" fill="var(--white-hair)" ${stroke}/>`;
  const body = kind === 'kid' ? '--shirt-kid' : kind === 'chen' ? '--shirt-chen' : '--shirt-grandpa';
  const armPath = arm === 'up' ? 'M10-4 l12-14' : 'M10-4 l8 12';
  const cupShape = cup ? `<rect x="18" y="-26" width="8" height="10" fill="var(--cup)" ${stroke}/>` : '';
  return `<g class="${cls}" transform="translate(${x} ${y}) scale(${s})">
    <path d="M-14 0 q14-22 28 0 v14 h-28z" fill="var(${body})" ${stroke}/>
    <path d="${armPath}" fill="none" ${stroke}/>${cupShape}
    <circle cx="0" cy="-26" r="16" fill="var(--skin)" ${stroke}/>${hair}
    <circle cx="-5" cy="-27" r="1.8" fill="var(--ink)"/><circle cx="5" cy="-27" r="1.8" fill="var(--ink)"/>
    <path d="M-4-20 q4 3 8 0" fill="none" stroke="var(--ink)" stroke-width="1.8"/>${beard}
  </g>`;
}

const ART = {
  cover: () => `${sky()}${cloud(30, 30)}${cloud(220, 18, 0.8)}${ground(160)}
    <g class="bob" transform="translate(160 96)"><line x1="0" y1="-74" x2="0" y2="-52" ${stroke}/>
    <ellipse cx="0" cy="-16" rx="40" ry="38" fill="var(--lantern)" ${stroke}/>
    <rect x="-16" y="-56" width="32" height="8" fill="var(--lantern-cap)" ${stroke}/><rect x="-16" y="16" width="32" height="8" fill="var(--lantern-cap)" ${stroke}/>
    <path d="M-6 26 v18 M0 26 v22 M6 26 v18" ${stroke}/>
    <text x="0" y="-8" text-anchor="middle" font-size="22" font-weight="700" fill="var(--lantern-text)">詩</text></g>`,
  letter: () => `${sky()}${sun(280, 34)}${ground(150, '--floor')}${person(70, 140, 'grandpa', { s: 1.3 })}
    <g class="fade-in-late" transform="translate(190 100)"><rect x="-56" y="-48" width="112" height="84" fill="var(--paper)" ${stroke}/>
    <g transform="translate(-24 -6)"><ellipse cx="0" cy="6" rx="16" ry="12" fill="var(--hen)" ${stroke}/><circle cx="12" cy="-8" r="7" fill="var(--hen)" ${stroke}/><path d="M17-10 l6 2 -6 2" fill="var(--sun)" ${stroke}/><path d="M10-16 q2-6 6-2" fill="none" stroke="var(--comb)" stroke-width="3"/></g>
    <g transform="translate(28 4)"><path d="M-18-4 h36 q-2 18-18 18 q-16 0-18-18z" fill="var(--bowl)" ${stroke}/><ellipse cx="0" cy="-5" rx="17" ry="6" fill="var(--millet)" ${stroke}/></g></g>`,
  path: () => `${sky()}${sun(40, 36)}${cloud(150, 24, 0.7)}${ground(140)}
    <path d="M0 200 C80 170 140 160 260 142" fill="none" stroke="var(--path)" stroke-width="22" stroke-linecap="round"/>
    ${house(268, 132, 0.8)}${tree(220, 124, 0.7)}
    <g class="walk">${person(70, 166, 'grandpa', { s: 0.9 })}${person(104, 170, 'kid', { s: 0.75, arm: 'up' })}</g>`,
  village: () => `${sky()}${cloud(240, 26, 0.7)}${ground(70)}
    ${[[60, 70], [100, 54], [150, 48], [200, 52], [250, 66], [270, 110], [255, 156], [200, 176], [150, 182], [100, 176], [55, 156], [44, 112]]
    .map(([x, y]) => tree(x, y, 0.75)).join('')}
    ${house(130, 120, 0.7)}${house(185, 110, 0.6)}${house(170, 150, 0.6)}`,
  hills: () => `${sky()}${sun(70, 40)}${cloud(200, 30, 0.8)}
    <path class="rise" d="M100 150 L250 50 Q290 90 340 150z" fill="var(--hill-far)" ${stroke}/><path class="rise" d="M-10 150 L50 62 L220 150z" fill="var(--hill)" ${stroke}/>
    ${ground(150)}<g><rect x="0" y="132" width="320" height="22" fill="var(--wall-city)" ${stroke}/>
    ${[...Array(16).keys()].map((i) => `<rect x="${i * 20 + 4}" y="124" width="12" height="9" fill="var(--wall-city)" ${stroke}/>`).join('')}</g>`,
  window: () => `<rect width="320" height="200" fill="var(--wall)"/>
    <g><rect x="110" y="30" width="190" height="130" fill="var(--sky)" ${stroke}/><rect x="110" y="110" width="190" height="50" fill="var(--grass)"/>
    <rect x="130" y="112" width="70" height="34" fill="var(--yard)" ${stroke}/>
    ${[0, 1, 2, 3].map((i) => `<path d="M${215 + i * 18} 146 v-14 m-6 6 q6-8 12 0" fill="none" stroke="var(--leaf)" stroke-width="3"/>`).join('')}
    <rect x="110" y="0" width="190" height="30" fill="var(--wall)"/><rect x="110" y="160" width="190" height="40" fill="var(--wall)"/><rect x="300" y="0" width="20" height="200" fill="var(--wall)"/>
    <rect x="110" y="30" width="190" height="130" fill="none" ${stroke}/>
    <path class="swing" d="M110 30 l-30 12 v106 l30 12z" fill="var(--wood)" ${stroke}/></g>
    ${person(60, 180, 'chen', { s: 1.2, arm: 'up' })}`,
  toast: () => `<rect width="320" height="200" fill="var(--wall)"/>${ground(150, '--floor')}
    <rect x="96" y="118" width="128" height="14" fill="var(--wood)" ${stroke}/><path d="M110 132 v40 M210 132 v40" ${stroke}/>
    <path d="M124 116 h28 q-2 10-14 10 q-12 0-14-10z" fill="var(--bowl)" ${stroke}/><ellipse cx="138" cy="114" rx="13" ry="4" fill="var(--millet)" ${stroke}/>
    <ellipse cx="186" cy="112" rx="16" ry="8" fill="var(--hen)" ${stroke}/>
    <g class="bob">${person(70, 150, 'grandpa', { s: 1.05, arm: 'up', cup: true })}</g>
    <g class="bob">${person(250, 150, 'chen', { s: 1.05, arm: 'up', cup: true })}</g>
    ${person(160, 186, 'kid', { s: 0.7 })}`,
  farewell: () => `${sky(true)}${sun(270, 120, true)}${cloud(40, 30, 0.7)}${ground(150)}${house(250, 150, 1)}
    ${[0, 1, 2].map((i) => `<g transform="translate(${196 + i * 16} 150)"><path d="M0 0 v-14" stroke="var(--leaf)" stroke-width="3"/><circle cx="0" cy="-18" r="5" fill="var(--bud)" ${stroke}/></g>`).join('')}
    ${person(96, 150, 'grandpa', { s: 1.05, arm: 'up' })}${person(150, 150, 'chen', { s: 1.05, arm: 'up' })}
    <circle class="bob" cx="123" cy="114" r="4" fill="var(--sun-dusk)"/>${person(50, 170, 'kid', { s: 0.7 })}`,
};

export const ART_KEYS = Object.freeze(Object.keys(ART));

/** label 給螢幕閱讀器(aria-label);畫面本身不含文字(封面燈籠上的「詩」除外)。 */
export function sceneSvg(key, label) {
  const draw = ART[key];
  if (!draw) throw new Error(`未知畫面 ${key}`);
  const safe = String(label).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<svg class="scene-art" viewBox="${VIEW}" role="img" aria-label="${safe}" preserveAspectRatio="xMidYMid meet">${draw()}</svg>`;
}
