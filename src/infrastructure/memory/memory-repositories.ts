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

/** テスト用の、メモリに保存する実装 */
export class MemorySettingsRepository implements SettingsRepository {
  private autoTrading: boolean | null = null;
  private money = new Map<string, MoneySettings>();
  private changes = new Map<number, boolean>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  getAutoTradingEnabled(): boolean | null {
    return this.autoTrading;
  }
  setAutoTradingEnabled(enabled: boolean): void {
    const changed = (this.autoTrading ?? true) !== enabled;
    this.autoTrading = enabled;
    if (changed) this.changes.set(this.now().getTime(), enabled);
  }
  listAutoTradingChanges(): { at: Date; enabled: boolean }[] {
    return [...this.changes.entries()].sort(([a], [b]) => a - b).map(([at, enabled]) => ({ at: new Date(at), enabled }));
  }
  listMoneySettings(): MoneySettings[] {
    return [...this.money.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }
  putMoneySettings(settings: MoneySettings): void {
    this.money.set(settings.effectiveDate, { ...settings });
  }
}

export class MemoryCredentialsRepository implements CredentialsRepository {
  private value: CredentialsInput | null = null;

  get(): CredentialsInput | null {
    return this.value ? { ...this.value } : null;
  }
  save(credentials: CredentialsInput): void {
    this.value = { ...credentials };
  }
  delete(): void {
    this.value = null;
  }
}

export class MemoryBarRepository implements BarRepository {
  readonly bars = new Map<string, SymbolBar>();
  private fetched = new Map<string, Set<string>>();

  saveBars(list: readonly SymbolBar[]): number {
    let inserted = 0;
    for (const b of list) {
      const key = `${b.symbol}|${b.start.getTime()}`;
      if (this.bars.has(key)) continue;
      this.bars.set(key, { ...b, start: new Date(b.start) });
      inserted++;
    }
    return inserted;
  }
  markFetched(symbol: string, dates: readonly string[]): void {
    const set = this.fetched.get(symbol) ?? new Set<string>();
    for (const d of dates) set.add(d);
    this.fetched.set(symbol, set);
  }
  fetchedDates(symbol: string, from: string, to: string): string[] {
    return [...(this.fetched.get(symbol) ?? [])].filter((d) => d >= from && d <= to).sort();
  }
  barsBetween(symbol: string, start: Date, end: Date): SymbolBar[] {
    return [...this.bars.values()]
      .filter((b) => b.symbol === symbol && b.start >= start && b.start < end)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((b) => ({ ...b }));
  }
  fetchedDatesBefore(symbol: string, date: string, limit: number): string[] {
    return [...(this.fetched.get(symbol) ?? [])]
      .filter((d) => d < date)
      .sort()
      .slice(-limit);
  }
  summary(): { symbol: string; barCount: number; dayCount: number; firstDate: string | null; lastDate: string | null }[] {
    const symbols = [...new Set([...[...this.bars.values()].map((b) => b.symbol), ...this.fetched.keys()])].sort();
    return symbols.map((symbol) => {
      const dates = [...(this.fetched.get(symbol) ?? [])].sort();
      return {
        symbol,
        barCount: [...this.bars.values()].filter((b) => b.symbol === symbol).length,
        dayCount: dates.length,
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
      };
    });
  }
}

export class MemoryTradingRepository implements TradingRepository {
  private runs = new Map<string, DayRun>();
  private trades = new Map<string, TradeRecord[]>();
  private status: WorkerStatus | null = null;

  getDayRun(date: string): DayRun | null {
    const r = this.runs.get(date);
    return r ? { ...r } : null;
  }
  putDayRun(run: DayRun): void {
    this.runs.set(run.date, { ...run });
  }
  listDayRuns(): DayRun[] {
    return [...this.runs.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r }));
  }
  replaceDayTrades(date: string, records: readonly TradeRecord[]): void {
    this.trades.set(date, records.map((r) => ({ ...r })));
  }
  listTrades(date: string): TradeRecord[] {
    return (this.trades.get(date) ?? []).map((r) => ({ ...r }));
  }
  realizedBefore(date: string): number {
    let total = 0;
    for (const [d, list] of this.trades) {
      if (d < date) for (const r of list) total += r.exit?.pnlJpy ?? 0;
    }
    return total;
  }
  getWorkerStatus(): WorkerStatus | null {
    return this.status ? { ...this.status } : null;
  }
  putWorkerStatus(status: WorkerStatus): void {
    this.status = { ...status };
  }
}

export class MemoryBacktestRepository implements BacktestRepository {
  private run: BacktestRun | null = null;
  private days: BacktestDay[] = [];
  private trades: TradeRecord[] = [];

  replaceAll(run: BacktestRun, days: readonly BacktestDay[], trades: readonly TradeRecord[]): void {
    this.run = { ...run };
    this.days = [...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d }));
    this.trades = trades.map((t) => ({ ...t, late: false }));
  }
  getRun(): BacktestRun | null {
    return this.run ? { ...this.run } : null;
  }
  listDays(): BacktestDay[] {
    return this.days.map((d) => ({ ...d }));
  }
  listTrades(date: string): TradeRecord[] {
    return this.trades
      .filter((t) => t.date === date)
      .sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime())
      .map((t) => ({ ...t }));
  }
}

export function memoryRepositories(now: () => Date = () => new Date()): Repositories {
  return {
    settings: new MemorySettingsRepository(now),
    credentials: new MemoryCredentialsRepository(),
    bars: new MemoryBarRepository(),
    trading: new MemoryTradingRepository(),
    backtest: new MemoryBacktestRepository(),
  };
}
