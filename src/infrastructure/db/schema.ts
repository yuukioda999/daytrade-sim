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
    /** 自動売買のプロセスが受け取った時刻(UTC ミリ秒)。過去データの取得で取った足は null(ADR-0009) */
    receivedAtMs: integer("received_at_ms"),
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

/** 自動売買の ON / OFF を変えた時刻の履歴(ADR-0009、SPEC-006 AC-006-01) */
export const autoTradingChanges = sqliteTable("auto_trading_changes", {
  atMs: integer("at_ms").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
});

/** 自動売買のプロセスが動いた取引日(SPEC-004 の「記録のある日」)。その日の元手、為替、始めの損益 */
export const dayRuns = sqliteTable("day_runs", {
  date: text("date").primaryKey(),
  principalJpy: integer("principal_jpy").notNull(),
  fxRateX100: integer("fx_rate_x100").notNull(),
  /** その日より前の損益の合計(円) */
  startingRealizedJpy: real("starting_realized_jpy").notNull(),
  /** その日の取引量の基準に使う過去の取引日(銘柄ごと。日を始めた時に決めて変えない。JSON) */
  baselineDatesJson: text("baseline_dates_json").notNull().default("{}"),
  /** その日を締めたか(SPEC-003 定義 14) */
  closed: integer("closed", { mode: "boolean" }).notNull(),
  startedAt: text("started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * 練習売買の記録(SPEC-003)。その日の記録は、作り直すたびに置き換える(ADR-0009)。
 * 売っていない株は exit の列が null
 */
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  symbol: text("symbol").notNull(),
  signalBarStartMs: integer("signal_bar_start_ms").notNull(),
  entryTimeMs: integer("entry_time_ms").notNull(),
  entryPrice: real("entry_price").notNull(),
  shares: real("shares").notNull(),
  stopPrice: real("stop_price").notNull(),
  exitTimeMs: integer("exit_time_ms"),
  exitPrice: real("exit_price"),
  reason: text("reason"),
  pnlJpy: real("pnl_jpy"),
  /** あとから処理した記録(SPEC-003 定義 11) */
  late: integer("late", { mode: "boolean" }).notNull(),
});

/** 自動売買のプロセスの様子(1行だけ。画面の AC-007-08、09、10 で使う) */
export const workerStatus = sqliteTable("worker_status", {
  id: integer("id").primaryKey(),
  heartbeatAt: text("heartbeat_at").notNull(),
  lastBarReceivedAt: text("last_bar_received_at"),
  state: text("state").notNull(),
  message: text("message").notNull(),
});
