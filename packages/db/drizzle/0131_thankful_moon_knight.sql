CREATE TABLE IF NOT EXISTS `eva_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`icon` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source_provider_id` text,
	`provider_ids_json` text NOT NULL,
	`default_provider_id` text,
	`default_model` text NOT NULL,
	`default_reasoning_level` text NOT NULL,
	`default_permission_mode` text NOT NULL,
	`fixed_execution` integer DEFAULT false NOT NULL,
	`reasoning_levels_json` text NOT NULL,
	`permission_modes_json` text NOT NULL,
	`instructions` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `eva_agents_status_sort_idx` ON `eva_agents` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `eva_agents_updated_idx` ON `eva_agents` (`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `eva_agent_skills` (
	`agent_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `id`),
	FOREIGN KEY (`agent_id`) REFERENCES `eva_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `eva_agent_skills_agent_sort_idx` ON `eva_agent_skills` (`agent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `eva_agent_workspaces` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`workspace_key` text NOT NULL,
	`relative_path` text NOT NULL,
	`status` text NOT NULL,
	`last_scaffolded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `eva_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `eva_agent_workspaces_key_idx` ON `eva_agent_workspaces` (`workspace_key`);
