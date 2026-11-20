import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { et } from "@/testing/scripted-market";
import type { DayRun, Repositories, TradeRecord } from "./ports";
import { getResultsView } from "./results-service";

let repos: Repositories;
const NOW = et(12, 0, "2026-11-06");

const run = (date: string, startingRealizedJpy: number, closed = true): DayRun => ({
  date,
  principalJpy: 10_000,
  fxRateX100: 15_000,
  startingRealizedJpy,
  baselineDates: {},
  closed,
  startedAt: et(9, 30, date),
});

const sold = (date: string, pnlJpy: number, late = false): TradeRecord => ({
  date,
  symbol: "SOXL",
  signalBarStart: et(9, 45, date),
  entryTime: et(9, 50, date),
  entryPrice: 1,
  shares: 1,
  stopPrice: 1,
  exit: { time: et(10, 0, date), price: 1, reason: "stop", pnlJpy },
  late,
});

beforeEach(() => {
  repos = memoryRepositories(() => NOW);
});

/** SPEC-004 の計算の例: 11/02 +120、11/03 −310、11/04 0(売買なし)、11/05 −310 */
function seedExample() {
  repos.trading.putDayRun(run("2026-11-02", 0));
  repos.trading.replaceDayTrades("2026-11-02", [sold("2026-11-02", 120)]);
  repos.trading.putDayRun(run("2026-11-03", 120));
  repos.trading.replaceDayTrades("2026-11-03", [sold("2026-11-03", -310)]);
  repos.trading.putDayRun(run("2026-11-04", -190));
  repos.trading.putDayRun(run("2026-11-05", -190));
  repos.trading.replaceDayTrades("2026-11-05", [sold("2026-11-05", -200, true), sold("2026-11-05", -110)]);
}

describe("毎日ためた記録の成績(SPEC-004)", () => {
  it("AC-004-01: 例の4日分のまとめ。売買がなかった日も 0円の行を作る", () => {
    seedExample();
    const v = getResultsView({ repos }, NOW);
    expect(v.live?.summary).toMatchObject({
      recordedDays: 4,
      totalPnlJpy: -500,
      totalPnlRatio: -0.05,
      plusDays: 1,
      minusDays: 2,
      zeroDays: 1,
      worstDay: { date: "2026-11-03", pnlJpy: -310 },
      limitReachedDays: 0,
    });
    // 手計算: 残高 10,000 → 10,120 → 9,810 → 9,810 → 9,500
    expect(v.live?.rows.map((r) => [r.date, r.pnlJpy, r.endingBalanceJpy])).toEqual([
      ["2026-11-02", 120, 10_120],
      ["2026-11-03", -310, 9_810],
      ["2026-11-04", 0, 9_810],
      ["2026-11-05", -310, 9_500],
    ]);
  });

  it("AC-004-02: 記録が0日なら null", () => {
    expect(getResultsView({ repos }, NOW).live).toBeNull();
  });

  it("AC-004-03: 締める前の日(今日の取引の途中)に印を付ける。まとめには入れない(SPEC-004 2026-11-20 追記)", () => {
    seedExample();
    repos.trading.putDayRun(run("2026-11-06", -500, false));
    repos.trading.replaceDayTrades("2026-11-06", [sold("2026-11-06", -900)]);
    const v = getResultsView({ repos }, NOW);
    const rows = v.live?.rows ?? [];
    expect(rows.at(-1)).toMatchObject({ date: "2026-11-06", inProgress: true, pnlJpy: -900 });
    expect(rows.slice(0, -1).every((r) => !r.inProgress)).toBe(true);
    // まとめは例の4日のまま(途中の -900 円は、合計にも一番損した日にも入れない)
    expect(v.live?.summary).toMatchObject({ recordedDays: 4, totalPnlJpy: -500, worstDay: { date: "2026-11-03", pnlJpy: -310 } });
  });

  it("SPEC-004 2026-11-20 追記: 途中で元手を変えた時、残高はその日の元手、割合は一番新しい日の元手で出す", () => {
    repos.trading.putDayRun(run("2026-11-02", 0));
    repos.trading.replaceDayTrades("2026-11-02", [sold("2026-11-02", 100)]);
    repos.trading.putDayRun({ ...run("2026-11-03", 100), principalJpy: 20_000 });
    repos.trading.replaceDayTrades("2026-11-03", [sold("2026-11-03", 300)]);
    const v = getResultsView({ repos }, NOW);
    // 手計算: 11/02 は 10,000 + 100 = 10,100。11/03 は 20,000 + 100 + 300 = 20,400
    expect(v.live?.rows.map((r) => r.endingBalanceJpy)).toEqual([10_100, 20_400]);
    // 手計算: 合計 400 / 一番新しい日の元手 20,000 = 2%
    expect(v.live?.principalJpy).toBe(20_000);
    expect(v.live?.summary.totalPnlRatio).toBeCloseTo(0.02, 10);
  });

  it("AC-004-07: 「あとから処理」の印がある記録を含む日に印を付ける", () => {
    seedExample();
    const rows = getResultsView({ repos }, NOW).live?.rows ?? [];
    expect(rows.filter((r) => r.late).map((r) => r.date)).toEqual(["2026-11-05"]);
  });

  it("SPEC-004「損失の上限で止まった日」: その日の損益が上限(元手の10%)以上の損失の日を数える", () => {
    repos.trading.putDayRun(run("2026-11-02", 0));
    repos.trading.replaceDayTrades("2026-11-02", [sold("2026-11-02", -1000)]);
    repos.trading.putDayRun(run("2026-11-03", -1000));
    repos.trading.replaceDayTrades("2026-11-03", [sold("2026-11-03", -999)]);
    const v = getResultsView({ repos }, NOW);
    expect(v.live?.rows.map((r) => r.limitReached)).toEqual([true, false]);
    expect(v.live?.summary.limitReachedDays).toBe(1);
  });
});

describe("過去データで試した結果(AC-004-04)", () => {
  it("AC-004-04: 毎日ためた記録と混ぜずに、別の欄の値として返す", () => {
    seedExample();
    repos.backtest.replaceAll(
      { ranAt: NOW, principalJpy: 20_000, fxRateX100: 15_000 },
      [
        { date: "2026-10-01", startingRealizedJpy: 0, baselineDates: {}, pnlJpy: 400, limitReached: false },
        { date: "2026-10-02", startingRealizedJpy: 400, baselineDates: {}, pnlJpy: -2_000, limitReached: true },
      ],
      [],
    );
    const v = getResultsView({ repos }, NOW);
    expect(v.live?.summary.recordedDays).toBe(4);
    expect(v.backtest).toMatchObject({ principalJpy: 20_000, ranAt: NOW.toISOString() });
    expect(v.backtest?.summary).toMatchObject({ recordedDays: 2, totalPnlJpy: -1_600, totalPnlRatio: -0.08, limitReachedDays: 1 });
    // 手計算: 20,000 + 400 = 20,400、20,400 - 2,000 = 18,400
    expect(v.backtest?.rows.map((r) => r.endingBalanceJpy)).toEqual([20_400, 18_400]);
  });

  it("試していなければ null", () => {
    seedExample();
    expect(getResultsView({ repos }, NOW).backtest).toBeNull();
  });
});
