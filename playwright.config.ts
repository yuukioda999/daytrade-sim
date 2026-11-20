import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const E2E_DB_PATH = ".e2e/daytrade-e2e.db";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
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
    port: PORT,
    reuseExistingServer: !process.env.CI,
    // 画面のテストは、本番の data/ とは別の DB ファイルを使う。サーバーを立ち上げる時に消して、空の DB から始める。
    // 手元で立ち上げ済みのサーバーを使い回す時は消えないので、テストは前の状態に頼らない作りにする
    env: { DAYTRADE_DB_PATH: E2E_DB_PATH },
    timeout: 180_000,
  },
});
