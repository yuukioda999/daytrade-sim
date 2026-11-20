import { beforeEach, describe, expect, it } from "vitest";
import { tradingDays } from "@/domain/history/import-plan";
import { WATCHLIST } from "@/domain/market/symbols";
import { memoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { bar, et, pastDayBars, SOXL_DAY } from "@/testing/scripted-market";
import { backtestDates, runBacktest } from "./backtest-service";
import type { Repositories, SymbolBar } from "./ports";

let repos: Repositories;
const NOW = et(12, 0, "2026-11-20");
/** 取引量の基準の20取引日(どの時刻も取引量 60) */
const BASELINE_DAYS = tradingDays("2026-10-05", "2026-10-30");

/** SOXL_DAY と同じ形の足を、別の日に作る */
function soxlOn(date: string): SymbolBar[] {
  return SOXL_DAY.map((b) => {
    const t = new Date(b.start.getTime());
    const hh = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(t));
    const mm = t.getUTCMinutes();
    return bar("SOXL", date, hh, mm, b.open, b.high, b.low, b.close, b.volume, b.vwap);
  });
}

function store(symbol: string, date: string, bars: SymbolBar[]) {
  repos.bars.saveBars(bars);
  repos.bars.markFetched(symbol, [date]);
}

beforeEach(() => {
  repos = memoryRepositories(() => NOW);
  for (const d of BASELINE_DAYS) for (const s of WATCHLIST) store(s, d, pastDayBars(s, d));
  for (const d of ["2026-11-02", "2026-11-03"]) {
    store("SOXL", d, soxlOn(d));
    for (const s of WATCHLIST.filter((x) => x !== "SOXL")) store(s, d, pastDayBars(s, d));
  }
});

describe("過去データで試す(SPEC-006 AC-006-12、ADR-0010)", () => {
  it("AC-006-12: 4銘柄すべての足を取り終えた日を、古い順に試す。1銘柄でも足りない日は試さない", () => {
    repos.bars.markFetched("SOXL", ["2026-11-04"]);
    const dates = backtestDates({ repos }, "2026-11-20");
    expect(dates).toEqual([...BASELINE_DAYS, "2026-11-02", "2026-11-03"]);
  });

  it("AC-006-12: SPEC-003 例1、例2 のとおりに試し、損益を次の日に引き継ぐ。売買がない日も 0円の日として残す", () => {
    const r = runBacktest({ repos }, NOW);
    expect(r).toMatchObject({ ok: true, days: 22, trades: 2, principalJpy: 10_000, fxRateX100: 15_000 });
    const days = repos.backtest.listDays();
    expect(days).toHaveLength(22);
    expect(days[0]).toMatchObject({ date: "2026-10-05", pnlJpy: 0, limitReached: false });
    const nov2 = days.find((d) => d.date === "2026-11-02");
    const nov3 = days.find((d) => d.date === "2026-11-03");
    // 手計算: (77.10 - 78.45) × 0.4248 × 150 = -86.022 円
    expect(nov2?.pnlJpy).toBeCloseTo(-86.022, 6);
    expect(nov2?.startingRealizedJpy).toBe(0);
    expect(nov3?.startingRealizedJpy).toBeCloseTo(-86.022, 6);
    expect(nov3?.pnlJpy).toBeCloseTo(-86.022, 6);
    const trades = repos.backtest.listTrades("2026-11-02");
    expect(trades[0]).toMatchObject({ symbol: "SOXL", entryPrice: 78.45, shares: 0.4248, stopPrice: 77.1, late: false });
    expect(trades[0].exit).toMatchObject({ price: 77.1, reason: "stop" });
  });

  it("AC-004-04: 毎日ためた記録(trades、day_runs)には書かない", () => {
    runBacktest({ repos }, NOW);
    expect(repos.trading.listDayRuns()).toEqual([]);
    expect(repos.trading.listTrades("2026-11-02")).toEqual([]);
  });

  it("ADR-0010: 自動売買を OFF にしていても毎日 ON とみなす。受け取った時刻がない足でも「あとから処理」の印を付けない", () => {
    repos.settings.setAutoTradingEnabled(false);
    runBacktest({ repos }, NOW);
    const trades = repos.backtest.listTrades("2026-11-02");
    expect(trades).toHaveLength(1);
    expect(trades[0].late).toBe(false);
  });

  it("ADR-0010: 試す時の元手と為替は、設定で最後に保存した値(次の取引日から使う値も含む)", () => {
    repos.settings.putMoneySettings({ effectiveDate: "2026-11-02", principalJpy: 10_000, fxRateX100: 15_000 });
    repos.settings.putMoneySettings({ effectiveDate: "2026-11-23", principalJpy: 20_000, fxRateX100: 10_000 });
    const r = runBacktest({ repos }, NOW);
    expect(r).toMatchObject({ principalJpy: 20_000, fxRateX100: 10_000 });
    expect(repos.backtest.getRun()).toMatchObject({ principalJpy: 20_000, fxRateX100: 10_000, ranAt: NOW });
    // 手計算: 予算 10,000円、株数 = 10,000 / (78.45 × 100) = 1.27469 → 1.2746
    expect(repos.backtest.listTrades("2026-11-02")[0].shares).toBe(1.2746);
  });

  it("SPEC-004「損失の上限で止まった日」: 損失の上限に達した日に印を付ける", () => {
    // 09:55 の足が 60 から始まり、損切りの価格より下で売る(損失は 1,000円を超える)
    const d = "2026-11-02";
    const soxl = soxlOn(d);
    const fresh = memoryRepositories(() => NOW);
    for (const day of [...BASELINE_DAYS, d]) {
      for (const s of WATCHLIST) {
        const bars = s === "SOXL" && day === d ? [...soxl.slice(0, 5), { ...soxl[5], open: 60, high: 60.5, low: 59, close: 60 }] : pastDayBars(s, day);
        fresh.bars.saveBars(bars);
        fresh.bars.markFetched(s, [day]);
      }
    }
    runBacktest({ repos: fresh }, NOW);
    const day = fresh.backtest.listDays().find((x) => x.date === d);
    expect(day?.pnlJpy).toBeLessThan(-1_000);
    expect(day?.limitReached).toBe(true);
  });

  it("試すたびに、前の結果を置き換える", () => {
    runBacktest({ repos }, NOW);
    runBacktest({ repos }, NOW);
    expect(repos.backtest.listDays()).toHaveLength(22);
    expect(repos.backtest.listTrades("2026-11-02")).toHaveLength(1);
  });

  it("試せる日がなければ、何も保存せずに理由を返す", () => {
    const empty = memoryRepositories(() => NOW);
    expect(runBacktest({ repos: empty }, NOW)).toEqual({ ok: false, reason: "no-data" });
    expect(empty.backtest.getRun()).toBeNull();
  });
});
