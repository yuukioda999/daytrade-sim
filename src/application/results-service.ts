import { toEastern } from "@/domain/market/eastern-time";
import { summarize, type ResultsSummary } from "@/domain/results/summary";
import { lossLimitReachedJpy } from "@/domain/trading/paper-trading";
import type { StoredDeps } from "./worker-service";

/** 成績の表の1行(SPEC-004) */
export type ResultRow = {
  date: string;
  pnlJpy: number;
  /** その日の終わりの残高(円) */
  endingBalanceJpy: number;
  limitReached: boolean;
  /** 「あとから処理」の印がある記録を含む(AC-004-07) */
  late: boolean;
  /** 締める前の日(今日の取引の途中。AC-004-03) */
  inProgress: boolean;
};

export type ResultsSection = {
  /** まとめの「元手に対する割合」に使う元手 */
  principalJpy: number;
  summary: ResultsSummary;
  /** 古い順 */
  rows: ResultRow[];
};

export type ResultsView = {
  /** 毎日ためた記録。記録が0日なら null(AC-004-02) */
  live: ResultsSection | null;
  /** 過去データで試した結果。試していなければ null(AC-004-04) */
  backtest: (ResultsSection & { ranAt: string; fxRateX100: number }) | null;
};

/**
 * 成績の画面に出す値(SPEC-004)。毎日ためた記録と、過去データで試した結果を混ぜずに分けて返す(AC-004-04)。
 * 毎日ためた記録の行は、自動売買が動いた日(day_runs)ごとに作る。売買がなかった日も 0円の行にする
 */
export function getResultsView(deps: StoredDeps, now: Date): ResultsView {
  const { repos } = deps;
  const today = toEastern(now).date;
  const runs = repos.trading.listDayRuns().filter((r) => r.date <= today);
  let live: ResultsView["live"] = null;
  if (runs.length > 0) {
    const rows: ResultRow[] = runs.map((run) => {
      const trades = repos.trading.listTrades(run.date);
      const pnl = trades.reduce((a, t) => a + (t.exit?.pnlJpy ?? 0), 0);
      return {
        date: run.date,
        pnlJpy: pnl,
        endingBalanceJpy: run.principalJpy + run.startingRealizedJpy + pnl,
        limitReached: lossLimitReachedJpy(pnl, run.principalJpy),
        late: trades.some((t) => t.late),
        inProgress: !run.closed,
      };
    });
    // 元手を途中で変えた時は、一番新しい日の元手に対する割合を出す(spec に書いていないことで決めたこと。ai-log)
    const principalJpy = runs[runs.length - 1].principalJpy;
    live = { principalJpy, summary: summarize(rows, principalJpy), rows };
  }

  const run = repos.backtest.getRun();
  const days = repos.backtest.listDays();
  let backtest: ResultsView["backtest"] = null;
  if (run && days.length > 0) {
    const rows: ResultRow[] = days.map((d) => ({
      date: d.date,
      pnlJpy: d.pnlJpy,
      endingBalanceJpy: run.principalJpy + d.startingRealizedJpy + d.pnlJpy,
      limitReached: d.limitReached,
      late: false,
      inProgress: false,
    }));
    backtest = {
      principalJpy: run.principalJpy,
      fxRateX100: run.fxRateX100,
      ranAt: run.ranAt.toISOString(),
      summary: summarize(rows, run.principalJpy),
      rows,
    };
  }
  return { live, backtest };
}
