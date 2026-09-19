CREATE TABLE `eva_mini_app_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`display_name` text NOT NULL,
	`loopback_port` integer NOT NULL,
	`created_by_user_id` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "eva_mini_app_deployments_loopback_port_check" CHECK("eva_mini_app_deployments"."loopback_port" BETWEEN 1 AND 65535)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eva_mini_app_deployments_app_id_idx` ON `eva_mini_app_deployments` (`app_id`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_deployments_active_idx` ON `eva_mini_app_deployments` (`revoked_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE `eva_mini_app_links` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`created_by_user_id` text,
	`user_id` text,
	`group_id` text,
	`agent_id` text,
	`handoff_hash` text NOT NULL,
	`handoff_expires_at` integer NOT NULL,
	`exchanged_at` integer,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deployment_id`) REFERENCES `eva_mini_app_deployments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `auth_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "eva_mini_app_links_one_subject_check" CHECK(("eva_mini_app_links"."user_id" IS NOT NULL AND "eva_mini_app_links"."group_id" IS NULL) OR ("eva_mini_app_links"."user_id" IS NULL AND "eva_mini_app_links"."group_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eva_mini_app_links_handoff_hash_idx` ON `eva_mini_app_links` (`handoff_hash`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_links_deployment_idx` ON `eva_mini_app_links` (`deployment_id`,`expires_at`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_links_user_idx` ON `eva_mini_app_links` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_links_group_idx` ON `eva_mini_app_links` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `eva_mini_app_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`core_session_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `eva_mini_app_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`) REFERENCES `eva_mini_app_deployments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`core_session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eva_mini_app_sessions_token_hash_idx` ON `eva_mini_app_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_sessions_link_idx` ON `eva_mini_app_sessions` (`link_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `eva_mini_app_sessions_user_idx` ON `eva_mini_app_sessions` (`user_id`,`created_at`);