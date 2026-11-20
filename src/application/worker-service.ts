import { regularSessionBars } from "@/domain/history/import-plan";
import type { Bar } from "@/domain/market/bar";
import { toEastern } from "@/domain/market/eastern-time";
import { CalendarOutOfRangeError, closedReason, sessionOn, type MarketSession } from "@/domain/market/market-calendar";
import { WATCHLIST } from "@/domain/market/symbols";
import { effectiveMoneyOn, fxRateFromX100 } from "@/domain/settings/settings";
import { VOLUME_LOOKBACK_DAYS } from "@/domain/signal/buy-signal";
import { sameTimeVolumes, type PastDay } from "@/domain/signal/volume-history";
import { replayDay } from "@/domain/trading/day-replay";
import { newAccount } from "@/domain/trading/paper-trading";
import { importChunk, marketDataErrorMessage } from "./market-data-service";
import { BLOCKED_NO_CREDENTIALS } from "./settings-service";
import {
  MarketDataError,
  type DayRun,
  type MarketDataSource,
  type Repositories,
  type TradeRecord,
  type WorkerState,
} from "./ports";

const MINUTE = 60_000;
const BAR_MS = 5 * MINUTE;
/** 無料のプランでは、15分以内の全市場のデータを取れない(ADR-0005) */
const DATA_DELAY_MS = 15 * MINUTE;
/** 最後の足が届くのを、取引終了から待つ時間(SPEC-003 定義 14) */
const CLOSE_WAIT_MS = 30 * MINUTE;
/**
 * 足の始まりからこの時間より後に受け取った足で起きた売買に「あとから処理」の印を付ける(SPEC-003 定義 11)。
 * 足の長さ 5分 + データの遅れ 15分 + 余裕 10分
 */
const LATE_AFTER_MS = 30 * MINUTE;
/** 足りない過去の足を取りに行く間隔(取れない時に毎分通信しないため) */
const BACKFILL_RETRY_MS = 30 * MINUTE;

export const WORKER_MESSAGES = {
  running: "動いています",
  beforeOpen: "取引開始を待っています",
  closedDay: "今日は休みのため、自動売買は休んでいます",
  dayDone: "今日の取引は終わりました",
  calendarOutdated: "休場日の表が古いため、自動売買は止まっています。休場日の表の更新が必要です",
} as const;

export type WorkerDeps = { repos: Repositories; source: MarketDataSource };

/** ワーカーのプロセスの中だけで覚えておくこと(DB に書かない) */
export type WorkerMemory = { lastBackfillAttempt: Map<string, number> };

export function newWorkerMemory(): WorkerMemory {
  return { lastBackfillAttempt: new Map() };
}

function setStatus(deps: WorkerDeps, now: Date, state: WorkerState, message: string, lastBarReceivedAt?: Date): void {
  const prev = deps.repos.trading.getWorkerStatus();
  deps.repos.trading.putWorkerStatus({
    heartbeatAt: now,
    lastBarReceivedAt: lastBarReceivedAt ?? prev?.lastBarReceivedAt ?? null,
    state,
    message,
  });
}

/** 自動売買の ON / OFF の、ある時刻の状態(ADR-0009) */
export function buyingAllowedAtFactory(deps: WorkerDeps): (t: Date) => boolean {
  const changes = deps.repos.settings.listAutoTradingChanges();
  const fallback = deps.repos.settings.getAutoTradingEnabled() ?? true;
  return (t) => {
    if (changes.length === 0) return fallback;
    let state = !changes[0].enabled;
    for (const c of changes) {
      if (c.at.getTime() <= t.getTime()) state = c.enabled;
      else break;
    }
    return state;
  };
}

/** ある取引日の足(通常の取引時間)を、銘柄ごとに読み出す */
function dayBars(deps: WorkerDeps, session: MarketSession): Record<string, Bar[]> {
  const result: Record<string, Bar[]> = {};
  for (const symbol of WATCHLIST) {
    result[symbol] = deps.repos.bars.barsBetween(symbol, session.open, session.close);
  }
  return result;
}

/** 取引量の基準に使う、過去の取り終えた日の足(最大20日) */
function pastDaysOf(deps: WorkerDeps, symbol: string, date: string): PastDay[] {
  return deps.repos.bars.fetchedDatesBefore(symbol, date, VOLUME_LOOKBACK_DAYS).flatMap((d) => {
    const s = sessionOn(d);
    return s ? [{ date: d, bars: deps.repos.bars.barsBetween(symbol, s.open, s.close) }] : [];
  });
}

/** date より前の取引日を、新しい方から n 日(古い順で返す) */
function previousTradingDays(date: string, n: number): string[] {
  const days: string[] = [];
  let d = date;
  while (days.length < n) {
    d = new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    try {
      if (closedReason(d) === null) days.unshift(d);
    } catch (e) {
      // 休場日の表がない年まで戻ったら、そこで止める(その分は平均の日数が減る。SPEC-002 定義 4)
      if (e instanceof CalendarOutOfRangeError) break;
      throw e;
    }
  }
  return days;
}

/**
 * 取引量の基準のために、過去20取引日の足のうち、取っていない日を Alpaca から取って埋める(ADR-0009)。
 * 取れなくても売買は止めない(基準は、ある日数で平均する。SPEC-002 定義 4)
 */
async function backfillPastDays(deps: WorkerDeps, memory: WorkerMemory, today: string, now: Date): Promise<void> {
  const last = memory.lastBackfillAttempt.get(today);
  if (last !== undefined && now.getTime() - last < BACKFILL_RETRY_MS) return;
  memory.lastBackfillAttempt.set(today, now.getTime());
  const days = previousTradingDays(today, VOLUME_LOOKBACK_DAYS);
  if (days.length === 0) return;
  for (const symbol of WATCHLIST) {
    const done = new Set(deps.repos.bars.fetchedDates(symbol, days[0], days[days.length - 1]));
    const missing = days.filter((d) => !done.has(d));
    const months = new Map<string, string[]>();
    for (const d of missing) months.set(d.slice(0, 7), [...(months.get(d.slice(0, 7)) ?? []), d]);
    for (const list of months.values()) {
      await importChunk(deps.repos, deps.source, { symbol, from: list[0], to: list[list.length - 1] }, now);
    }
  }
}

/** その日を始める。元手と為替を決めて記録する(SPEC-006 決めたこと 6、SPEC-003 定義 12) */
function startDayRun(deps: WorkerDeps, today: string, now: Date): DayRun {
  const history = deps.repos.settings.listMoneySettings();
  const money = effectiveMoneyOn(history, today);
  // まだ一度も保存していなければ、その日に使う既定の値を保存する。以降の変更は次の取引日から使われる
  if (history.length === 0) {
    deps.repos.settings.putMoneySettings({
      effectiveDate: today,
      principalJpy: money.principalJpy,
      fxRateX100: money.fxRateX100,
    });
  }
  const run: DayRun = {
    date: today,
    principalJpy: money.principalJpy,
    fxRateX100: money.fxRateX100,
    startingRealizedJpy: deps.repos.trading.realizedBefore(today),
    closed: false,
    startedAt: now,
  };
  deps.repos.trading.putDayRun(run);
  return run;
}

/** その日の足を取って保存する。受け取った時刻を付ける。新しく保存した本数を返す */
async function fetchDayBars(deps: WorkerDeps, session: MarketSession, now: Date): Promise<number> {
  const credentials = deps.repos.credentials.get();
  if (!credentials) return 0;
  // 終わりが15分以上前の足だけを取る。足の途中までの値を保存しないため(同じ足は二度と保存し直さない)
  const lastCompleteEnd = Math.floor((now.getTime() - DATA_DELAY_MS) / BAR_MS) * BAR_MS;
  const end = new Date(Math.min(lastCompleteEnd, session.close.getTime()));
  if (end.getTime() <= session.open.getTime()) return 0;
  let saved = 0;
  for (const symbol of WATCHLIST) {
    const bars = await deps.source.fetchBars(credentials, symbol, session.open, end);
    const regular = regularSessionBars(bars.filter((b) => b.symbol === symbol)).map((b) => ({ ...b, receivedAt: now }));
    saved += deps.repos.bars.saveBars(regular);
  }
  return saved;
}

/** その日を作り直して、記録を置き換える(ADR-0009)。closeOut なら売っていない株を売って締める */
export function rebuildDay(deps: WorkerDeps, run: DayRun, closeOut: boolean, now: Date): void {
  const session = sessionOn(run.date);
  if (!session) throw new Error(`${run.date} は取引日ではありません`);
  const bars = dayBars(deps, session);
  const past = new Map(WATCHLIST.map((s) => [s, pastDaysOf(deps, s, run.date)] as const));
  const account = {
    ...newAccount(run.principalJpy, fxRateFromX100(run.fxRateX100), run.date),
    realizedTotalJpy: run.startingRealizedJpy,
  };
  const result = replayDay({
    session,
    account,
    bars,
    pastVolumes: (symbol, start) => sameTimeVolumes(past.get(symbol as (typeof WATCHLIST)[number]) ?? [], start),
    buyingAllowedAt: buyingAllowedAtFactory(deps),
    closeOut,
  });

  const receivedAt = (symbol: string, start: Date): Date | undefined =>
    (bars[symbol] as { start: Date; receivedAt?: Date }[]).find((b) => b.start.getTime() === start.getTime())?.receivedAt;
  const isLate = (symbol: string, start: Date): boolean => {
    const r = receivedAt(symbol, start);
    return r !== undefined && r.getTime() - start.getTime() > LATE_AFTER_MS;
  };

  // 届いた最後の足で締めて売った時(最後の足が届かなかった時)、締めたのが取引終了から30分より大きく遅れたら、あとから処理した印を付ける
  const lateCloseOut = closeOut && now.getTime() - session.close.getTime() > CLOSE_WAIT_MS + 10 * MINUTE;
  const lastBarStart = session.close.getTime() - BAR_MS;

  const records: TradeRecord[] = result.buys.map((b) => {
    const t = result.trades.find((x) => x.symbol === b.symbol && x.entryTime.getTime() === b.entryTime.getTime());
    return {
      date: run.date,
      symbol: b.symbol,
      signalBarStart: b.signalBarStart,
      entryTime: b.entryTime,
      entryPrice: b.entryPrice,
      shares: b.shares,
      stopPrice: b.stopPrice,
      exit: t ? { time: t.exitTime, price: t.exitPrice, reason: t.reason, pnlJpy: t.pnlJpy } : null,
      late:
        isLate(b.symbol, b.entryTime) ||
        (t !== undefined && isLate(b.symbol, t.exitTime)) ||
        (t !== undefined && t.reason === "close" && t.exitTime.getTime() !== lastBarStart && lateCloseOut),
    };
  });
  deps.repos.trading.replaceDayTrades(run.date, records);
  if (closeOut) {
    deps.repos.trading.putDayRun({ ...run, closed: true });
    // 自動売買がためた日も、取引量の基準に使えるように「取り終えた日」とする(T8 のレビュー 4)
    for (const symbol of WATCHLIST) {
      if (bars[symbol].length > 0) deps.repos.bars.markFetched(symbol, [run.date]);
    }
  }
}

/**
 * 前の日に動いていて、締める前に止まった日を締める(SPEC-003 定義 11、ADR-0009)。
 * その日の残りの足を取り直してから作り直す
 */
async function closeUnfinishedDays(deps: WorkerDeps, today: string, now: Date): Promise<void> {
  for (const run of deps.repos.trading.listDayRuns()) {
    if (run.closed || run.date >= today) continue;
    const session = sessionOn(run.date);
    if (!session) continue;
    await fetchDayBars(deps, session, now);
    rebuildDay(deps, run, true, now);
  }
}

/**
 * ワーカーの1回分の処理(1分ごとに呼ぶ。ADR-0007、ADR-0009)。
 * 取引時間中は、今日の足を取り、今日の記録を作り直す
 */
export async function runTick(deps: WorkerDeps, memory: WorkerMemory, now: Date): Promise<void> {
  const today = toEastern(now).date;
  let session: MarketSession | null;
  try {
    session = sessionOn(today);
  } catch (e) {
    if (e instanceof CalendarOutOfRangeError) {
      setStatus(deps, now, "calendar-outdated", WORKER_MESSAGES.calendarOutdated);
      return;
    }
    throw e;
  }

  if (!deps.repos.credentials.get()) {
    setStatus(deps, now, "no-credentials", BLOCKED_NO_CREDENTIALS);
    return;
  }

  try {
    await closeUnfinishedDays(deps, today, now);
    if (!session) {
      setStatus(deps, now, "idle", WORKER_MESSAGES.closedDay);
      return;
    }
    if (now.getTime() < session.open.getTime()) {
      setStatus(deps, now, "idle", WORKER_MESSAGES.beforeOpen);
      return;
    }
    const existing = deps.repos.trading.getDayRun(today);
    // 取引時間が終わってから初めて動いた日は、その日を記録しない(取引時間中に動いていないため。ADR-0009)
    if (!existing && now.getTime() >= session.close.getTime()) {
      setStatus(deps, now, "idle", WORKER_MESSAGES.dayDone);
      return;
    }
    if (existing?.closed) {
      setStatus(deps, now, "idle", WORKER_MESSAGES.dayDone);
      return;
    }
    const run = existing ?? startDayRun(deps, today, now);
    await backfillPastDays(deps, memory, today, now);
    const saved = await fetchDayBars(deps, session, now);
    const closeOut = now.getTime() >= session.close.getTime() + CLOSE_WAIT_MS;
    rebuildDay(deps, run, closeOut, now);
    setStatus(
      deps,
      now,
      closeOut ? "idle" : "running",
      closeOut ? WORKER_MESSAGES.dayDone : WORKER_MESSAGES.running,
      saved > 0 ? now : undefined,
    );
  } catch (e) {
    if (e instanceof MarketDataError) {
      // データを取れない間は、新しい足がないので練習売買も進まない(ADR-0005、AC-007-10)
      setStatus(deps, now, "data-error", `データを取得できていません。練習売買はしていません。${marketDataErrorMessage(e.kind)}`);
      console.warn(`市場データの取得に失敗しました(${e.kind})`);
      return;
    }
    throw e;
  }
}
