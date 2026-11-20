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
  // デスクトップの幅のテストが同時にキーを保存していると「キーを置き換えて保存」になる
  for (const name of [/^キーを(置き換えて)?保存$/, /^元手と為替を保存$/]) {
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

// 市場データ(Alpaca)の接続と過去データ。取得元は通信しないテスト用のもの(playwright.config.ts の DAYTRADE_FAKE_MARKET_DATA)。
// 設定を書き換えるテストと同じファイルに置き、同時に動かないようにする
const GOOD = {
  keyId: "PKTESTKEY0000000ABCD",
  secret: "TestSecret000000000000000000000000000Zq9X",
};
const BAD = {
  keyId: "PKBADKEY00000000WXYZ",
  secret: "BadSecret0000000000000000000000000000000",
};

test.describe("市場データ", () => {
  async function saveKey(page: Page, creds: { keyId: string; secret: string }) {
    const res = await page
      .context()
      .request.put("/api/settings/credentials", { data: creds });
    expect(res.status()).toBe(200);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "保存先を書き換えるテストはデスクトップの幅だけで動かす",
    );
    await saveKey(page, GOOD);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "設定", level: 1 }),
    ).toBeVisible();
  });

  test("AC-006-05: 接続を確かめると、SOXL の最新の足を取って成功を出す", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "接続を確かめる" }).click();
    await expect(
      page.getByTestId("connection-check-result").getByRole("status"),
    ).toContainText(
      /接続できました。SOXL の最新の5分ごとの値動き\(5分足\): .*\(米国東部時間\)、その5分の最後の値段\(終値\) \$42\.50。テスト用の取得元のため、本物のデータではありません/,
    );
  });

  test("AC-006-05: キーが違うと失敗を出す。画面にキーを出さない", async ({
    page,
  }) => {
    await saveKey(page, BAD);
    await page.reload();
    await page.getByRole("button", { name: "接続を確かめる" }).click();
    await expect(
      page.getByTestId("connection-check-result").getByRole("alert"),
    ).toContainText("キー ID かシークレットが違う");
    const html = await page.content();
    expect(html).not.toContain(BAD.keyId);
    expect(html).not.toContain(BAD.secret);
  });

  test("AC-006-09、11、17: 期間を選んで取ると進み具合を出し、失敗した期間を出す。もう一度取れる", async ({
    page,
  }) => {
    await page.getByLabel("始めの日").fill("2026-10-01");
    await page.getByLabel("終わりの日").fill("2026-10-30");
    await page.getByRole("button", { name: "過去データを取得する" }).click();

    // 進み具合(4銘柄 × 1か月 = 4回)
    await expect(page.getByTestId("historical-status")).toContainText(
      "/ 4 回を取得しました",
    );
    await expect(
      page.getByRole("progressbar", { name: "過去データの取得の進み具合" }),
    ).toBeVisible();

    // TSLL の 2026年10月は1回目だけ失敗する(テスト用の取得元の設定)
    await expect(page.getByTestId("historical-status")).toContainText(
      "3 / 4 回を取得",
    );
    await expect(page.getByTestId("historical-failures")).toContainText(
      "TSLL 2026年10月1日(木)から2026年10月30日(金)",
    );
    // 取れた分は保存している(22取引日 × 78本)
    const table = page.getByTestId("historical-summary");
    await expect(table.getByRole("row", { name: /SOXL/ })).toContainText(
      "1,716本",
    );
    await expect(table.getByRole("row", { name: /TSLL/ })).toHaveCount(0);

    await page
      .getByRole("button", { name: "取得できなかった期間をもう一度取る" })
      .click();
    await expect(page.getByTestId("historical-status")).toContainText(
      "1 / 1 回を取得し、新しく 1,716 本の値動き",
    );
    await expect(page.getByTestId("historical-failures")).toHaveCount(0);
    await expect(table.getByRole("row", { name: /TSLL/ })).toContainText(
      "1,716本",
    );
  });

  test("AC-006-10: 取得済みの期間をもう一度取っても、同じ足を二重に保存しない", async ({
    page,
  }) => {
    const table = page.getByTestId("historical-summary");
    await expect(table.getByRole("row", { name: /SOXL/ })).toContainText(
      "1,716本",
    );
    await page.getByLabel("始めの日").fill("2026-10-01");
    await page.getByLabel("終わりの日").fill("2026-10-30");
    await page.getByRole("button", { name: "過去データを取得する" }).click();
    await expect(page.getByTestId("historical-status")).toHaveText(
      "この期間はすべて取得済みです",
    );
    await expect(table.getByRole("row", { name: /SOXL/ })).toContainText(
      "1,716本",
    );

    // 重なる期間(10月の後半と、まだ取っていない11月の2日)を取ると、11月の分だけが増える
    await page.getByLabel("始めの日").fill("2026-10-15");
    await page.getByLabel("終わりの日").fill("2026-11-03");
    await page.getByRole("button", { name: "過去データを取得する" }).click();
    await expect(page.getByTestId("historical-status")).toHaveText(
      "4 / 4 回を取得し、新しく 624 本の値動きを保存しました",
    );
    // 1,716本 + 11月の2日 × 78本
    await expect(table.getByRole("row", { name: /SOXL/ })).toContainText(
      "1,872本",
    );
  });

  test("AC-006-16: 取得の途中で止めると、取った回数と残りの回数を出す。もう一度始めると続きから取る", async ({
    page,
  }) => {
    await page.getByLabel("始めの日").fill("2026-07-01");
    await page.getByLabel("終わりの日").fill("2026-08-31");
    await page.getByRole("button", { name: "過去データを取得する" }).click();
    // 4銘柄 × 2か月 = 8回。1回目を取っている間に止める
    await expect(page.getByTestId("historical-status")).toContainText(
      "0 / 8 回を取得しました",
    );
    await page.getByRole("button", { name: "止める" }).click();
    await expect(page.getByTestId("historical-status")).toHaveText(
      /^止めました。残りの 7 回は取っていません\(もう一度始めると続きから取ります\)。1 \/ 8 回を取得し/,
    );
    await expect(page.getByRole("button", { name: "止める" })).toHaveCount(0);

    // もう一度始めると、取り終えた1回分を飛ばした7回だけを取る
    await page.getByRole("button", { name: "過去データを取得する" }).click();
    await expect(page.getByTestId("historical-status")).toContainText(
      "7 / 7 回を取得し",
    );
  });

  test("AC-006-09: 期間が違うと取らずに、どこが違うかを出す", async ({
    page,
  }) => {
    await page.getByLabel("始めの日").fill("2024-10-01");
    await page.getByLabel("終わりの日").fill("2024-10-30");
    await page.getByRole("button", { name: "過去データを取得する" }).click();
    await expect(page.getByLabel("始めの日")).toHaveAccessibleDescription(
      /休場日の表がない/,
    );
  });
});

test("AC-007-04: 過去データの取得の結果と失敗の一覧が、幅 390px でもはみ出さない", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "スマホの幅だけで確かめる");
  // スマホの幅のテストは、デスクトップの幅のテストが終わってから動く(playwright.config.ts)
  const res = await page.context().request.put("/api/settings/credentials", {
    data: GOOD,
  });
  expect(res.status()).toBe(200);
  await page.goto("/settings");
  await page.getByLabel("始めの日").fill("2026-09-01");
  await page.getByLabel("終わりの日").fill("2026-09-30");
  await page.getByRole("button", { name: "過去データを取得する" }).click();
  // TSLL の 2026年9月は1回目だけ失敗する(テスト用の取得元の設定)
  await expect(page.getByTestId("historical-failures")).toContainText("TSLL");
  await expect(page.getByTestId("historical-status")).toContainText(
    "3 / 4 回を取得",
  );
  await expect(page.getByTestId("historical-status")).toBeFocused();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
