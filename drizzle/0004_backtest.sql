CREATE TABLE `backtest_days` (
	`date` text PRIMARY KEY NOT NULL,
	`starting_realized_jpy` real NOT NULL,
	`baseline_dates_json` text NOT NULL,
	`pnl_jpy` real NOT NULL,
	`limit_reached` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backtest_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`ran_at` text NOT NULL,
	`principal_jpy` integer NOT NULL,
	`fx_rate_x100` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backtest_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`symbol` text NOT NULL,
	`signal_bar_start_ms` integer NOT NULL,
	`entry_time_ms` integer NOT NULL,
	`entry_price` real NOT NULL,
	`shares` real NOT NULL,
	`stop_price` real NOT NULL,
	`exit_time_ms` integer,
	`exit_price` real,
	`reason` text,
	`pnl_jpy` real
);
