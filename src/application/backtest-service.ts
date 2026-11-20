import { toEastern } from "@/domain/market/eastern-time";
import { previousTradingDate } from "@/domain/market/market-calendar";
import { WATCHLIST } from "@/domain/market/symbols";
import { COVERED_YEARS } from "@/domain/market/calendar-data";
import { effectiveMoneyOn } from "@/domain/settings/settings";
import { dailyLossLimitReached } from "@/domain/trading/paper-trading";
import type { BacktestDay, BarRepository, DayRun, Repositories, SymbolBar, TradeRecord } from "./ports";
import { baselineDatesFor, computeDay, type StoredDeps } from "./worker-service";

export const BACKTEST_NO_DATA_MESSAGE =
  "試せる日がありません。設定の画面の「過去データ」で、4銘柄の過去の値動きを取ってから試してください";

export type BacktestOutcome =
  | { ok: true; days: number; trades: number; principalJpy: number; fxRateX100: number }
  | { ok: false; reason: "no-data" };

/** 4銘柄すべての足を取り終えた日(古い順)。今日より前の日だけ */
export function backtestDates(deps: StoredDeps, today: string): string[] {
  const first = `${Math.min(...COVERED_YEARS)}-01-01`;
  const last = previousTradingDate(today);
  if (last < first) return [];
  const sets = WATCHLIST.map((symbol) => new Set(deps.repos.bars.fetchedDates(symbol, first, last)));
  return [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
}

/** 試す時の元手と為替。設定の画面で最後に保存した値(次の取引日から使う値を含む。ADR-0010) */
function latestMoney(deps: StoredDeps, today: string) {
  const history = deps.repos.settings.listMoneySettings();
  if (history.length === 0) return effectiveMoneyOn(history, today);
  return [...history].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[history.length - 1];
}

/**
 * 過去データで試す(SPEC-006 AC-006-12、ADR-0010)。保存した足だけを使い、通信しない。
 * 4銘柄すべての足を取り終えた日を古い順に、毎日ためた記録と同じルール(SPEC-002、SPEC-003)で処理する。
 * 損益は次の日に引き継ぐ。自動売買は毎日 ON とみなし、「あとから処理」の印は付けない。
 * 結果は毎日ためた記録とは別の表に保存し、前の結果を置き換える(SPEC-004 AC-004-04)
 */
export function runBacktest(original: StoredDeps, now: Date): BacktestOutcome {
  const deps = { repos: withBarCache(original.repos) };
  const today = toEastern(now).date;
  const dates = backtestDates(deps, today);
  if (dates.length === 0) return { ok: false, reason: "no-data" };
  const money = latestMoney(deps, today);
  const days: BacktestDay[] = [];
  const records: TradeRecord[] = [];
  let carried = 0;
  for (const date of dates) {
    const run: DayRun = {
      date,
      principalJpy: money.principalJpy,
      fxRateX100: money.fxRateX100,
      startingRealizedJpy: carried,
      baselineDates: baselineDatesFor(deps, date),
      closed: true,
      startedAt: now,
    };
    const day = computeDay(deps, run, true, now, "backtest");
    const pnl = day.records.reduce((a, r) => a + (r.exit?.pnlJpy ?? 0), 0);
    days.push({
      date,
      startingRealizedJpy: carried,
      baselineDates: run.baselineDates,
      pnlJpy: pnl,
      limitReached: dailyLossLimitReached(day.result.account),
    });
    records.push(...day.records);
    carried += pnl;
  }
  deps.repos.backtest.replaceAll({ ranAt: now, principalJpy: money.principalJpy, fxRateX100: money.fxRateX100 }, days, records);
  return { ok: true, days: days.length, trades: records.length, principalJpy: money.principalJpy, fxRateX100: money.fxRateX100 };
}

/**
 * 足の読み出しを覚えておく保存先(試している間だけ使う)。取引量の基準の20日は隣の日と重なるので、
 * 同じ日の足を何度も DB から読まないようにする(T11 で、41日分で約1.2秒のうちの多くが読み出しだった)
 */
function withBarCache(repos: Repositories): Repositories {
  const cache = new Map<string, SymbolBar[]>();
  const bars: BarRepository = Object.create(repos.bars) as BarRepository;
  bars.barsBetween = (symbol: string, start: Date, end: Date) => {
    const key = `${symbol}|${start.getTime()}|${end.getTime()}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = repos.bars.barsBetween(symbol, start, end);
      cache.set(key, hit);
    }
    return hit;
  };
  return { ...repos, bars };
}
