import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_NOW, DASHBOARD_PORT } from "./dashboard-fixture";

/*
 * ダッシュボードと自動売買の記録の画面(SPEC-007)。
 * 2つ目のサーバーが、src/testing/seed-dashboard-db.ts で作った DB と、止まった時計(2026-11-02 10:17:30 米国東部)で動く:
 * - SOXL: 09:50 に $78.45 で 0.4248株を練習買いし、09:55 に $77.10 で損切り(損益 -86.022円)
 * - TQQQ: 09:50 に $78.45 で 0.4248株を練習買いし、持っている(今 $79.20、未確定 +47.79円)
 * 手計算: 残高 10,000 - 86.022 = 9,913.978 → 9,914円。損失の上限 1,000円の 8.6% → 切り捨てて 8% 使用
 */
test.use({ baseURL: `http://127.0.0.1:${DASHBOARD_PORT}` });

async function open(page: Page, path: string) {
  // ヘッダーの市場の状態もブラウザの時計で決まるので、サーバーと同じ時刻に止める
  await page.clock.setFixedTime(new Date(DASHBOARD_NOW));
  await page.goto(path);
}

/** 本物の API の値の一部を変えて返す(記録の DB にない状態の画面を確かめる) */
async function patchDashboard(page: Page, patch: (view: Record<string, unknown>) => void) {
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const view = (await response.json()) as Record<string, unknown>;
    patch(view);
    await route.fulfill({ response, json: view });
  });
}

test.describe("ダッシュボード", () => {
  test("AC-007-08: 「15分遅れ」と、最後にデータを受け取った時刻を出す", async ({ page }) => {
    await open(page, "/");
    const worker = page.getByTestId("worker-card");
    await expect(worker).toContainText("自動売買は動いています");
    await expect(worker).toContainText("データは15分遅れです。最後にデータを受け取った時刻: 米国東部 11/2 10:15");
    await expect(worker).toContainText("今日の買い 2回 / 売り 1回");
  });

  test("AC-007-11、06、07、AC-002-07: 4銘柄の価格、前日の終値からの変化(▲▼と符号)、3条件、状態を出す", async ({ page }) => {
    await open(page, "/");
    const tqqq = page.getByTestId("watch-TQQQ");
    await expect(tqqq).toContainText("買いサイン・保有中");
    await expect(tqqq).toContainText("$79.20");
    // 手計算: 79.20 / 70.00 - 1 = 13.14%
    await expect(tqqq).toContainText("▲ +13.14%");
    // AC-002-07: 朝の高値までの残りの値幅と、取引量の倍率
    await expect(tqqq).toContainText("朝の高値超え(ORB) 朝の高値 $77.90(超えています)");
    await expect(tqqq).toContainText("取引量の増加(出来高急増) 1.5倍以上で達成。今 1.83倍");
    // 手計算: 77.90 - 77.20 = 0.70
    await expect(page.getByTestId("watch-SOXL")).toContainText("朝の高値 $77.90 まで あと $0.70");
    await expect(page.getByTestId("watch-SOXL")).toContainText("売り終わり");
    await expect(page.getByTestId("watch-SOXL")).toContainText("▲ +10.29%");
    for (const symbol of ["TSLL", "NVDL"]) {
      await expect(page.getByTestId(`watch-${symbol}`)).toContainText("今日の値動きはまだ届いていません");
      await expect(page.getByTestId(`watch-${symbol}`)).toContainText("条件 0/3 達成");
    }
    await expect(tqqq).toHaveAttribute("aria-pressed", "true");
  });

  test("AC-007-12、13、14: 価格チャートと帰属表示を出し、要点を文字でも出す。銘柄を選ぶと切り替わる", async ({ page }) => {
    await open(page, "/");
    const chart = page.getByTestId("price-chart");
    await expect(chart.locator("canvas").first()).toBeVisible();
    // lightweight-charts の帰属表示(attributionLogo)
    await expect(chart.locator('a[href^="https://www.tradingview.com"]')).toHaveCount(1);
    // 手計算: 今日の平均価格 = Σ(足の平均価格 × 取引量) / Σ取引量。足の平均価格がない 09:50、09:55 は (高値 + 安値 + 終値) / 3
    // (77.40×100 + 77.65×70 + 77.60×55 + 77.90×120 + 78.4333×100 + 78.9667×110) / 555 = 78.056 → $78.06
    await expect(page.getByTestId("chart-summary")).toHaveText(
      "TQQQ: 朝の高値は $77.90、今日の平均価格は $78.06。米国東部 09:45 に朝の高値を超えました。",
    );
    await page.getByTestId("watch-SOXL").click();
    await expect(page.getByTestId("watch-SOXL")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("chart-summary")).toContainText("SOXL: 朝の高値は $77.90");
  });

  test("AC-007-15: 練習で買った価格、株数、損切りの価格を出し、実際の注文は出していないと添える", async ({ page }) => {
    await open(page, "/");
    const buy = page.getByRole("region", { name: "TQQQ は3つの条件がそろいました" });
    await expect(buy).toContainText("$78.45");
    await expect(buy).toContainText("$77.10");
    // 手計算: 78.45 × 0.4248 × 150 = 4,998.834 → 4,999円
    await expect(buy).toContainText("買った量(4,999円分)0.4248株");
    await expect(buy).toContainText("実際の注文は出していません");
  });

  test("AC-007-16: 残高、今日の損益、持っている株の損益、損失の上限の使用割合と、今持っている株を出す", async ({ page }) => {
    await open(page, "/");
    const money = page.getByTestId("money-card");
    await expect(money).toContainText("残高。元手(元本)は 10,000円");
    await expect(money).toContainText("9,914円");
    await expect(money).toContainText("▼ -86円");
    // 手計算: (79.20 - 78.45) × 0.4248 × 150 = 47.79 → 48円
    await expect(money).toContainText("▲ +48円");
    await expect(money).toContainText("8% 使用");
    await expect(money).toContainText("あと 914円の損失で、今日の新しい買いを止めます");
    const positions = page.getByTestId("positions-card");
    await expect(positions).toContainText("TQQQ");
    await expect(positions).toContainText("損切りの価格(逆指値)");
    await expect(positions).not.toContainText("SOXL");
  });

  test("AC-007-17: 今日の損失が上限に達したら、警告と、新しい買いを止めていることと、売りは続けていることを出す", async ({ page }) => {
    await patchDashboard(page, (view) => {
      const money = view.money as Record<string, unknown>;
      Object.assign(money, { todayRealizedJpy: -1000, lossLimitUsedRatio: 1, limitReached: true });
    });
    await open(page, "/");
    // Next.js の画面の移動を読み上げる部品も role="alert" なので、文字で絞る
    const alert = page.getByRole("alert").filter({ hasText: "今日の損失が上限に達しました" });
    await expect(alert).toContainText("今日の損失が上限に達しました");
    await expect(alert).toContainText("新しい買いを止めています");
    await expect(alert).toContainText("持っている株の売りは続けています");
    await expect(page.getByTestId("money-card")).toContainText("100% 使用");
  });

  test("AC-007-09: 自動売買のプロセスが止まっていたら、そのことと最後に動いていた時刻を出す", async ({ page }) => {
    await patchDashboard(page, (view) => {
      Object.assign(view.worker as Record<string, unknown>, { stopped: true });
    });
    await open(page, "/");
    const worker = page.getByTestId("worker-card");
    await expect(worker).toContainText("自動売買が止まっています");
    await expect(worker).toContainText("最後に動いていた時刻: 米国東部 11/2 10:17");
  });

  test("AC-007-10: データを取れていない時は、そのことと練習売買をしていないことを出す", async ({ page }) => {
    await patchDashboard(page, (view) => {
      Object.assign(view.worker as Record<string, unknown>, {
        state: "data-error",
        message: "データを取得できていません。練習売買はしていません(接続用キーが正しくありません)",
      });
    });
    await open(page, "/");
    await expect(page.getByTestId("worker-card")).toContainText("データを取得できていません。練習売買はしていません");
  });
});

test.describe("自動売買の記録", () => {
  test("AC-007-19: ルールの一覧、今持っている株、今日の売買の記録(売った理由つき)を出す", async ({ page }) => {
    await open(page, "/trades");
    await expect(page.getByRole("heading", { level: 1, name: "自動売買の記録" })).toBeVisible();
    const rules = page.getByRole("region", { name: "自動売買のルール" });
    await expect(rules).toContainText("損切りの価格(逆指値)まで下がったら売る");
    await expect(rules).toContainText("元手の50%まで(5,000円)");
    await expect(page.getByTestId("positions-card")).toContainText("TQQQ");
    const table = page.getByRole("table");
    const soxl = table.getByRole("row", { name: /SOXL/ });
    await expect(soxl).toContainText("09:50");
    await expect(soxl).toContainText("09:55");
    await expect(soxl).toContainText("$77.10");
    await expect(soxl).toContainText("損切りの価格に達した");
    await expect(soxl).toContainText("▼ -86円");
    const tqqq = table.getByRole("row", { name: /TQQQ/ });
    await expect(tqqq).toContainText("保有中");
    await expect(tqqq).toContainText("未確定 ▲ +48円");
    await expect(table.getByRole("row", { name: /売買が済んだ分の合計/ })).toContainText("▼ -86円");
  });

  test("AC-007-20: 記録が0件なら「今日はまだ売買していません」と出す", async ({ page }) => {
    await patchDashboard(page, (view) => {
      view.trades = [];
      view.positions = [];
    });
    await open(page, "/trades");
    await expect(page.getByText("今日はまだ売買していません")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("AC-007-04: 記録の表は、幅が狭い時に枠の中で横に動かせ、画面は横にはみ出さない", async ({ page }) => {
    await open(page, "/trades");
    const scroll = page.getByTestId("trades-scroll");
    await expect(scroll).toBeVisible();
    const viewport = page.viewportSize();
    const { scrollWidth, clientWidth } = await scroll.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    if (viewport && viewport.width < 600) expect(scrollWidth).toBeGreaterThan(clientWidth);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("AC-007-21: 今日の記録がまだない時は、最後に記録した日と、その日付の言葉で出す", async ({ page }) => {
  await patchDashboard(page, (view) => {
    view.isToday = false;
    Object.assign(view.money as Record<string, unknown>, { todayRealizedJpy: -1000, lossLimitUsedRatio: 1, limitReached: true });
  });
  await open(page, "/");
  await expect(page.getByText("今日(米国東部)の記録はまだありません。11月2日(月)の記録を出しています。")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "11月2日(月)の損失が上限に達しました" })).toBeVisible();
  const money = page.getByTestId("money-card");
  await expect(money).toContainText("11月2日(月)のお金の状況");
  await expect(money).toContainText("11月2日(月)の損益(売買が済んだ分)");
  await expect(money).not.toContainText("今日");
  await expect(page.getByTestId("worker-card")).toContainText("11月2日(月)の買い 2回 / 売り 1回");
});

test("AC-007-04: ダッシュボードは横にはみ出さない", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByTestId("price-chart").locator("canvas").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
