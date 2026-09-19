CREATE TABLE `auth_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`target_user_id` text,
	`event_type` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `auth_audit_events_actor_idx` ON `auth_audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_audit_events_target_idx` ON `auth_audit_events` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_audit_events_created_idx` ON `auth_audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`role` text,
	`user_id` text,
	`agent_id` text,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `auth_instructions_scope_idx` ON `auth_instructions` (`scope`);--> statement-breakpoint
CREATE INDEX `auth_instructions_role_idx` ON `auth_instructions` (`role`);--> statement-breakpoint
CREATE INDEX `auth_instructions_user_idx` ON `auth_instructions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_instructions_agent_idx` ON `auth_instructions` (`agent_id`);--> statement-breakpoint
CREATE TABLE `auth_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`policy_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `auth_policies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_invitations_token_hash_idx` ON `auth_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_invitations_email_idx` ON `auth_invitations` (`email`);--> statement-breakpoint
CREATE INDEX `auth_invitations_expires_idx` ON `auth_invitations` (`expires_at`);--> statement-breakpoint
ALTER TABLE `threads` ADD `agent_id` text;--> statement-breakpoint
CREATE INDEX `threads_agent_idx` ON `threads` (`agent_id`);