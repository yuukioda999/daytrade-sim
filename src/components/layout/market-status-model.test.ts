import { describe, expect, it } from "vitest";
import { describeMarketStatus } from "./market-status-model";

describe("ヘッダーの市場の状態", () => {
  it("AC-001-13: 冬時間の 09:30 は「開いている」、時刻と冬時間を返す", () => {
    expect(describeMarketStatus(new Date("2026-11-02T14:30:00Z"))).toEqual({
      kind: "open",
      time: "09:30",
      dst: false,
    });
  });

  it("AC-001-12: 表にない年は「表が古い」を返す", () => {
    expect(describeMarketStatus(new Date("2030-01-07T15:00:00Z")).kind).toBe("stale");
  });

  it("時刻を計算できない時は、例外を投げずに「表示できない」を返す", () => {
    // 不正な日付で、タイムゾーンの変換がエラーになる場合を代わりに確かめる
    expect(describeMarketStatus(new Date(Number.NaN))).toEqual({ kind: "error" });
  });
});
