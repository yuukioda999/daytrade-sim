import { toEastern } from "@/domain/market/eastern-time";
import { CalendarOutOfRangeError, sessionOn } from "@/domain/market/market-calendar";
import { WATCHLIST } from "@/domain/market/symbols";
import { fixedLimitsJpy, fxRateFromX100 } from "@/domain/settings/settings";
import { evaluateBar, sessionVwap, type SignalConditions } from "@/domain/signal/buy-signal";
import { sameTimeVolumes } from "@/domain/signal/volume-history";
import { balanceJpy, costJpy, dailyLossLimitReached, exitThreshold, pnlJpy } from "@/domain/trading/paper-trading";
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

function previousClose(repos: Repositories, symbol: string, date: string): number | null {
  const dates = repos.bars.fetchedDatesBefore(symbol, date, 1);
  const d = dates[0];
  const s = d ? sessionOn(d) : null;
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

  let run: DayRun | null = null;
  try {
    run = viewDate(repos, today);
  } catch (e) {
    if (!(e instanceof CalendarOutOfRangeError)) throw e;
  }
  const empty: DashboardView = {
    now: iso(now),
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
  if (!run) return empty;

  const day = computeDay(deps, run, run.closed, now);
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
    // 朝の高値を初めて超えた足(朝の値幅の時間のあと)
    const orbHigh = evaluation?.orbHigh ?? null;
    const breakout =
      orbHigh === null
        ? undefined
        : bars.find((b) => b.start.getTime() >= day.session.orbEnd.getTime() && b.close > orbHigh);
    const holding = day.result.openPositions.some((p) => p.symbol === symbol);
    const sold = day.records.some((r) => r.symbol === symbol && r.exit !== null);
    return {
      symbol,
      bars: bars.map((b) => ({ time: iso(b.start), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
      vwapLine,
      lastPrice,
      previousClose: prev,
      changeRatio: lastPrice !== null && prev ? lastPrice / prev - 1 : null,
      conditions: evaluation?.conditions ?? null,
      met: evaluation?.met ?? 0,
      orbHigh,
      orbLow: evaluation?.orbLow ?? null,
      vwap: evaluation?.vwap ?? null,
      volumeRatio: evaluation?.volumeRatio ?? null,
      breakoutTime: breakout ? iso(breakout.start) : null,
      status: holding ? "holding" : sold ? "sold" : "watching",
    };
  });

  const positions: PositionView[] = day.result.openPositions.map((p) => {
    const last = lastPriceOf(p.symbol) ?? p.entryPrice;
    const threshold = exitThreshold(p);
    return {
      symbol: p.symbol,
      shares: p.shares,
      entryPrice: p.entryPrice,
      lastPrice: last,
      unrealizedJpy: pnlJpy(p.entryPrice, last, p.shares, fxRate),
      changeRatio: last / p.entryPrice - 1,
      exitPrice: threshold.price,
      exitKind: threshold.reason,
      peak: p.peak,
    };
  });

  const todayRealized = day.result.account.realizedTodayJpy;
  const { dailyLossLimitJpy } = fixedLimitsJpy(run.principalJpy);
  return {
    now: iso(now),
    date: run.date,
    isToday: run.date === today,
    worker,
    autoTradingEnabled,
    money: {
      principalJpy: run.principalJpy,
      balanceJpy: balanceJpy(day.result.account),
      todayRealizedJpy: todayRealized,
      unrealizedJpy: positions.reduce((a, p) => a + p.unrealizedJpy, 0),
      dailyLossLimitJpy,
      lossLimitUsedRatio: Math.min(1, Math.max(0, -todayRealized / dailyLossLimitJpy)),
      limitReached: dailyLossLimitReached(day.result.account),
    },
    positions,
    trades: day.records.map((r) => tradeView(r, fxRate)),
    symbols,
  };
}
