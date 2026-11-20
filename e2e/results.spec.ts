import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_NOW, DASHBOARD_PORT } from "./dashboard-fixture";

/*
 * 成績の画面と、過去データで試す(SPEC-004、SPEC-006 AC-006-12、SPEC-007 AC-007-18、ADR-0010)。
 * ダッシュボードのテストと同じ2つ目のサーバー(src/testing/seed-dashboard-db.ts で作った DB)を使う:
 * - 毎日の記録: 2026-11-02(取引の途中)。SOXL の損切りで -86.022円
 * - 過去データで試した結果: 2026-09-02 から 10-30 の41日。10-01 に SOXL の損切りで -86.022円、ほかの日は 0円
 * 手計算: 合計 -86.022 → -86円、元手 10,000円に対して -0.86%。10-01 の終わりの残高 9,913.978 → 9,914円
 */
test.use({ baseURL: `http://127.0.0.1:${DASHBOARD_PORT}` });

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date(DASHBOARD_NOW));
  await page.goto(path);
}

test.describe("成績の画面", () => {
  test("AC-004-05: 過去の結果で、これからの利益を示すものではないと上部に出す", async ({ page }) => {
    await open(page, "/results");
    await expect(page.getByText("これからの利益を示すものではありません")).toBeVisible();
  });

  test("AC-004-03: 毎日の記録で、取引の途中の日に「途中」と出し、まとめに入れない", async ({ page }) => {
    await open(page, "/results");
    const live = page.getByRole("region", { name: "毎日の自動売買の成績" });
    const row = live.getByRole("row", { name: /2026年11月2日/ });
    await expect(row).toContainText("▼ -86円");
    await expect(row).toContainText("9,914円");
    await expect(row).toContainText("途中");
  });

  test("AC-004-04、01: 毎日の記録と過去データで試した結果を、混ぜずに別の欄に出す", async ({ page }) => {
    await open(page, "/results");
    // 毎日の記録は取引の途中の日だけなので、まとめはまだ出さない(SPEC-004 2026-11-20 追記)
    const live = page.getByTestId("live-summary");
    await expect(live).toContainText("取引を締めた日がまだないので、まとめは今日の取引が終わってから出ます");
    const backtest = page.getByTestId("backtest-summary");
    await expect(backtest).toContainText("▼ -86円");
    await expect(backtest).toContainText("▼ -0.86%");
    await expect(backtest).toContainText("0日 / 1日");
    await expect(backtest).toContainText("0円の日 40日。記録した日数 41日");
    await expect(backtest).toContainText("2026年10月1日(木)");
    // 過去データで試した日は、毎日の記録の表に入らない
    await expect(page.getByTestId("live-table").getByRole("row")).toHaveCount(2);
    await expect(page.getByTestId("backtest-table").getByRole("row")).toHaveCount(42);
  });

  test("AC-004-06: 棒グラフはプラスとマイナスを色と向きで分け、同じ内容を表でも出す", async ({ page }) => {
    await open(page, "/results");
    const chart = page.getByTestId("backtest-chart");
    await expect(chart.locator("svg")).toBeVisible();
    await expect(chart.locator('path[fill="var(--color-down)"]')).toHaveCount(1);
    // 0円の線が軸に入る(1日だけの毎日の記録でも、棒が0円から下に伸びる)
    await expect(page.getByTestId("live-chart").getByText("0円", { exact: true })).toBeVisible();
    await expect(page.getByText("41日分の日ごとの損益。プラスの日(上向きの緑)が0日、マイナスの日(下向きの赤)が1日")).toBeVisible();
  });

  test("AC-004-02: 記録が0日なら「まだ記録がありません」と出す", async ({ page }) => {
    await page.route("**/api/results", (route) => route.fulfill({ json: { live: null, backtest: null } }));
    await open(page, "/results");
    await expect(page.getByText("まだ記録がありません")).toBeVisible();
    await expect(page.getByText("まだ試していません")).toBeVisible();
  });

  test("AC-004-07: 「あとから処理」の印がある日に印を出す", async ({ page }) => {
    await page.route("**/api/results", async (route) => {
      const response = await route.fetch();
      const view = (await response.json()) as { live: { rows: { late: boolean }[] } };
      view.live.rows[0].late = true;
      await route.fulfill({ response, json: view });
    });
    await open(page, "/results");
    await expect(page.getByTestId("live-table").getByRole("row", { name: /2026年11月2日/ })).toContainText("あとから処理");
  });

  test("AC-007-04: 表は枠の中で縦横に動かせ、画面は横にはみ出さない", async ({ page }) => {
    await open(page, "/results");
    await expect(page.getByTestId("backtest-table")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("過去データで試す", () => {
  test("AC-006-12: 設定の画面で試すと、試した日数と回数を出し、成績の画面へ進める", async ({ page }) => {
    await open(page, "/settings");
    const section = page.getByRole("region", { name: "過去データで試す" });
    await section.getByRole("button", { name: "過去データで試す" }).click();
    // 開発サーバーでは初めての呼び出しで API の組み立てに時間がかかるので、待つ時間を長くする
    await expect(page.getByTestId("backtest-status")).toHaveText(
      "41日分を試しました(練習売買 1回。元手 10,000円、1ドル 150.00円)",
      { timeout: 20_000 },
    );
    await section.getByRole("link", { name: "成績の画面で結果を見る" }).click();
    await expect(page).toHaveURL(/\/results/);
  });

  test("AC-007-18: 成績の画面の日付から、試したその日をダッシュボードで見る。日付を大きく出す", async ({ page }) => {
    await open(page, "/results");
    await page.getByTestId("backtest-table").getByRole("link", { name: "2026年10月1日(木)" }).click();
    await expect(page).toHaveURL(/\?backtest=2026-10-01/);
    const banner = page.getByTestId("backtest-banner");
    await expect(banner).toContainText("過去データで試した結果を見ています。今日の市場ではありません");
    await expect(banner.getByRole("heading", { name: "2026年10月1日(木)" })).toBeVisible();
    await expect(page.getByRole("group", { name: "使うデータ" }).getByRole("button", { name: "過去データで試す" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("region", { name: "SOXL は3つの条件がそろいました" })).toContainText("$78.45");
    const money = page.getByTestId("money-card");
    await expect(money).toContainText("10月1日(木)のお金の状況");
    await expect(money).toContainText("9,914円");
    // 毎日の記録の様子(自動売買のプロセス)と、毎日の記録の画面へのリンクは出さない
    await expect(page.getByTestId("worker-card")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "自動売買の記録を見る" })).toHaveCount(0);
    // AC-007-04: スマホの幅でも、日付の表示と選び欄で横にはみ出さない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("AC-007-18: 切り替えで今日の市場と過去データを行き来でき、試した日を選べる", async ({ page }) => {
    await open(page, "/");
    // 試した日の一覧は、ダッシュボードの値と一緒に届く
    await expect(page.getByTestId("worker-card")).toBeVisible();
    const group = page.getByRole("group", { name: "使うデータ" });
    await group.getByRole("button", { name: "過去データで試す" }).click();
    const banner = page.getByTestId("backtest-banner");
    // 初めは一番新しい試した日
    await expect(banner.getByRole("heading", { name: "2026年10月30日(金)" })).toBeVisible();
    await banner.getByLabel("試した日を選ぶ").selectOption("2026-10-01");
    await expect(banner.getByRole("heading", { name: "2026年10月1日(木)" })).toBeVisible();
    await group.getByRole("button", { name: "今日の市場" }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("worker-card")).toContainText("自動売買は動いています");
    await expect(page).not.toHaveURL(/backtest/);
  });
});
