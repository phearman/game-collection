// 留空時不載入登入與雲端儲存模組。由 PM 設定公開的專案值。
export const SUPABASE_URL = 'https://kayidikakpyzhukwfzyd.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_phQtPglmhY51ewIsP1sgHg_-muhA0nr';
export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
