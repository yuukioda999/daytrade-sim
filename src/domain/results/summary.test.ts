import { describe, expect, it } from "vitest";
import type { ClosedTrade } from "@/domain/trading/paper-trading";
import { dayRows, groupByDay, summarize, type DayResult } from "./summary";

// SPEC-004 計算の例
const EXAMPLE: DayResult[] = [
  { date: "2026-11-02", pnlJpy: 120, limitReached: false },
  { date: "2026-11-03", pnlJpy: -310, limitReached: false },
  { date: "2026-11-04", pnlJpy: 0, limitReached: false },
  { date: "2026-11-05", pnlJpy: -310, limitReached: false },
];

const trade = (exitIso: string, pnlJpy: number): ClosedTrade => ({
  symbol: "TQQQ",
  entryTime: new Date(exitIso),
  entryPrice: 1,
  shares: 1,
  exitTime: new Date(exitIso),
  exitPrice: 1,
  reason: "close",
  pnlJpy,
});

describe("SPEC-004 成績", () => {
  it("AC-004-01: 例の4日分のまとめ(合計 -500円、-5.0%、プラス1、マイナス2、0円1、一番損した日 11/03)", () => {
    const s = summarize(EXAMPLE, 10_000);
    expect(s).toEqual({
      recordedDays: 4,
      totalPnlJpy: -500,
      totalPnlRatio: -0.05,
      plusDays: 1,
      minusDays: 2,
      zeroDays: 1,
      worstDay: { date: "2026-11-03", pnlJpy: -310 },
      limitReachedDays: 0,
    });
  });

  it("AC-004-01: 渡す順が新しい順でも、一番損した日は同じ値なら古い日", () => {
    expect(summarize([...EXAMPLE].reverse(), 10_000).worstDay).toEqual({ date: "2026-11-03", pnlJpy: -310 });
  });

  it("AC-004-01: 損失の上限で止まった日を数える", () => {
    const days = EXAMPLE.map((d) => (d.date === "2026-11-03" ? { ...d, limitReached: true } : d));
    expect(summarize(days, 10_000).limitReachedDays).toBe(1);
  });

  it("記録が0日なら、一番損した日は null、合計 0", () => {
    expect(summarize([], 10_000)).toMatchObject({ recordedDays: 0, totalPnlJpy: 0, worstDay: null });
  });

  it("小数の誤差で 0 に近い日は、0円の日に数える", () => {
    const s = summarize([{ date: "2026-11-02", pnlJpy: 1e-12, limitReached: false }], 10_000);
    expect(s).toMatchObject({ plusDays: 0, zeroDays: 1 });
  });

  it("同じ日が重なっていたらエラーにする", () => {
    expect(() => summarize([EXAMPLE[0], EXAMPLE[0]], 10_000)).toThrow(/重なって/);
  });

  it("売った記録を、米国東部時間の暦日ごとに合計する", () => {
    const days = groupByDay([
      trade("2026-11-02T14:55:00Z", 100), // 11/02 09:55 ET
      trade("2026-11-02T20:55:00Z", -30), // 11/02 15:55 ET
      trade("2026-11-03T15:00:00Z", -50), // 11/03 10:00 ET
      trade("2026-11-03T02:00:00Z", 5), // UTC では 11/03 だが、米国東部時間では 11/02 21:00
    ]);
    expect(days).toEqual([
      { date: "2026-11-02", pnlJpy: 75, limitReached: false },
      { date: "2026-11-03", pnlJpy: -50, limitReached: false },
    ]);
  });

  it("損失の上限で止まった日の印を付ける", () => {
    const days = groupByDay([trade("2026-11-02T15:00:00Z", -1000)], new Set(["2026-11-02"]));
    expect(days).toEqual([{ date: "2026-11-02", pnlJpy: -1000, limitReached: true }]);
  });

  it("日ごとの表は、古い順に、その日の終わりの残高を付ける", () => {
    expect(dayRows(EXAMPLE, 10_000).map((r) => [r.date, r.endingBalanceJpy])).toEqual([
      ["2026-11-02", 10_120],
      ["2026-11-03", 9_810],
      ["2026-11-04", 9_810],
      ["2026-11-05", 9_500],
    ]);
  });
});
