CREATE TABLE `kindness_rate_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`used` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kindness_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kindness_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
