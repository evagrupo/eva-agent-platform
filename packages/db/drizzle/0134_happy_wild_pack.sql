CREATE TABLE `eva_mini_app_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`user_id` text NOT NULL,
	`core_session_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`exchanged_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `eva_mini_app_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`core_session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eva_mini_app_handoffs_token_hash_idx` ON `eva_mini_app_handoffs` (`token_hash`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_handoffs_link_idx` ON `eva_mini_app_handoffs` (`link_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_handoffs_user_idx` ON `eva_mini_app_handoffs` (`user_id`,`created_at`);--> statement-breakpoint
DROP INDEX `eva_mini_app_links_handoff_hash_idx`;--> statement-breakpoint
ALTER TABLE `eva_mini_app_links` DROP COLUMN `handoff_hash`;--> statement-breakpoint
ALTER TABLE `eva_mini_app_links` DROP COLUMN `handoff_expires_at`;--> statement-breakpoint
ALTER TABLE `eva_mini_app_links` DROP COLUMN `exchanged_at`;