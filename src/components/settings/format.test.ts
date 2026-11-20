import { describe, expect, it } from "vitest";
import { formatDateJa, formatFxRate, formatJpy } from "./format";

describe("設定の画面の表し方", () => {
  it("円は桁区切り", () => {
    expect(formatJpy(10_000_000)).toBe("10,000,000円");
  });
  it("為替レートは小数2桁", () => {
    expect(formatFxRate(150)).toBe("150.00");
    expect(formatFxRate(140.5)).toBe("140.50");
  });
  it("日付は月日と曜日。日本時間で動かしても曜日がずれない", () => {
    expect(formatDateJa("2026-11-23")).toBe("11月23日(月)");
    expect(formatDateJa("2027-01-04")).toBe("1月4日(月)");
  });
});
