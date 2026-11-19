import { expect, test } from "@playwright/test";

/** 時計を固定して、ヘッダーの市場の状態を確かめる(SPEC-001)。 */
const CASES = [
  {
    id: "AC-001-13",
    name: "冬時間の平日 09:30",
    at: "2026-11-02T14:30:00Z",
    status: "市場は開いています",
    time: "米国東部 09:30(冬時間)",
  },
  {
    id: "AC-001-13",
    name: "夏時間の平日 09:30",
    at: "2026-10-30T13:30:00Z",
    status: "市場は開いています",
    time: "米国東部 09:30(夏時間)",
  },
  {
    id: "AC-001-13",
    name: "土曜日",
    at: "2026-11-07T15:00:00Z",
    status: "市場は閉まっています",
    time: "米国東部 10:00(冬時間)",
  },
  {
    id: "AC-001-12",
    name: "休場日の表にない年",
    at: "2030-01-07T15:00:00Z",
    status: "休場日の表が古いため、開いているか判定できません",
    time: "米国東部 10:00(冬時間)",
  },
] as const;

for (const c of CASES) {
  test(`${c.id}: ${c.name}(${c.at})のヘッダーの表示`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(c.at));
    await page.goto("/");
    const status = page.getByTestId("market-status");
    await expect(status).toContainText(c.status);
    await expect(status).toContainText(c.time);
  });
}
