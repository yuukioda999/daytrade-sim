import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 1行だけの設定。id は常に 1 */
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  autoTradingEnabled: integer("auto_trading_enabled", { mode: "boolean" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** 元手と為替レートの変更の履歴(SPEC-006 AC-006-15)。為替レートは 100 倍した整数 */
export const moneySettings = sqliteTable("money_settings", {
  effectiveDate: text("effective_date").primaryKey(),
  principalJpy: integer("principal_jpy").notNull(),
  fxRateX100: integer("fx_rate_x100").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Alpaca の接続用キー(ADR-0006)。1行だけ。id は常に 1。
 * 保存時の暗号化はしない(ADR-0006 の決定)。DB ファイルは data/ に置き、コミットしない
 */
export const alpacaCredentials = sqliteTable("alpaca_credentials", {
  id: integer("id").primaryKey(),
  keyId: text("key_id").notNull(),
  secret: text("secret").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * 5分足(通常の取引時間の分だけ)。同じ銘柄の同じ時刻の足は1本だけ(SPEC-006 AC-006-10)。
 * 時刻は足が始まった瞬間を UTC のミリ秒で持つ
 */
export const bars = sqliteTable(
  "bars",
  {
    symbol: text("symbol").notNull(),
    startMs: integer("start_ms").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
    vwap: real("vwap"),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.startMs] })],
);

/** 過去データを取り終えた日(銘柄と米国東部時間の取引日)。取り直しで飛ばすために使う(ADR-0008) */
export const fetchedDays = sqliteTable(
  "fetched_days",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);
