CREATE TABLE `bars` (
	`symbol` text NOT NULL,
	`start_ms` integer NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	`vwap` real,
	PRIMARY KEY(`symbol`, `start_ms`)
);
--> statement-breakpoint
CREATE TABLE `fetched_days` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`symbol`, `date`)
);
