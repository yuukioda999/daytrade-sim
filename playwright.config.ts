import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const E2E_DB_PATH = ".e2e/daytrade-e2e.db";

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
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
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
    // TSLL の 2026年10月の取得は1回目だけ失敗させ、取り直し(AC-006-11)を確かめる
    env: {
      DAYTRADE_DB_PATH: E2E_DB_PATH,
      DAYTRADE_FAKE_MARKET_DATA: "1",
      DAYTRADE_FAKE_FAIL_ONCE: "TSLL|2026-10",
      DAYTRADE_FAKE_DELAY_MS: "300",
    },
    timeout: 180_000,
  },
});
