import { asc, eq } from "drizzle-orm";
import type { CredentialsRepository, Repositories, SettingsRepository } from "@/application/ports";
import type { CredentialsInput, MoneySettings } from "@/domain/settings/settings";
import type { Db } from "./database";
import { alpacaCredentials, appSettings, moneySettings } from "./schema";

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
    const updatedAt = this.now().toISOString();
    this.db
      .insert(appSettings)
      .values({ id: SINGLE_ROW_ID, autoTradingEnabled: enabled, updatedAt })
      .onConflictDoUpdate({ target: appSettings.id, set: { autoTradingEnabled: enabled, updatedAt } })
      .run();
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

export function sqliteRepositories(db: Db): Repositories {
  return { settings: new SqliteSettingsRepository(db), credentials: new SqliteCredentialsRepository(db) };
}
