import type { CredentialsRepository, Repositories, SettingsRepository } from "@/application/ports";
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

export function memoryRepositories(): Repositories {
  return { settings: new MemorySettingsRepository(), credentials: new MemoryCredentialsRepository() };
}
