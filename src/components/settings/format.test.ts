import { describe, expect, it } from "vitest";
import { formatDateJa, formatEasternDateTime, formatFxRate, formatJpy } from "./format";

describe("設定の画面の表し方", () => {
  it("円は桁区切り", () => {
    expect(formatJpy(10_000_000)).toBe("10,000,000円");
    // 元手 1,001円 の予算(500.5円)と損失の上限(100.1円)
    expect(formatJpy(500.5)).toBe("501円");
    expect(formatJpy(1_001 * 0.1)).toBe("100円");
  });
  it("為替レートは小数2桁", () => {
    expect(formatFxRate(150)).toBe("150.00");
    expect(formatFxRate(140.5)).toBe("140.50");
  });
  it("日付は月日と曜日。日本時間で動かしても曜日がずれない", () => {
    expect(formatDateJa("2026-11-23")).toBe("11月23日(月)");
    expect(formatDateJa("2027-01-04")).toBe("1月4日(月)");
    expect(formatDateJa("2025-11-19", { withYear: true })).toBe("2025年11月19日(水)");
  });
});

describe("米国東部時間の日時", () => {
  it("冬時間と夏時間で、東部時間に直して出す", () => {
    expect(formatEasternDateTime("2026-11-20T16:40:00Z")).toBe("11/20 11:40");
    expect(formatEasternDateTime("2026-07-01T13:30:00Z")).toBe("7/1 09:30");
  });
});
