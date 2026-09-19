CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `auth_agent_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`group_id` text,
	`agent_id` text NOT NULL,
	`provider_ids_json` text NOT NULL,
	`model_patterns_json` text NOT NULL,
	`reasoning_levels_json` text NOT NULL,
	`fixed_execution` integer DEFAULT false NOT NULL,
	`permission_mode` text,
	`terminal_access` text DEFAULT 'none' NOT NULL,
	`tool_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `auth_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_agent_grants_one_subject_check" CHECK(("auth_agent_grants"."user_id" IS NOT NULL AND "auth_agent_grants"."group_id" IS NULL) OR ("auth_agent_grants"."user_id" IS NULL AND "auth_agent_grants"."group_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `auth_agent_grants_user_idx` ON `auth_agent_grants` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_agent_grants_group_idx` ON `auth_agent_grants` (`group_id`);--> statement-breakpoint
CREATE TABLE `auth_group_members` (
	`user_id` text NOT NULL,
	`group_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `group_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `auth_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_group_members_group_idx` ON `auth_group_members` (`group_id`);--> statement-breakpoint
CREATE TABLE `auth_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`policy_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `auth_policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_groups_name_idx` ON `auth_groups` (`name`);--> statement-breakpoint
CREATE INDEX `auth_groups_policy_idx` ON `auth_groups` (`policy_id`);--> statement-breakpoint
CREATE TABLE `auth_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`policy_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_policies_role_idx` ON `auth_policies` (`role`);--> statement-breakpoint
CREATE TABLE `auth_principals` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`policy_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `auth_policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_principals_policy_idx` ON `auth_principals` (`policy_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `auth_thread_access` (
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`can_read` integer DEFAULT true NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`granted_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `user_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_thread_access_user_idx` ON `auth_thread_access` (`user_id`,`thread_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
ALTER TABLE `threads` ADD `owner_user_id` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `threads_owner_user_id_idx` ON `threads` (`owner_user_id`,`id`);