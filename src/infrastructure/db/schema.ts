import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
