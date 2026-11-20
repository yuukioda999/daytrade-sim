/** ダッシュボードのテスト用のサーバー(playwright.config.ts の2つ目)。決めた記録を入れた DB と、止まった時計で動かす(SPEC-007 の確かめ方) */
export const DASHBOARD_PORT = 3101;
/** 2026-11-02(月)10:17:30(米国東部、冬時間)。src/testing/seed-dashboard-db.ts が 10:17 まで記録を作る */
export const DASHBOARD_NOW = "2026-11-02T15:17:30Z";
