import { and, asc, between, eq, sql } from "drizzle-orm";
import type { BarRepository, CredentialsRepository, Repositories, SettingsRepository, SymbolBar } from "@/application/ports";
import type { CredentialsInput, MoneySettings } from "@/domain/settings/settings";
import type { Db } from "./database";
import { alpacaCredentials, appSettings, bars, fetchedDays, moneySettings } from "./schema";

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

  summary(): { symbol: string; barCount: number; firstDate: string | null; lastDate: string | null }[] {
    const counts = this.db
      .select({ symbol: bars.symbol, barCount: sql<number>`count(*)` })
      .from(bars)
      .groupBy(bars.symbol)
      .all();
    const days = this.db
      .select({
        symbol: fetchedDays.symbol,
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
        firstDate: d?.firstDate ?? null,
        lastDate: d?.lastDate ?? null,
      };
    });
  }
}

export function sqliteRepositories(db: Db): Repositories {
  return {
    settings: new SqliteSettingsRepository(db),
    credentials: new SqliteCredentialsRepository(db),
    bars: new SqliteBarRepository(db),
  };
}
