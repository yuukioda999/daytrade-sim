import { toEastern } from "@/domain/market/eastern-time";
import { previousTradingDate, sessionOn } from "@/domain/market/market-calendar";
import { WATCHLIST } from "@/domain/market/symbols";
import { fixedLimitsJpy, fxRateFromX100 } from "@/domain/settings/settings";
import { evaluateBar, orbBreakoutTime, sessionVwap, type SignalConditions } from "@/domain/signal/buy-signal";
import { sameTimeVolumes } from "@/domain/signal/volume-history";
import { costJpy, exitThreshold, lossLimitReachedJpy, pnlJpy } from "@/domain/trading/paper-trading";
import type { DayRun, Repositories, TradeRecord, WorkerState } from "./ports";
import { computeDay, type StoredDeps } from "./worker-service";

/** ワーカーの心拍がこれより古ければ「止まっている」とする(1分ごとに動くので、3回分) */
const WORKER_STALE_MS = 3 * 60_000;

export type BarView = { time: string; open: number; high: number; low: number; close: number; volume: number };

export type SymbolView = {
  symbol: string;
  bars: BarView[];
  /** 足ごとの今日の平均価格(VWAP) */
  vwapLine: { time: string; value: number }[];
  lastPrice: number | null;
  /** 前の取引日の最後の値段 */
  previousClose: number | null;
  /** 前の取引日の最後の値段からの変化の割合(0.0142 は +1.42%) */
  changeRatio: number | null;
  /** 最後の足での3つの条件(SPEC-002 AC-002-07)。足がなければ null */
  conditions: SignalConditions | null;
  met: number;
  orbHigh: number | null;
  orbLow: number | null;
  vwap: number | null;
  volumeRatio: number | null;
  /** 朝の高値を初めて超えた足の時刻(AC-007-14) */
  breakoutTime: string | null;
  status: "holding" | "sold" | "watching";
};

export type PositionView = {
  symbol: string;
  shares: number;
  entryPrice: number;
  lastPrice: number;
  unrealizedJpy: number;
  changeRatio: number;
  /** 今の売りの基準と、その種類(損切り、利益を守る売り) */
  exitPrice: number;
  exitKind: "stop" | "trailing";
  peak: number;
};

export type TradeView = {
  symbol: string;
  signalTime: string;
  entryTime: string;
  entryPrice: number;
  shares: number;
  costJpy: number;
  stopPrice: number;
  exit: { time: string; price: number; reason: "stop" | "trailing" | "close"; pnlJpy: number } | null;
  late: boolean;
};

export type DashboardView = {
  now: string;
  /** 今日の市場か、過去データで試した結果か(AC-007-18、ADR-0010) */
  mode: "live" | "backtest";
  /** 過去データで試した日(古い順)。試していなければ空 */
  backtestDates: string[];
  /** 表示している取引日(米国東部時間)。まだ記録がなければ null */
  date: string | null;
  /** 表示している日が今日か */
  isToday: boolean;
  worker: {
    state: WorkerState | "never-started";
    message: string;
    /** 心拍が古い(自動売買のプロセスが止まっている。AC-007-09) */
    stopped: boolean;
    heartbeatAt: string | null;
    lastBarReceivedAt: string | null;
  };
  autoTradingEnabled: boolean;
  money: {
    principalJpy: number;
    balanceJpy: number;
    todayRealizedJpy: number;
    unrealizedJpy: number;
    dailyLossLimitJpy: number;
    /** 今日の損失の上限の使用割合(0 から 1。利益の時は 0) */
    lossLimitUsedRatio: number;
    limitReached: boolean;
  } | null;
  positions: PositionView[];
  trades: TradeView[];
  symbols: SymbolView[];
};

const iso = (d: Date) => d.toISOString();

function tradeView(r: TradeRecord, fxRate: number): TradeView {
  return {
    symbol: r.symbol,
    signalTime: iso(r.signalBarStart),
    entryTime: iso(r.entryTime),
    entryPrice: r.entryPrice,
    shares: r.shares,
    costJpy: costJpy({ entryPrice: r.entryPrice, shares: r.shares }, fxRate),
    stopPrice: r.stopPrice,
    exit: r.exit ? { time: iso(r.exit.time), price: r.exit.price, reason: r.exit.reason, pnlJpy: r.exit.pnlJpy } : null,
    late: r.late,
  };
}

/** 表示する日。今日の記録があれば今日、なければ一番新しい記録の日 */
function viewDate(repos: Repositories, today: string): DayRun | null {
  const runs = repos.trading.listDayRuns().filter((r) => r.date <= today);
  return runs.length > 0 ? runs[runs.length - 1] : null;
}

/**
 * 前の取引日(休場日の表で決める)の最後の足の終値。その日の足を取れていなければ null
 * (もっと前の日の終値を「前の取引日の終値」として出さない。T10 のレビュー 4)
 */
function previousClose(repos: Repositories, symbol: string, date: string): number | null {
  const s = sessionOn(previousTradingDate(date));
  if (!s) return null;
  const bars = repos.bars.barsBetween(symbol, s.open, s.close);
  return bars.length > 0 ? bars[bars.length - 1].close : null;
}

/** ダッシュボードと自動売買の記録の画面に出す値(SPEC-007 AC-007-08 から 17、19、20) */
export function getDashboardView(deps: StoredDeps, now: Date): DashboardView {
  const { repos } = deps;
  const today = toEastern(now).date;
  const status = repos.trading.getWorkerStatus();
  const stopped = !status || now.getTime() - status.heartbeatAt.getTime() > WORKER_STALE_MS;
  const worker: DashboardView["worker"] = {
    state: status?.state ?? "never-started",
    message: !status
      ? "自動売買のプロセスが一度も動いていません。npm run worker で起動してください"
      : stopped
        ? "自動売買が止まっています"
        : status.message,
    stopped,
    heartbeatAt: status ? iso(status.heartbeatAt) : null,
    lastBarReceivedAt: status?.lastBarReceivedAt ? iso(status.lastBarReceivedAt) : null,
  };
  const autoTradingEnabled = repos.settings.getAutoTradingEnabled() ?? true;

  const run = viewDate(repos, today);
  const empty = emptyView(now, worker, autoTradingEnabled, backtestDatesOf(repos));
  if (!run) return empty;

  // 売買の記録と、今日の損益、損失の上限は、ワーカーが保存した記録から作る(画面を開いた時刻で計算し直すと、
  // 「あとから処理」の印などが保存した記録と食い違うため。T10 のレビュー 2)。
  // 計算し直すのは、足から出す値(チャート、3つの条件)と、持っている株の今の損益と売りの基準だけ
  const stored = repos.trading.listTrades(run.date);
  return { ...empty, ...dayParts(deps, run, stored, now, "live"), isToday: run.date === today };
}

/**
 * 過去データで試した1日分を、ダッシュボードと同じ形で出す(AC-007-18、ADR-0010)。試していない日なら null。
 * 記録は試した結果の表から読み、毎日ためた記録とは混ぜない(SPEC-004 AC-004-04)
 */
export function getBacktestDashboardView(deps: StoredDeps, now: Date, date: string): DashboardView | null {
  const { repos } = deps;
  const runInfo = repos.backtest.getRun();
  const day = repos.backtest.listDays().find((d) => d.date === date);
  if (!runInfo || !day) return null;
  const run: DayRun = {
    date,
    principalJpy: runInfo.principalJpy,
    fxRateX100: runInfo.fxRateX100,
    startingRealizedJpy: day.startingRealizedJpy,
    baselineDates: day.baselineDates,
    closed: true,
    startedAt: runInfo.ranAt,
  };
  const status = repos.trading.getWorkerStatus();
  const base = emptyView(
    now,
    { state: status?.state ?? "never-started", message: "", stopped: false, heartbeatAt: null, lastBarReceivedAt: null },
    true,
    backtestDatesOf(repos),
  );
  return { ...base, ...dayParts(deps, run, repos.backtest.listTrades(date), now, "backtest"), mode: "backtest", isToday: false };
}

function backtestDatesOf(repos: Repositories): string[] {
  return repos.backtest.listDays().map((d) => d.date);
}

function emptyView(now: Date, worker: DashboardView["worker"], autoTradingEnabled: boolean, backtestDates: string[]): DashboardView {
  return {
    now: iso(now),
    mode: "live",
    backtestDates,
    date: null,
    isToday: false,
    worker,
    autoTradingEnabled,
    money: null,
    positions: [],
    trades: [],
    symbols: WATCHLIST.map((symbol) => ({
      symbol,
      bars: [],
      vwapLine: [],
      lastPrice: null,
      previousClose: null,
      changeRatio: null,
      conditions: null,
      met: 0,
      orbHigh: null,
      orbLow: null,
      vwap: null,
      volumeRatio: null,
      breakoutTime: null,
      status: "watching",
    })),
  };
}

/** その日の値(チャート、3つの条件、持っている株、記録、お金)。記録は保存したものを使う */
function dayParts(
  deps: StoredDeps,
  run: DayRun,
  stored: readonly TradeRecord[],
  now: Date,
  mode: "live" | "backtest",
): Pick<DashboardView, "date" | "money" | "positions" | "trades" | "symbols"> {
  const { repos } = deps;
  const day = computeDay(deps, run, run.closed, now, mode);
  const fxRate = fxRateFromX100(run.fxRateX100);
  const lastPriceOf = (symbol: string) => {
    const b = day.bars[symbol];
    return b.length > 0 ? b[b.length - 1].close : null;
  };

  const symbols: SymbolView[] = WATCHLIST.map((symbol) => {
    const bars = day.bars[symbol];
    const lastPrice = lastPriceOf(symbol);
    const prev = previousClose(repos, symbol, run.date);
    const vwapLine: { time: string; value: number }[] = [];
    for (let i = 0; i < bars.length; i++) {
      const v = sessionVwap(day.session, bars.slice(0, i + 1));
      if (v !== null) vwapLine.push({ time: iso(bars[i].start), value: v });
    }
    const evaluation =
      bars.length > 0
        ? evaluateBar({
            session: day.session,
            barsThroughT: bars,
            pastSameTimeVolumes: sameTimeVolumes(day.pastDays.get(symbol) ?? [], bars[bars.length - 1].start),
            alreadySignaledToday: false,
          })
        : null;
    const breakout = orbBreakoutTime(day.session, bars);
    const holding = stored.some((r) => r.symbol === symbol && r.exit === null);
    const sold = stored.some((r) => r.symbol === symbol && r.exit !== null);
    return {
      symbol,
      bars: bars.map((b) => ({ time: iso(b.start), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
      vwapLine,
      lastPrice,
      previousClose: prev,
      changeRatio: lastPrice !== null && prev ? lastPrice / prev - 1 : null,
      conditions: evaluation?.conditions ?? null,
      met: evaluation?.met ?? 0,
      orbHigh: evaluation?.orbHigh ?? null,
      orbLow: evaluation?.orbLow ?? null,
      vwap: evaluation?.vwap ?? null,
      volumeRatio: evaluation?.volumeRatio ?? null,
      breakoutTime: breakout ? iso(breakout) : null,
      status: holding ? "holding" : sold ? "sold" : "watching",
    };
  });

  const positions: PositionView[] = stored
    .filter((r) => r.exit === null)
    .map((r) => {
      const last = lastPriceOf(r.symbol) ?? r.entryPrice;
      // 最高値と売りの基準は、足から作り直した同じ銘柄の持ち株から取る。見つからなければ損切りの価格のまま
      const replayed = day.result.openPositions.find((p) => p.symbol === r.symbol);
      const threshold = replayed ? exitThreshold(replayed) : { price: r.stopPrice, reason: "stop" as const };
      return {
        symbol: r.symbol,
        shares: r.shares,
        entryPrice: r.entryPrice,
        lastPrice: last,
        unrealizedJpy: pnlJpy(r.entryPrice, last, r.shares, fxRate),
        changeRatio: last / r.entryPrice - 1,
        exitPrice: threshold.price,
        exitKind: threshold.reason,
        peak: replayed?.peak ?? r.entryPrice,
      };
    });

  const todayRealized = stored.reduce((a, r) => a + (r.exit?.pnlJpy ?? 0), 0);
  const { dailyLossLimitJpy } = fixedLimitsJpy(run.principalJpy);
  return {
    date: run.date,
    money: {
      principalJpy: run.principalJpy,
      balanceJpy: run.principalJpy + run.startingRealizedJpy + todayRealized,
      todayRealizedJpy: todayRealized,
      unrealizedJpy: positions.reduce((a, p) => a + p.unrealizedJpy, 0),
      dailyLossLimitJpy,
      lossLimitUsedRatio: Math.min(1, Math.max(0, -todayRealized / dailyLossLimitJpy)),
      limitReached: lossLimitReachedJpy(todayRealized, run.principalJpy),
    },
    positions,
    trades: stored.map((r) => tradeView(r, fxRate)),
    symbols,
  };
}
