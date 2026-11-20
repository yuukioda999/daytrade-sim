import { and, asc, between, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type {
  BacktestDay,
  BacktestRepository,
  BacktestRun,
  BarRepository,
  CredentialsRepository,
  DayRun,
  Repositories,
  SettingsRepository,
  SymbolBar,
  TradeRecord,
  TradingRepository,
  WorkerStatus,
} from "@/application/ports";
import type { CredentialsInput, MoneySettings } from "@/domain/settings/settings";
import type { Db } from "./database";
import {
  alpacaCredentials,
  appSettings,
  autoTradingChanges,
  backtestDays,
  backtestRuns,
  backtestTrades,
  bars,
  dayRuns,
  fetchedDays,
  moneySettings,
  trades,
  workerStatus,
} from "./schema";

const SINGLE_ROW_ID = 1;

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getAutoTradingEnabled(): boolean | null {
    const row = this.db.select().from(appSettings).where(eq(appSettings.id, SINGLE_ROW_ID)).get();
    return row ? row.autoTradingEnabled : null;
  }

  setAutoTradingEnabled(enabled: boolean): void {
    // 同じ値を保存し直した時は、変えた時刻の履歴を書かない(履歴は必ず ON と OFF が入れ替わる。T9 のレビュー 6)
    const changed = (this.getAutoTradingEnabled() ?? true) !== enabled;
    const now = this.now();
    const updatedAt = now.toISOString();
    this.db.transaction((tx) => {
      tx.insert(appSettings)
        .values({ id: SINGLE_ROW_ID, autoTradingEnabled: enabled, updatedAt })
        .onConflictDoUpdate({ target: appSettings.id, set: { autoTradingEnabled: enabled, updatedAt } })
        .run();
      // 変えた時刻の履歴(同じミリ秒に2回変えたら後の値)
      if (!changed) return;
      tx.insert(autoTradingChanges)
        .values({ atMs: now.getTime(), enabled })
        .onConflictDoUpdate({ target: autoTradingChanges.atMs, set: { enabled } })
        .run();
    });
  }

  listAutoTradingChanges(): { at: Date; enabled: boolean }[] {
    return this.db
      .select()
      .from(autoTradingChanges)
      .orderBy(asc(autoTradingChanges.atMs))
      .all()
      .map((r) => ({ at: new Date(r.atMs), enabled: r.enabled }));
  }

  listMoneySettings(): MoneySettings[] {
    return this.db
      .select({
        effectiveDate: moneySettings.effectiveDate,
        principalJpy: moneySettings.principalJpy,
        fxRateX100: moneySettings.fxRateX100,
      })
      .from(moneySettings)
      .orderBy(asc(moneySettings.effectiveDate))
      .all();
  }

  putMoneySettings(settings: MoneySettings): void {
    const updatedAt = this.now().toISOString();
    this.db
      .insert(moneySettings)
      .values({ ...settings, updatedAt })
      .onConflictDoUpdate({
        target: moneySettings.effectiveDate,
        set: { principalJpy: settings.principalJpy, fxRateX100: settings.fxRateX100, updatedAt },
      })
      .run();
  }
}

export class SqliteCredentialsRepository implements CredentialsRepository {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): CredentialsInput | null {
    const row = this.db.select().from(alpacaCredentials).where(eq(alpacaCredentials.id, SINGLE_ROW_ID)).get();
    return row ? { keyId: row.keyId, secret: row.secret } : null;
  }

  save(credentials: CredentialsInput): void {
    const updatedAt = this.now().toISOString();
    this.db
      .insert(alpacaCredentials)
      .values({ id: SINGLE_ROW_ID, ...credentials, updatedAt })
      .onConflictDoUpdate({ target: alpacaCredentials.id, set: { ...credentials, updatedAt } })
      .run();
  }

  delete(): void {
    this.db.delete(alpacaCredentials).run();
  }
}

export class SqliteBarRepository implements BarRepository {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  saveBars(list: readonly SymbolBar[]): number {
    if (list.length === 0) return 0;
    // 1回の取得分をまとめて1つのトランザクションで保存する。同じ足は保存しない(AC-006-10)
    return this.db.transaction((tx) => {
      let inserted = 0;
      for (const b of list) {
        const r = tx
          .insert(bars)
          .values({
            symbol: b.symbol,
            startMs: b.start.getTime(),
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
            vwap: b.vwap ?? null,
            receivedAtMs: b.receivedAt?.getTime() ?? null,
          })
          .onConflictDoNothing()
          .run();
        inserted += r.changes;
      }
      return inserted;
    });
  }

  markFetched(symbol: string, dates: readonly string[]): void {
    const fetchedAt = this.now().toISOString();
    this.db.transaction((tx) => {
      for (const date of dates) {
        tx.insert(fetchedDays).values({ symbol, date, fetchedAt }).onConflictDoNothing().run();
      }
    });
  }

  fetchedDates(symbol: string, from: string, to: string): string[] {
    return this.db
      .select({ date: fetchedDays.date })
      .from(fetchedDays)
      .where(and(eq(fetchedDays.symbol, symbol), between(fetchedDays.date, from, to)))
      .orderBy(asc(fetchedDays.date))
      .all()
      .map((r) => r.date);
  }

  barsBetween(symbol: string, start: Date, end: Date): SymbolBar[] {
    return this.db
      .select()
      .from(bars)
      .where(and(eq(bars.symbol, symbol), gte(bars.startMs, start.getTime()), lt(bars.startMs, end.getTime())))
      .orderBy(asc(bars.startMs))
      .all()
      .map((r) => ({
        symbol: r.symbol,
        start: new Date(r.startMs),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        vwap: r.vwap ?? undefined,
        receivedAt: r.receivedAtMs === null ? undefined : new Date(r.receivedAtMs),
      }));
  }

  fetchedDatesBefore(symbol: string, date: string, limit: number): string[] {
    return this.db
      .select({ date: fetchedDays.date })
      .from(fetchedDays)
      .where(and(eq(fetchedDays.symbol, symbol), lt(fetchedDays.date, date)))
      .orderBy(desc(fetchedDays.date))
      .limit(limit)
      .all()
      .map((r) => r.date)
      .reverse();
  }

  summary(): { symbol: string; barCount: number; dayCount: number; firstDate: string | null; lastDate: string | null }[] {
    const counts = this.db
      .select({ symbol: bars.symbol, barCount: sql<number>`count(*)` })
      .from(bars)
      .groupBy(bars.symbol)
      .all();
    const days = this.db
      .select({
        symbol: fetchedDays.symbol,
        dayCount: sql<number>`count(*)`,
        firstDate: sql<string>`min(${fetchedDays.date})`,
        lastDate: sql<string>`max(${fetchedDays.date})`,
      })
      .from(fetchedDays)
      .groupBy(fetchedDays.symbol)
      .all();
    const symbols = [...new Set([...counts.map((c) => c.symbol), ...days.map((d) => d.symbol)])].sort();
    return symbols.map((symbol) => {
      const d = days.find((x) => x.symbol === symbol);
      return {
        symbol,
        barCount: counts.find((c) => c.symbol === symbol)?.barCount ?? 0,
        dayCount: d?.dayCount ?? 0,
        firstDate: d?.firstDate ?? null,
        lastDate: d?.lastDate ?? null,
      };
    });
  }
}

export class SqliteTradingRepository implements TradingRepository {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getDayRun(date: string): DayRun | null {
    const r = this.db.select().from(dayRuns).where(eq(dayRuns.date, date)).get();
    return r ? toDayRun(r) : null;
  }

  putDayRun(run: DayRun): void {
    const values = {
      date: run.date,
      principalJpy: run.principalJpy,
      fxRateX100: run.fxRateX100,
      startingRealizedJpy: run.startingRealizedJpy,
      baselineDatesJson: JSON.stringify(run.baselineDates),
      closed: run.closed,
      startedAt: run.startedAt.toISOString(),
      updatedAt: this.now().toISOString(),
    };
    this.db.insert(dayRuns).values(values).onConflictDoUpdate({ target: dayRuns.date, set: values }).run();
  }

  listDayRuns(): DayRun[] {
    return this.db.select().from(dayRuns).orderBy(asc(dayRuns.date)).all().map(toDayRun);
  }

  replaceDayTrades(date: string, records: readonly TradeRecord[]): void {
    this.db.transaction((tx) => {
      tx.delete(trades).where(eq(trades.date, date)).run();
      for (const r of records) {
        tx.insert(trades)
          .values({
            date: r.date,
            symbol: r.symbol,
            signalBarStartMs: r.signalBarStart.getTime(),
            entryTimeMs: r.entryTime.getTime(),
            entryPrice: r.entryPrice,
            shares: r.shares,
            stopPrice: r.stopPrice,
            exitTimeMs: r.exit?.time.getTime() ?? null,
            exitPrice: r.exit?.price ?? null,
            reason: r.exit?.reason ?? null,
            pnlJpy: r.exit?.pnlJpy ?? null,
            late: r.late,
          })
          .run();
      }
    });
  }

  listTrades(date: string): TradeRecord[] {
    return this.db
      .select()
      .from(trades)
      .where(eq(trades.date, date))
      .orderBy(asc(trades.entryTimeMs), asc(trades.id))
      .all()
      .map(toTradeRecord);
  }

  realizedBefore(date: string): number {
    const r = this.db
      .select({ total: sql<number | null>`sum(${trades.pnlJpy})` })
      .from(trades)
      .where(and(lt(trades.date, date), isNotNull(trades.pnlJpy)))
      .get();
    return r?.total ?? 0;
  }

  getWorkerStatus(): WorkerStatus | null {
    const r = this.db.select().from(workerStatus).where(eq(workerStatus.id, SINGLE_ROW_ID)).get();
    return r
      ? {
          heartbeatAt: new Date(r.heartbeatAt),
          lastBarReceivedAt: r.lastBarReceivedAt ? new Date(r.lastBarReceivedAt) : null,
          state: r.state as WorkerStatus["state"],
          message: r.message,
        }
      : null;
  }

  putWorkerStatus(status: WorkerStatus): void {
    const values = {
      id: SINGLE_ROW_ID,
      heartbeatAt: status.heartbeatAt.toISOString(),
      lastBarReceivedAt: status.lastBarReceivedAt?.toISOString() ?? null,
      state: status.state,
      message: status.message,
    };
    this.db.insert(workerStatus).values(values).onConflictDoUpdate({ target: workerStatus.id, set: values }).run();
  }
}

export class SqliteBacktestRepository implements BacktestRepository {
  constructor(private readonly db: Db) {}

  replaceAll(run: BacktestRun, days: readonly BacktestDay[], records: readonly TradeRecord[]): void {
    this.db.transaction((tx) => {
      tx.delete(backtestTrades).run();
      tx.delete(backtestDays).run();
      tx.delete(backtestRuns).run();
      tx.insert(backtestRuns)
        .values({ id: SINGLE_ROW_ID, ranAt: run.ranAt.toISOString(), principalJpy: run.principalJpy, fxRateX100: run.fxRateX100 })
        .run();
      for (const d of days) {
        tx.insert(backtestDays)
          .values({
            date: d.date,
            startingRealizedJpy: d.startingRealizedJpy,
            baselineDatesJson: JSON.stringify(d.baselineDates),
            pnlJpy: d.pnlJpy,
            limitReached: d.limitReached,
          })
          .run();
      }
      for (const r of records) {
        tx.insert(backtestTrades)
          .values({
            date: r.date,
            symbol: r.symbol,
            signalBarStartMs: r.signalBarStart.getTime(),
            entryTimeMs: r.entryTime.getTime(),
            entryPrice: r.entryPrice,
            shares: r.shares,
            stopPrice: r.stopPrice,
            exitTimeMs: r.exit?.time.getTime() ?? null,
            exitPrice: r.exit?.price ?? null,
            reason: r.exit?.reason ?? null,
            pnlJpy: r.exit?.pnlJpy ?? null,
          })
          .run();
      }
    });
  }

  getRun(): BacktestRun | null {
    const r = this.db.select().from(backtestRuns).where(eq(backtestRuns.id, SINGLE_ROW_ID)).get();
    return r ? { ranAt: new Date(r.ranAt), principalJpy: r.principalJpy, fxRateX100: r.fxRateX100 } : null;
  }

  listDays(): BacktestDay[] {
    return this.db
      .select()
      .from(backtestDays)
      .orderBy(asc(backtestDays.date))
      .all()
      .map((r) => ({
        date: r.date,
        startingRealizedJpy: r.startingRealizedJpy,
        baselineDates: JSON.parse(r.baselineDatesJson) as Record<string, string[]>,
        pnlJpy: r.pnlJpy,
        limitReached: r.limitReached,
      }));
  }

  listTrades(date: string): TradeRecord[] {
    return this.db
      .select()
      .from(backtestTrades)
      .where(eq(backtestTrades.date, date))
      .orderBy(asc(backtestTrades.entryTimeMs), asc(backtestTrades.id))
      .all()
      .map((r) => toTradeRecord({ ...r, late: false }));
  }
}

function toTradeRecord(r: {
  date: string;
  symbol: string;
  signalBarStartMs: number;
  entryTimeMs: number;
  entryPrice: number;
  shares: number;
  stopPrice: number;
  exitTimeMs: number | null;
  exitPrice: number | null;
  reason: string | null;
  pnlJpy: number | null;
  late: boolean;
}): TradeRecord {
  return {
    date: r.date,
    symbol: r.symbol,
    signalBarStart: new Date(r.signalBarStartMs),
    entryTime: new Date(r.entryTimeMs),
    entryPrice: r.entryPrice,
    shares: r.shares,
    stopPrice: r.stopPrice,
    exit:
      r.exitTimeMs === null || r.exitPrice === null || r.reason === null || r.pnlJpy === null
        ? null
        : { time: new Date(r.exitTimeMs), price: r.exitPrice, reason: r.reason as "stop" | "trailing" | "close", pnlJpy: r.pnlJpy },
    late: r.late,
  };
}

function toDayRun(r: typeof dayRuns.$inferSelect): DayRun {
  return {
    date: r.date,
    principalJpy: r.principalJpy,
    fxRateX100: r.fxRateX100,
    startingRealizedJpy: r.startingRealizedJpy,
    baselineDates: JSON.parse(r.baselineDatesJson) as Record<string, string[]>,
    closed: r.closed,
    startedAt: new Date(r.startedAt),
  };
}

export function sqliteRepositories(db: Db, now: () => Date = () => new Date()): Repositories {
  return {
    settings: new SqliteSettingsRepository(db, now),
    credentials: new SqliteCredentialsRepository(db, now),
    bars: new SqliteBarRepository(db, now),
    trading: new SqliteTradingRepository(db, now),
    backtest: new SqliteBacktestRepository(db),
  };
}
