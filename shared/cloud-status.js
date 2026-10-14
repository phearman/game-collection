// 本頁的雲端狀態(IR30):已登入但帳號服務暫時連不上、本頁改用這台裝置的紀錄時標記;
// 結算(shared/settle.js)據此提示「這局沒有上傳到雲端」。只在本頁記憶體,重新整理後重新判斷。
let offline = false;
export const markCloudOffline = () => { offline = true; };
export const isCloudOffline = () => offline;
export const resetCloudStatus = () => { offline = false; }; // 測試用
export const OFFLINE_FINISH_TEXT = '這局沒有上傳到雲端:暫時連不上帳號服務,紀錄只存在這台裝置';
