CREATE TABLE `auto_trading_changes` (
	`at_ms` integer PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `day_runs` (
	`date` text PRIMARY KEY NOT NULL,
	`principal_jpy` integer NOT NULL,
	`fx_rate_x100` integer NOT NULL,
	`starting_realized_jpy` real NOT NULL,
	`closed` integer NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
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
	`pnl_jpy` real,
	`late` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worker_status` (
	`id` integer PRIMARY KEY NOT NULL,
	`heartbeat_at` text NOT NULL,
	`last_bar_received_at` text,
	`state` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bars` ADD `received_at_ms` integer;