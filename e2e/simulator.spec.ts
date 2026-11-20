import { expect, test, type Page } from "@playwright/test";
import { compareScenarios } from "../src/domain/simulator/simulator";
import { formatYen, toSimulatorInput, DEFAULT_STEPS, type SimulatorSteps } from "../src/components/simulator/simulator-model";

const KEYS = ["withTrial", "noTrial", "fullCompound"] as const;

/** 画面と同じ計算で、期待する終わりの合計を作る(計算そのものは単体テストで手計算と比べている) */
function expectedTotals(steps: SimulatorSteps): string[] {
  const c = compareScenarios(toSimulatorInput(steps, 10_000));
  return KEYS.map((k) => formatYen(c[k].rows[c[k].rows.length - 1].totalJpy));
}

async function expectTotals(page: Page, totals: string[]) {
  for (const [i, key] of KEYS.entries()) {
    await expect(page.getByTestId(`total-${key}`)).toContainText(totals[i]);
  }
}

const slider = (page: Page, name: string) => page.getByRole("slider", { name });
const tableRows = (page: Page) => page.getByTestId("year-table-scroll").locator("tbody tr");

test.beforeEach(async ({ page }) => {
  await page.goto("/simulator");
});

test("AC-005-04: 既定値で、3つの条件の終わりの合計、グラフ、年次の表を出す", async ({ page }) => {
  // SPEC-005 の既定値の3年後(T5 で Python の Decimal と比べた値を1円未満で四捨五入)
  await expectTotals(page, ["46,031円", "52,806円", "62,139円"]);
  await expect(page.getByTestId("simulator-chart").locator(".recharts-line-curve")).toHaveCount(3);
  await expect(tableRows(page)).toHaveCount(3);
  // 3年目の行の合計の3列(税金、運用中、貯金の後ろ)が、それぞれの条件の値になっている
  const cells = tableRows(page).nth(2).locator("td");
  await expect(cells.nth(3)).toHaveText("46,031円");
  await expect(cells.nth(4)).toHaveText("52,806円");
  await expect(cells.nth(5)).toHaveText("62,139円");
});

test("AC-005-05: スライダーを動かすと、グラフと年次の表が描き直される", async ({ page }) => {
  const curve = page.getByTestId("simulator-chart").locator(".recharts-line-curve").first();
  const before = await curve.getAttribute("d");

  await slider(page, "続ける年数(1年 = 240営業日)").focus();
  await page.keyboard.press("ArrowRight");

  await expect(tableRows(page)).toHaveCount(4);
  await expectTotals(page, expectedTotals({ ...DEFAULT_STEPS, years: 4 }));
  await expect(curve).not.toHaveAttribute("d", before ?? "");
});

test("AC-005-05: 税金のスイッチを切り替えると、グラフと年次の表が描き直される", async ({ page }) => {
  const curve = page.getByTestId("simulator-chart").locator(".recharts-line-curve").first();
  const before = await curve.getAttribute("d");
  const tax = page.getByRole("switch", { name: /税金/ });
  await expect(tax).toBeChecked();
  await tax.click();
  await expect(tax).not.toBeChecked();
  const totals = expectedTotals({ ...DEFAULT_STEPS, taxOn: false });
  await expectTotals(page, totals);
  await expect(tableRows(page).nth(2)).toContainText(totals[0]);
  // 税金の列は 0 円になる
  await expect(tableRows(page).nth(0).locator("td").first()).toHaveText("0円");
  await expect(curve).not.toHaveAttribute("d", before ?? "");
});

test("AC-005-05: 税金の文字を押してもスイッチが切り替わる(押せる範囲を広げている)", async ({ page }) => {
  const tax = page.getByRole("switch", { name: /税金/ });
  await page.getByText(/税金\(20\.315%\)を引く/).click();
  await expect(tax).not.toBeChecked();
});

test("AC-005-06: 将来の利益を示すものではないことを出す", async ({ page }) => {
  await expect(page.getByTestId("simulator-disclaimer")).toContainText(
    "一定の利益率が毎日続くと仮定した計算で、将来の利益を示すものではありません",
  );
});

test("AC-005-07: 3つの条件を、色だけでなく線の種類でも区別する", async ({ page }) => {
  const curves = page.getByTestId("simulator-chart").locator(".recharts-line-curve");
  await expect(curves).toHaveCount(3);
  const styles = await curves.evaluateAll((els) =>
    els.map((el) => ({
      dash: el.getAttribute("stroke-dasharray") ?? "none",
      stroke: getComputedStyle(el).stroke,
    })),
  );
  // 実線、破線、点線の3種類がそろっている
  expect(styles.map((s) => s.dash).sort()).toEqual(["2 5", "8 5", "none"].sort());
  // 色も3つとも違う
  expect(new Set(styles.map((s) => s.stroke)).size).toBe(3);
});

test("AC-005-08: 矢印キーで値が刻みどおりに変わり、今の値が読み上げられる", async ({ page }) => {
  const rate = slider(page, "1日あたりの想定利益率");
  await expect(rate).toHaveAttribute("aria-valuetext", "0.30%");

  await rate.focus();
  await page.keyboard.press("ArrowRight");
  await expect(rate).toHaveAttribute("aria-valuenow", "7");
  await expect(rate).toHaveAttribute("aria-valuetext", "0.35%");
  await expect(page.getByTestId("slider-rate-value")).toHaveText("0.35%");

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(rate).toHaveAttribute("aria-valuetext", "0.25%");

  // 上限(1%)まで動かしても、計算の範囲の確かめでエラーにならない(PR #5 のレビュー)
  await page.keyboard.press("End");
  await expect(rate).toHaveAttribute("aria-valuetext", "1.00%");
  await expectTotals(page, expectedTotals({ ...DEFAULT_STEPS, rateSteps: 20 }));
});

const SLIDERS: {
  name: string;
  before: string;
  after: string;
  steps: Partial<SimulatorSteps>;
}[] = [
  { name: "お試し期間(利益0で計算)", before: "3か月(60営業日)", after: "4か月(80営業日)", steps: { trialMonths: 4 } },
  { name: "1日あたりの想定利益率", before: "0.30%", after: "0.35%", steps: { rateSteps: 7 } },
  { name: "続ける年数(1年 = 240営業日)", before: "3年", after: "4年", steps: { years: 4 } },
  { name: "年末に利益から貯金へ回す割合", before: "30%", after: "35%", steps: { savingsSteps: 7 } },
];

for (const { name, before, after, steps } of SLIDERS) {
  test(`AC-005-05, AC-005-08: 「${name}」を矢印キーで1刻み動かすと、値の言葉と計算が変わる`, async ({ page }) => {
    const s = slider(page, name);
    await expect(s).toHaveAttribute("aria-valuetext", before);
    const curve = page.getByTestId("simulator-chart").locator(".recharts-line-curve").first();
    const d = await curve.getAttribute("d");

    await s.focus();
    await page.keyboard.press("ArrowRight");
    await expect(s).toHaveAttribute("aria-valuetext", after);
    await expectTotals(page, expectedTotals({ ...DEFAULT_STEPS, ...steps }));
    await expect(curve).not.toHaveAttribute("d", d ?? "");

    await page.keyboard.press("ArrowLeft");
    await expect(s).toHaveAttribute("aria-valuetext", before);
    await expectTotals(page, expectedTotals(DEFAULT_STEPS));
  });
}

test("AC-007-05: 税金のスイッチの次の Tab は年次の表に移り、グラフの中で止まらない", async ({ page }) => {
  await page.getByRole("switch", { name: /税金/ }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("year-table-scroll")).toBeFocused();
});

test("AC-007-04: 年次の表は枠の中で横に動かせる(幅 390px)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "スマホの幅だけで確かめる");
  const scroll = page.getByTestId("year-table-scroll");
  const { scrollWidth, clientWidth } = await scroll.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  // キーボードでもフォーカスして動かせる
  await scroll.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test("SPEC-005 境界の例「上限」: 利益率 1%、10年、税金 OFF でも数値が枠からはみ出さない", async ({ page }) => {
  await slider(page, "1日あたりの想定利益率").focus();
  await page.keyboard.press("End");
  await slider(page, "続ける年数(1年 = 240営業日)").focus();
  await page.keyboard.press("End");
  // 税金 OFF が一番大きな数になる
  await page.getByRole("switch", { name: /税金/ }).click();
  await expect(tableRows(page)).toHaveCount(10);
  await expectTotals(page, expectedTotals({ ...DEFAULT_STEPS, rateSteps: 20, years: 10, taxOn: false }));

  // 今の幅に加えて、3枚のカードが横に並んで1枚が最も狭くなる幅(900px)でも確かめる
  const widths = [page.viewportSize()?.width ?? 0, 900];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // 幅を変えた直後は、グラフが前の幅のまま残っている(ResizeObserver で描き直す)ので、落ち着くまで待つ
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        { message: `幅 ${width}px` },
      )
      .toBeLessThanOrEqual(0);
    for (const key of KEYS) {
      const card = page.getByTestId(`total-${key}`);
      const fits = await card.evaluate((el) =>
        Array.from(el.querySelectorAll("p")).every((p) => p.scrollWidth <= p.clientWidth),
      );
      expect(fits, `幅 ${width}px の ${key}`).toBe(true);
    }
    // 年次の表の数字や「1年目」が、折り返されずに1行で出ている
    const wrapped = await page.getByTestId("year-table-scroll").evaluate((el) =>
      Array.from(el.querySelectorAll("th, td"))
        .filter((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
          return tops.size > 1;
        })
        .map((cell) => cell.textContent),
    );
    expect(wrapped, `幅 ${width}px で折り返された表のセル`).toEqual([]);
  }
});

test("AC-007-03: 部品の枠線は指定した色で出る(色の比のテストが画面と同じ組み合わせを見ている)", async ({ page }) => {
  // globals.css の全体の枠線の色が、border-primary などの指定に負けていないこと
  const thumb = slider(page, "1日あたりの想定利益率");
  expect(await thumb.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe("rgb(90, 169, 255)");
});
