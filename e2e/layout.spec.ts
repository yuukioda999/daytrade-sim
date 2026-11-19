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
    const current = nav.getByRole("link", { name: label });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    // 色だけでなく、形(下線)でも示していること。ほかのリンクには下線がないこと
    const shadowOf = (el: Element) => getComputedStyle(el).boxShadow;
    expect(await current.evaluate(shadowOf)).not.toBe("none");
    const others = nav.locator('a:not([aria-current="page"])');
    for (const other of await others.all()) {
      expect(await other.evaluate(shadowOf)).toBe("none");
    }
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

const outlineWidth = (el: Element) => parseFloat(getComputedStyle(el).outlineWidth);

test("AC-007-05: Tab で本文へ移動とメニューの全リンクに順に移動でき、フォーカスの枠が見える", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "メイン" });
  const order = [
    page.getByRole("link", { name: "本文へ移動" }),
    ...PAGES.map(({ label }) => nav.getByRole("link", { name: label })),
  ];
  for (const link of order) {
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await expect(link).toBeVisible();
    expect(await link.evaluate(outlineWidth)).toBeGreaterThan(0);
  }
});

for (const { path, label } of PAGES) {
  test(`AC-007-05: キーボードだけでメニューの「${label}」を押せる`, async ({ page }) => {
    await page.goto(path === "/" ? "/settings" : "/");
    const link = page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: label });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(path);
  });
}

test("AC-007-05: 本文へ移動のリンクを Enter で押すと本文に移る", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "本文へ移動" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(page.locator("main#main")).toBeFocused();
});
