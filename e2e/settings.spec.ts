import { expect, test, type Page } from "@playwright/test";
import { toEastern } from "../src/domain/market/eastern-time";
import { nextTradingDate } from "../src/domain/market/market-calendar";
import { formatDateJa } from "../src/components/settings/format";

// 設定は1つの DB に保存するので、デスクトップとスマホの2つの幅で同時に書き換えないように、
// 書き換えるテストはデスクトップだけで、順番に動かす
test.describe.configure({ mode: "serial" });

const KEY_ID = "PKTESTKEY0000000ABCD";
const SECRET = "TestSecret000000000000000000000000000Zq9X";

/** 前の状態に頼らないように、キーを消し、自動売買を ON に戻してから始める */
async function reset(page: Page) {
  const base = page.context().request;
  await base.delete("/api/settings/credentials");
  await base.put("/api/settings/auto-trading", { data: { enabled: true } });
}

test("AC-007-04: 設定の画面は幅 390px でも横にはみ出さず、入力欄とボタンが見える(書き換えない)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "スマホの幅だけで確かめる");
  await page.goto("/settings");
  for (const label of [
    "キー ID",
    "シークレット",
    "元手(円)",
    "為替レート(1ドルあたりの円)",
  ]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  for (const name of ["キーを保存", "元手と為替を保存"]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  await expect(
    page.getByRole("switch", { name: "自動で練習売買をする" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe("設定を書き換える", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "設定を書き換えるテストはデスクトップの幅だけで動かす",
    );
    await reset(page);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "設定", level: 1 }),
    ).toBeVisible();
  });

  test("AC-006-02: 1回の買いの予算と今日の損失の上限を、変えられない値として出す", async ({
    page,
  }) => {
    const budget = page.getByTestId("budget");
    // 今使っている元手から金額を出す(元手 10,000円 なら 5,000円 と 1,000円)
    const current = await page.getByTestId("money-current").innerText();
    const principal = Number(
      /元手 ([\d,]+)円/.exec(current)?.[1].replaceAll(",", ""),
    );
    await expect(budget).toHaveText(
      `元手の50%まで(${(principal / 2).toLocaleString("ja-JP")}円)`,
    );
    await expect(page.getByTestId("daily-loss-limit")).toHaveText(
      `元手の10%(${(principal / 10).toLocaleString("ja-JP")}円)`,
    );
    // 入力欄やボタンではなく、表示だけ
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("AC-006-03: キー ID とシークレットを保存すると、「設定済み」と末尾4文字だけを出す", async ({
    page,
  }) => {
    await expect(page.getByTestId("credentials-status")).toHaveText("未設定");
    await page.getByLabel("キー ID").fill(KEY_ID);
    await page.getByLabel("シークレット").fill(SECRET);
    await page.getByRole("button", { name: "キーを保存" }).click();

    await expect(page.getByTestId("credentials-status")).toHaveText(
      "設定済み(キー ID の末尾 ABCD)",
    );
    await expect(
      page.getByRole("status").filter({ hasText: "接続用キーを保存しました" }),
    ).toBeVisible();
    // 保存したあとは、入力欄にも残さない
    await expect(page.getByLabel("キー ID")).toHaveValue("");
    await expect(page.getByLabel("シークレット")).toHaveValue("");

    // 画面を読み込み直しても、全文はどこにも出ない
    await page.reload();
    await expect(page.getByTestId("credentials-status")).toHaveText(
      "設定済み(キー ID の末尾 ABCD)",
    );
    const html = await page.content();
    expect(html).not.toContain(KEY_ID);
    expect(html).not.toContain(SECRET);
  });

  test("AC-006-04: 設定を読み込む API の応答に、キーの全文が含まれない", async ({
    page,
  }) => {
    const api = page.context().request;
    const saved = await api.put("/api/settings/credentials", {
      data: { keyId: KEY_ID, secret: SECRET },
    });
    expect(saved.status()).toBe(200);
    const res = await api.get("/api/settings");
    const text = await res.text();
    expect(text).toContain('"configured":true');
    expect(text).not.toContain(KEY_ID);
    expect(text).not.toContain(SECRET);
  });

  test("AC-006-06: キーを削除すると「未設定」になり、自動売買が止まる理由を出す", async ({
    page,
  }) => {
    await page.getByLabel("キー ID").fill(KEY_ID);
    await page.getByLabel("シークレット").fill(SECRET);
    await page.getByRole("button", { name: "キーを保存" }).click();
    await expect(page.getByTestId("credentials-status")).toContainText(
      "設定済み",
    );
    await expect(page.getByTestId("auto-trading-blocked")).toHaveCount(0);

    await page.getByRole("button", { name: "キーを削除" }).click();
    await expect(page.getByTestId("credentials-status")).toHaveText("未設定");
    await expect(page.getByTestId("auto-trading-blocked")).toContainText(
      "自動売買は止まっています",
    );
  });

  test("AC-006-08: キーの形式が違うと保存せず、どこが違うかを出す", async ({
    page,
  }) => {
    await page.getByLabel("キー ID").fill(KEY_ID);
    await page.getByLabel("シークレット").fill("has spaces in it");
    await page.getByRole("button", { name: "キーを保存" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "保存していません" }),
    ).toBeVisible();
    const secret = page.getByLabel("シークレット");
    await expect(secret).toHaveAttribute("aria-invalid", "true");
    // 最初のエラーの入力欄へフォーカスが移る
    await expect(secret).toBeFocused();
    // エラー文は入力欄に結びつけて読み上げる
    await expect(secret).toHaveAccessibleDescription(
      /シークレットは英字と数字だけ/,
    );
    await expect(page.getByLabel("キー ID")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByTestId("credentials-status")).toHaveText("未設定");
  });

  test("AC-006-01: 自動売買を OFF にすると保存され、読み込み直しても OFF のまま", async ({
    page,
  }) => {
    const toggle = page.getByRole("switch", { name: "自動で練習売買をする" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("auto-trading-blocked")).toContainText("OFF");
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "自動で練習売買をする" }),
    ).not.toBeChecked();
  });

  test("AC-006-13: 元手が範囲の外なら保存せず、どこが違うかを出す", async ({
    page,
  }) => {
    const principal = page.getByLabel("元手(円)");
    await principal.fill("999");
    await page.getByRole("button", { name: "元手と為替を保存" }).click();
    await expect(principal).toHaveAttribute("aria-invalid", "true");
    await expect(principal).toBeFocused();
    await expect(principal).toHaveAccessibleDescription(
      /1,000円 から 10,000,000円/,
    );
  });

  test("AC-006-14: 為替レートが小数3桁なら保存せず、どこが違うかを出す", async ({
    page,
  }) => {
    const fx = page.getByLabel("為替レート(1ドルあたりの円)");
    await fx.fill("150.255");
    await page.getByRole("button", { name: "元手と為替を保存" }).click();
    await expect(fx).toHaveAttribute("aria-invalid", "true");
    await expect(fx).toHaveAccessibleDescription(/小数2桁まで/);
  });

  test("AC-006-15: 元手と為替をもう一度変えると、次の取引日から使う値として出す", async ({
    page,
  }) => {
    const section = page.getByRole("region", { name: "元手と為替" });
    const save = async (principal: string, fx: string) => {
      await page.getByLabel("元手(円)").fill(principal);
      await page.getByLabel("為替レート(1ドルあたりの円)").fill(fx);
      await page.getByRole("button", { name: "元手と為替を保存" }).click();
      await expect(section.getByRole("status")).toContainText("保存しました");
    };
    // 1回目(DB の状態によって、今日からか次の取引日からかが変わる)のあとに、2回目を保存する
    await save("15,000", "150");
    await save("20,000", "140.5");

    const next = nextTradingDate(toEastern(new Date()).date);
    await expect(section.getByRole("status")).toHaveText(
      `保存しました。${formatDateJa(next)}から使います`,
    );
    await expect(page.getByTestId("money-scheduled")).toHaveText(
      "元手 20,000円、為替レート 140.50円",
    );
    // 今日はまだ前の値のまま
    await expect(page.getByTestId("money-current")).not.toContainText(
      "20,000円",
    );
  });
});
