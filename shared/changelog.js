export const CHANGELOG = [
  {
    date: '2026-10-06', title: '井字棋可選先後手、更新紀錄',
    items: [
      { scope: 'G4', kind: '新增', text: '可選擇先手:我先、AI 先、輪流、隨機(v1.1)' },
      { scope: '全站', kind: '新增', text: '「更新紀錄」頁與每款遊戲版本號,點遊戲頁上方的版本可看該款的更新' },
    ],
  },
  {
    date: '2026-10-06', title: '放棄的局不計最佳',
    items: [
      { scope: '全站', kind: '改善', text: '中途放棄的局不再刷新最佳分數;分數已超過最佳時按「新遊戲」會先提醒' },
    ],
  },
  {
    date: '2026-10-05', title: '穩定性修正',
    items: [
      { scope: '全站', kind: '修正', text: '紀錄存不進去時可以重試或放棄,不會卡在結算中' },
      { scope: '全站', kind: '修正', text: '第一次玩不再顯示「距最佳 0 還差 0」' },
      { scope: '全站', kind: '改善', text: '窄螢幕上方按鈕列不再折行' },
      { scope: 'G6', kind: '修正', text: '遊戲結束後暫停鈕停用(v1.1)' },
      { scope: 'G7', kind: '修正', text: '遊戲結束後暫停鈕停用(v1.1)' },
      { scope: 'G8', kind: '修正', text: '遊戲結束後暫停鈕停用(v1.1)' },
      { scope: 'G5', kind: '修正', text: '存檔檢查更嚴謹(v1.1)' },
      { scope: 'G3', kind: '修正', text: '小螢幕開提示時不用捲動(v1.2)' },
    ],
  },
  {
    date: '2026-10-04', title: 'Wordle 提示、2048 小朋友模式',
    items: [
      { scope: 'G3', kind: '新增', text: '「輔助」模式與 💡 提示——字母提示、例句提示(附中文)、候選單字(v1.1)' },
      { scope: 'G1', kind: '新增', text: '小朋友模式,顯示建議方向並可無限復原(v1.4)' },
      { scope: '全站', kind: '新增', text: '使用提示或小朋友模式的局記為「輔助局」,不刷新最佳、XP 打對折' },
    ],
  },
  {
    date: '2026-10-03', title: '說明與 XP 明細',
    items: [
      { scope: '全站', kind: '改善', text: '每款「? 玩法」示範標出成功與失敗案例' },
      { scope: '全站', kind: '新增', text: '結算畫面顯示 XP 明細,「我的紀錄」加「XP 怎麼算?」' },
      { scope: 'G1', kind: '改善', text: '說明補上分數怎麼算(v1.3)' },
    ],
  },
  {
    date: '2026-10-03', title: '新遊戲:下樓梯、足球守門員',
    items: [
      { scope: 'G7', kind: '新增', text: '下樓梯上線(v1.0)' },
      { scope: 'G8', kind: '新增', text: '足球守門員上線(v1.0)' },
      { scope: '全站', kind: '新增', text: '大廳與遊戲頁顯示遊戲編號 G1~G8' },
    ],
  },
  {
    date: '2026-10-03', title: '新遊戲:Wordle',
    items: [{ scope: 'G3', kind: '新增', text: 'Wordle 上線(v1.0)' }],
  },
  {
    date: '2026-10-03', title: '新遊戲:數獨',
    items: [{ scope: 'G5', kind: '新增', text: '數獨上線,三種難度(v1.0)' }],
  },
  {
    date: '2026-10-03', title: '新遊戲:踩地雷、2048 改善',
    items: [
      { scope: 'G2', kind: '新增', text: '踩地雷上線(v1.0)' },
      { scope: 'G1', kind: '改善', text: '無效移動會抖動提示、新遊戲先確認、手機上方按鈕不換行(v1.2)' },
      { scope: '全站', kind: '改善', text: '「我的紀錄」手機版面與文字對比' },
    ],
  },
  {
    date: '2026-10-03', title: '新遊戲:貪食蛇、井字棋',
    items: [
      { scope: 'G6', kind: '新增', text: '貪食蛇上線(v1.0)' },
      { scope: 'G4', kind: '新增', text: '井字棋上線,可挑戰無敵 AI(v1.0)' },
    ],
  },
  {
    date: '2026-10-02', title: '我的紀錄',
    items: [
      { scope: '全站', kind: '新增', text: '「我的紀錄」頁——續玩、遊玩紀錄、XP 與成就、匯出匯入' },
      { scope: 'G1', kind: '改善', text: '接上遊玩紀錄與結算(v1.1)' },
    ],
  },
  {
    date: '2026-10-02', title: '遊戲集錦上線',
    items: [
      { scope: '全站', kind: '新增', text: '大廳上線' },
      { scope: 'G1', kind: '新增', text: '2048 上線,含玩法說明與示範(v1.0)' },
    ],
  },
];

// 不指定遊戲時顯示全部;篩選保留原本的日期與項目順序。
export function filterChangelog(entries, code) {
  if (!code) return entries;
  return entries
    .map((entry) => ({
      ...entry,
      items: entry.items.filter((item) => item.scope === code || item.scope === '全站'),
    }))
    .filter((entry) => entry.items.length > 0);
}
