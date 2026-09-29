DROP TABLE `auth_policies`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_auth_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_auth_groups`("id", "name", "updated_at") SELECT "id", "name", "updated_at" FROM `auth_groups`;--> statement-breakpoint
DROP TABLE `auth_groups`;--> statement-breakpoint
ALTER TABLE `__new_auth_groups` RENAME TO `auth_groups`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_groups_name_idx` ON `auth_groups` (`name`);--> statement-breakpoint
CREATE TABLE `__new_auth_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_auth_invitations`("id", "email", "name", "role", "token_hash", "expires_at", "accepted_at", "created_by_user_id", "created_at") SELECT "id", "email", "name", "role", "token_hash", "expires_at", "accepted_at", "created_by_user_id", "created_at" FROM `auth_invitations`;--> statement-breakpoint
DROP TABLE `auth_invitations`;--> statement-breakpoint
ALTER TABLE `__new_auth_invitations` RENAME TO `auth_invitations`;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_invitations_token_hash_idx` ON `auth_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_invitations_email_idx` ON `auth_invitations` (`email`);--> statement-breakpoint
CREATE INDEX `auth_invitations_expires_idx` ON `auth_invitations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_auth_principals` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`default_agent_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_auth_principals`("user_id", "role", "status", "default_agent_id", "revision", "updated_at") SELECT "user_id", "role", "status", "default_agent_id", "revision", "updated_at" FROM `auth_principals`;--> statement-breakpoint
DROP TABLE `auth_principals`;--> statement-breakpoint
ALTER TABLE `__new_auth_principals` RENAME TO `auth_principals`;