import { expect, test } from "@playwright/test";

const PAGES = [
  { path: "/", label: "ダッシュボード" },
  { path: "/trades", label: "自動売買の記録" },
  { path: "/results", label: "成績" },
  { path: "/simulator", label: "シミュレーター" },
  { path: "/settings", label: "設定" },
] as const;

const DISCLAIMER =
  "本アプリは技術検証とシミュレーションが目的で、投資助言・推奨ではありません。";

for (const { path, label } of PAGES) {
  test(`AC-007-01: ${label}(${path})の下部に免責を出す`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("contentinfo")).toContainText(DISCLAIMER);
  });

  test(`AC-007-02: ${label}(${path})で今いる画面がメニューでわかる`, async ({ page }) => {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "メイン" });
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test(`AC-007-04: ${label}(${path})が横にはみ出さない`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("AC-007-02: メニューから全画面へ移動できる", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "メイン" });
  for (const { path, label } of PAGES) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
  }
});

test("AC-007-05: キーボードだけでメニューのリンクに移動して押せる", async ({ page }) => {
  await page.goto("/");
  const target = page
    .getByRole("navigation", { name: "メイン" })
    .getByRole("link", { name: "成績" });
  // 本文へ移動、メニューの5つ、の順に Tab で進む
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/results");
});
