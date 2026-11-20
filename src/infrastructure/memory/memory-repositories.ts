import type { BarRepository, CredentialsRepository, Repositories, SettingsRepository, SymbolBar } from "@/application/ports";
import type { CredentialsInput, MoneySettings } from "@/domain/settings/settings";

/** テスト用の、メモリに保存する実装 */
export class MemorySettingsRepository implements SettingsRepository {
  private autoTrading: boolean | null = null;
  private money = new Map<string, MoneySettings>();

  getAutoTradingEnabled(): boolean | null {
    return this.autoTrading;
  }
  setAutoTradingEnabled(enabled: boolean): void {
    this.autoTrading = enabled;
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

export function memoryRepositories(): Repositories {
  return {
    settings: new MemorySettingsRepository(),
    credentials: new MemoryCredentialsRepository(),
    bars: new MemoryBarRepository(),
  };
}
