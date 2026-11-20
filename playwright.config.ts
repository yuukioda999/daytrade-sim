import { defineConfig, devices } from "@playwright/test";
import { DASHBOARD_NOW, DASHBOARD_PORT } from "./e2e/dashboard-fixture";

const PORT = 3100;
const E2E_DB_PATH = ".e2e/daytrade-e2e.db";
const DASHBOARD_DB_PATH = ".e2e-dashboard/dashboard.db";
const DASHBOARD_DIST = ".next-e2e-dashboard";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    // サーバーはこのパソコンからだけ開ける形(127.0.0.1)で待ち受ける(package.json の dev、start)
    baseURL: `http://127.0.0.1:${PORT}`,
    // 利用者は日本時間の Mac で使うので、ブラウザのタイムゾーンを日本に合わせる
    timezoneId: "Asia/Tokyo",
    locale: "ja-JP",
    trace: "retain-on-failure",
    // Playwright のブラウザを入れられない環境だけ、手元の Chrome を指定する
    launchOptions: process.env.PW_CHROME_PATH
      ? { executablePath: process.env.PW_CHROME_PATH }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      // 設定と市場データのテストは1つの DB を書き換えるので、デスクトップの幅のテストが終わってから動かす(T8 のレビュー 5)
      dependencies: ["desktop"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      // CI では本番と同じビルドで確かめる。手元では開発サーバーを使う
      command: process.env.CI
        ? `rm -rf .e2e && npm run build && npm run start -- --port ${PORT}`
        : `rm -rf .e2e && npm run dev -- --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      // 立ち上げ済みのサーバーは使い回さない。使い回すと、そのサーバーが本番の data/ を使っていた時に、
      // 設定のテストが本物のキーを消してしまう(T7 のレビュー)
      reuseExistingServer: false,
      // 画面のテストは、本番の data/ とは別の DB ファイルを使う。サーバーを立ち上げる時に消して、空の DB から始める
      // 市場データは通信しないテスト用の取得元を使う(SPEC-006 の確かめ方)。
      // TSLL の 2026年10月(デスクトップの幅)と9月(スマホの幅)の取得は1回目だけ失敗させ、取り直し(AC-006-11)を確かめる
      env: {
        DAYTRADE_DB_PATH: E2E_DB_PATH,
        DAYTRADE_FAKE_MARKET_DATA: "1",
        DAYTRADE_FAKE_FAIL_ONCE: "TSLL|2026-10,TSLL|2026-09",
        DAYTRADE_FAKE_DELAY_MS: "300",
      },
      timeout: 180_000,
    },
    {
      // ダッシュボードと自動売買の記録の画面のテスト用。DB を作り直し、決めた記録を入れてから立ち上げる。
      // ビルドの置き場を分けて、1つ目のサーバーと同時に動かせるようにする
      command: process.env.CI
        ? `rm -rf .e2e-dashboard && mkdir -p .e2e-dashboard && npx tsx src/testing/seed-dashboard-db.ts ${DASHBOARD_DB_PATH} && npm run build && npm run start -- --port ${DASHBOARD_PORT}`
        : `rm -rf .e2e-dashboard && mkdir -p .e2e-dashboard && npx tsx src/testing/seed-dashboard-db.ts ${DASHBOARD_DB_PATH} && npm run dev -- --port ${DASHBOARD_PORT}`,
      url: `http://127.0.0.1:${DASHBOARD_PORT}`,
      reuseExistingServer: false,
      env: {
        DAYTRADE_DB_PATH: DASHBOARD_DB_PATH,
        DAYTRADE_FAKE_MARKET_DATA: "1",
        DAYTRADE_FAKE_NOW: DASHBOARD_NOW,
        DAYTRADE_NEXT_DIST_DIR: DASHBOARD_DIST,
      },
      timeout: 180_000,
    },
  ],
});
