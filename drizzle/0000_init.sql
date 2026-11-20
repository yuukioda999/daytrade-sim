CREATE TABLE `alpaca_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`secret` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`auto_trading_enabled` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `money_settings` (
	`effective_date` text PRIMARY KEY NOT NULL,
	`principal_jpy` integer NOT NULL,
	`fx_rate_x100` integer NOT NULL,
	`updated_at` text NOT NULL
);
