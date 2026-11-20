import { describe, expect, it } from "vitest";
import {
  effectiveMoneyOn,
  fixedLimitsJpy,
  keyIdLast4,
  moneySettingsOn,
  parseFxRate,
  parsePrincipal,
  scheduleMoneyChange,
  validateCredentials,
  type MoneySettings,
} from "./settings";

describe("AC-006-13: 元手は 1,000円 から 10,000,000円 の整数だけ", () => {
  it.each([
    ["1000", 1_000],
    ["1,000", 1_000],
    ["10000000", 10_000_000],
    ["10,000,000", 10_000_000],
    [" 10,000 ", 10_000],
    ["１０，０００", 10_000],
  ])("「%s」は %d 円として受け付ける", (text, value) => {
    expect(parsePrincipal(text)).toEqual({ ok: true, value });
  });

  it.each([
    ["999", "範囲"],
    ["10000001", "範囲"],
    ["0", "範囲"],
    ["-1000", "整数"],
    ["1000.5", "整数"],
    ["1e4", "整数"],
    ["1,0000", "整数"],
    ["", "入れて"],
    ["   ", "入れて"],
    ["abc", "整数"],
  ])("「%s」は受け付けない(%s)", (text, word) => {
    const r = parsePrincipal(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(word);
  });
});

describe("AC-006-14: 為替レートは 50 から 300 までの、小数2桁までの数だけ", () => {
  it.each([
    ["50", 5_000],
    ["300", 30_000],
    ["150", 15_000],
    ["150.5", 15_050],
    ["150.25", 15_025],
    ["0150.05", 15_005],
    ["１５０．２５", 15_025],
  ])("「%s」は 100 倍して %d として受け付ける", (text, x100) => {
    expect(parseFxRate(text)).toEqual({ ok: true, value: x100 });
  });

  it.each([
    ["49.99", "範囲"],
    ["300.01", "範囲"],
    ["150.255", "小数2桁"],
    ["150.", "小数2桁"],
    [".5", "小数2桁"],
    ["-150", "小数2桁"],
    ["1e2", "小数2桁"],
    ["", "入れて"],
  ])("「%s」は受け付けない(%s)", (text, word) => {
    const r = parseFxRate(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(word);
  });
});

describe("AC-006-15: 元手か為替を変えると、次の取引日から使う", () => {
  const first: MoneySettings = { effectiveDate: "2026-11-02", principalJpy: 10_000, fxRateX100: 15_000 };

  it("設定がまだない時は、今日から使う", () => {
    expect(scheduleMoneyChange([], { principalJpy: 20_000, fxRateX100: 15_000 }, "2026-11-20")).toEqual({
      effectiveDate: "2026-11-20",
      principalJpy: 20_000,
      fxRateX100: 15_000,
    });
  });

  it("設定がある時は、次の取引日から使う(金曜日に変えると月曜日から)", () => {
    const change = scheduleMoneyChange([first], { principalJpy: 20_000, fxRateX100: 14_000 }, "2026-11-20");
    expect(change.effectiveDate).toBe("2026-11-23");
  });

  it("過去の日の値は変わらない(過去の記録を計算し直さない)", () => {
    const change = scheduleMoneyChange([first], { principalJpy: 20_000, fxRateX100: 14_000 }, "2026-11-20");
    const history = [first, change];
    expect(moneySettingsOn(history, "2026-11-20")).toEqual(first);
    expect(moneySettingsOn(history, "2026-11-02")).toEqual(first);
    expect(moneySettingsOn(history, "2026-11-23")).toEqual(change);
    expect(moneySettingsOn(history, "2026-12-01")).toEqual(change);
  });

  it("使い始める日より前の日には、設定がない", () => {
    expect(moneySettingsOn([first], "2026-11-01")).toBeNull();
  });

  it("まだ一度も保存していなければ、既定の値(元手 10,000円、為替 150)を使う", () => {
    expect(effectiveMoneyOn([], "2026-11-20")).toEqual({ effectiveDate: null, principalJpy: 10_000, fxRateX100: 15_000 });
    expect(effectiveMoneyOn([first], "2026-11-20")).toEqual(first);
  });

  it("並び順によらず、その日以前で最も新しい設定を選ぶ", () => {
    const later: MoneySettings = { effectiveDate: "2026-11-10", principalJpy: 30_000, fxRateX100: 15_500 };
    expect(moneySettingsOn([later, first], "2026-11-12")).toEqual(later);
  });
});

describe("AC-006-02: 1回の買いの予算と今日の損失の上限", () => {
  it("元手 10,000円 なら、予算 5,000円(50%)、上限 1,000円(10%)", () => {
    expect(fixedLimitsJpy(10_000)).toEqual({ budgetJpy: 5_000, dailyLossLimitJpy: 1_000 });
  });
  it("元手が奇数でも割ったまま(1,001円なら予算 500.5円)。画面では SPEC-003 定義 7 のとおり四捨五入して出す", () => {
    const limits = fixedLimitsJpy(1_001);
    expect(limits.budgetJpy).toBe(500.5);
    expect(limits.dailyLossLimitJpy).toBeCloseTo(100.1, 9);
  });
  it("元手の上限 10,000,000円 でも割合どおり", () => {
    expect(fixedLimitsJpy(10_000_000)).toEqual({ budgetJpy: 5_000_000, dailyLossLimitJpy: 1_000_000 });
  });
});

describe("AC-006-08: キーが空、または形式が違う時は保存しない", () => {
  const KEY_ID = "PKTESTKEY0000000ABCD";
  const SECRET = "TestSecret0000000000000000000000000000000";

  it("英字と数字の 16 から 64 文字なら受け付け、前後の空白を取る", () => {
    expect(validateCredentials({ keyId: ` ${KEY_ID}\n`, secret: `${SECRET} ` })).toEqual({
      ok: true,
      value: { keyId: KEY_ID, secret: SECRET },
    });
  });

  it("16 文字と 64 文字は受け付け、15 文字と 65 文字は受け付けない", () => {
    expect(validateCredentials({ keyId: "A".repeat(16), secret: "b".repeat(64) }).ok).toBe(true);
    const r = validateCredentials({ keyId: "A".repeat(15), secret: "b".repeat(65) });
    expect(r).toEqual({ ok: false, errors: { keyId: expect.any(String), secret: expect.any(String) } });
  });

  it.each([
    ["空", ""],
    ["途中に空白", "PKTEST KEY0000000ABCD"],
    ["記号", "PKTESTKEY0000000AB-D"],
    ["全角", "ＰＫTESTKEY0000000ABCD"],
  ])("キー ID が%sなら、キー ID のどこが違うかを出す", (_, keyId) => {
    const r = validateCredentials({ keyId, secret: SECRET });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.keyId).toContain("キー ID");
      expect(r.errors.secret).toBeUndefined();
    }
  });

  it("シークレットだけが違う時は、シークレットのエラーだけを出す", () => {
    const r = validateCredentials({ keyId: KEY_ID, secret: "" });
    expect(r).toEqual({ ok: false, errors: { secret: "シークレットを入れてください" } });
  });

  it("エラー文に入力の値を入れない(ADR-0006)", () => {
    const badSecret = "SECRETVALUE-SHOULD-NOT-LEAK";
    const r = validateCredentials({ keyId: "KEYVALUE-SHOULD-NOT-LEAK", secret: badSecret });
    expect(JSON.stringify(r)).not.toContain("SHOULD-NOT-LEAK");
  });
});

describe("AC-006-03: 画面にはキー ID の末尾4文字だけを出す", () => {
  it("末尾4文字", () => {
    expect(keyIdLast4("PKTESTKEY0000000ABCD")).toBe("ABCD");
  });
});
