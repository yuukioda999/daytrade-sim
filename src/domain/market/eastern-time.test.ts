import { describe, expect, it } from "vitest";
import { easternOffsetMinutes, fromEastern, toEastern, toEasternByIntl } from "./eastern-time";

describe("米国東部時間の変換を速くした計算(T11)", () => {
  it("SPEC-001: 2025 年から 2027 年の 15分ごとの全部の時刻で、Intl で分解した値と同じ", () => {
    const start = Date.UTC(2025, 0, 1);
    const end = Date.UTC(2028, 0, 1);
    let checked = 0;
    for (let t = start; t < end; t += 15 * 60_000) {
      const d = new Date(t);
      expect(toEastern(d)).toEqual(toEasternByIntl(d));
      checked++;
    }
    expect(checked).toBeGreaterThan(100_000);
  });

  it("SPEC-001: 夏時間の始まり(2026-03-08)と終わり(2026-11-01)の前後で、ずれが切り替わる", () => {
    // 2026-03-08 02:00 EST = 07:00Z に夏時間へ。2026-11-01 02:00 EDT = 06:00Z に冬時間へ
    expect(easternOffsetMinutes(new Date("2026-03-08T06:59:59Z"))).toBe(-300);
    expect(easternOffsetMinutes(new Date("2026-03-08T07:00:00Z"))).toBe(-240);
    expect(easternOffsetMinutes(new Date("2026-11-01T05:59:59Z"))).toBe(-240);
    expect(easternOffsetMinutes(new Date("2026-11-01T06:00:00Z"))).toBe(-300);
  });

  it("SPEC-001: 取引開始(09:30)は、冬時間は 14:30Z、夏時間は 13:30Z", () => {
    expect(fromEastern("2026-11-02", 9, 30).toISOString()).toBe("2026-11-02T14:30:00.000Z");
    expect(fromEastern("2026-07-01", 9, 30).toISOString()).toBe("2026-07-01T13:30:00.000Z");
  });
});
